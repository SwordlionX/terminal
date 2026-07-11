import { deAmericanizedIV } from '../math/american';

/**
 * Yahoo snapshot formatı (fetch_yahoo.py / api/market/refresh üretir):
 * row = [K, cBid, cAsk, cLast, cYahooIV, pBid, pAsk, pLast, pYahooIV, cOI, pOI]
 * Smile, forward-moneyness (K/F) ekseninde tutulur; böylece GLD eğrisi XAU'ya,
 * SLV eğrisi XAG'a taşınırken lease/carry farkı ATM çapasını kaydırmadan hizalanır.
 */

export type SnapshotRow = (number | null)[];

export interface SnapshotExpiry {
  exp: number;
  days: number;
  date: string;
  rows: SnapshotRow[];
}

export interface SnapshotProduct {
  symbol: string;
  label: string;
  spot: number;
  expiries: SnapshotExpiry[];
}

export interface YahooSnapshot {
  fetched: number;
  fetchedISO: string;
  products: Record<string, SnapshotProduct>;
}

export interface SmilePoint { m: number; iv: number }

export interface ExpirySmile {
  days: number;
  date: string;
  points: SmilePoint[];
}

export interface VolSurface {
  symbol: string;
  spot: number;
  fetchedISO: string;
  expiries: ExpirySmile[];
}

/**
 * (ask-bid)/mid bu eşiği aşarsa çift taraflı kota "çarpık-geniş" sayılır
 * (ör. 0.05/2.00 illikit kota): mid güvenilmez, smile'a gürültü basar — reddedilir.
 */
const MAX_REL_SPREAD = 1.5;

/**
 * Katmanlı fiyat: önce çift taraflı kotasyon ortası (bid & ask > 0 ve makul spread),
 * yoksa yalnızca açık pozisyonu (OI > 0) olan lastPrice kabul edilir.
 * OI'siz bayat lastPrice ("ölü" strike) reddedilir — smile gürültüsünü keser.
 */
function mid(bid: number | null, ask: number | null, last: number | null, oi: number | null): number | null {
  if (bid != null && ask != null && bid > 0 && ask > 0 && ask >= bid) {
    const m = (bid + ask) / 2;
    if ((ask - bid) / m <= MAX_REL_SPREAD) return m;
    // çarpık-geniş kota: mid'i atla, OI'li last'a düş
  }
  if (last != null && last > 0 && oi != null && oi > 0) return last;
  return null;
}

/**
 * Snapshot ürününden de-Amerikanize IV smile yüzeyi kurar.
 *
 * Smile forward-moneyness (m = K/F) ekseninde tutulur; F = S·e^{(r−q)T}.
 * q burada YÜZEYİN kaynağı olan ETF'in taşıma maliyetidir (GLD/SLV temettüsüz,
 * gider oranı ~%0.4 → q≈0), metalin lease oranı DEĞİL. Böylece ATM-forward her
 * vadede m=1'e denk gelir; yüzey XAU/XAG'a taşınırken lease farkı yalnızca
 * sorgu tarafındaki forward çapasına girer (bkz. usePricingModel).
 *
 * Her strike için OTM taraf kullanılır (piyasa standardı):
 * K >= F -> call IV, K < F -> put IV; o taraf yoksa diğerine düşülür.
 */
export function buildSurface(prod: SnapshotProduct, r: number, fetchedISO: string, q: number = 0): VolSurface {
  const expiries: ExpirySmile[] = [];
  const S = prod.spot;

  for (const e of prod.expiries) {
    const T = Math.max(e.days, 0.5) / 365;
    const F = S * Math.exp((r - q) * T); // ETF forward'ı (q≈0)
    const points: SmilePoint[] = [];

    for (const row of e.rows) {
      const K = row[0] as number;
      const cMid = mid(row[1], row[2], row[3], row[9]); // row[9] = call OI
      const pMid = mid(row[5], row[6], row[7], row[10]); // row[10] = put OI
      const m = K / F;

      let iv = NaN;
      if (m >= 1) {
        if (cMid != null) iv = deAmericanizedIV(S, K, T, r, q, cMid, 'call');
        if (!isFinite(iv) && pMid != null) iv = deAmericanizedIV(S, K, T, r, q, pMid, 'put');
      } else {
        if (pMid != null) iv = deAmericanizedIV(S, K, T, r, q, pMid, 'put');
        if (!isFinite(iv) && cMid != null) iv = deAmericanizedIV(S, K, T, r, q, cMid, 'call');
      }

      if (isFinite(iv) && iv > 0.005 && iv < 4) {
        points.push({ m, iv });
      }
    }

    points.sort((a, b) => a.m - b.m);
    if (points.length >= 3) {
      expiries.push({ days: e.days, date: e.date, points });
    }
  }

  expiries.sort((a, b) => a.days - b.days);
  return { symbol: prod.symbol, spot: S, fetchedISO, expiries };
}

/**
 * Tek vade smile'ı üzerinde moneyness'e göre lineer enterpolasyon.
 * Kote strike aralığının DIŞINDA ekstrapolasyon yapmaz (NaN döner) —
 * piyasada gözlemlenmeyen strike'a uydurma vol üretilmez.
 */
function smileAt(points: SmilePoint[], m: number): number {
  if (points.length === 0) return NaN;
  if (m < points[0].m) return NaN;
  if (m > points[points.length - 1].m) return NaN;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (m >= a.m && m <= b.m) {
      const w = (m - a.m) / (b.m - a.m);
      return a.iv + w * (b.iv - a.iv);
    }
  }
  return points[points.length - 1].iv;
}

/**
 * Yüzeyden (forward-moneyness, gün) için IV döndürür. m = K/F_hedef; çağıran,
 * fiyatlanan ürünün forward'ını (XAU: S·e^{(r−lease)T}) kullanarak m'i hesaplar.
 * Her iki kuşatan vadenin smile'ı da aynı m'de değerlenir — forward-moneyness
 * normalize koordinat olduğundan (ATM = 1) bu tutarlıdır.
 * Vadeler arası enterpolasyon toplam varyans üzerinden yapılır
 * (varyans = iv^2 * T, T'de lineer — piyasa standardı).
 */
export function surfaceVol(surface: VolSurface, m: number, days: number): number | null {
  const exps = surface.expiries;
  if (exps.length === 0) return null;

  const first = exps[0], last = exps[exps.length - 1];
  // Ekstrapolasyon yok: kote vade aralığının dışında güvenilir vol türetilemez.
  if (days < first.days || days > last.days) return null;

  // Tek kote vade (ya da tam sınırda): doğrudan o vadenin smile'ı.
  if (exps.length === 1) {
    const iv = smileAt(first.points, m);
    return isFinite(iv) ? iv : null;
  }

  for (let i = 0; i < exps.length - 1; i++) {
    const e1 = exps[i], e2 = exps[i + 1];
    if (days >= e1.days && days <= e2.days) {
      const iv1 = smileAt(e1.points, m);
      const iv2 = smileAt(e2.points, m);
      if (!isFinite(iv1) || !isFinite(iv2)) return null;
      const T = days / 365, T1 = e1.days / 365, T2 = e2.days / 365;
      const w = (T - T1) / (T2 - T1);
      const totalVar = (1 - w) * iv1 * iv1 * T1 + w * iv2 * iv2 * T2;
      return Math.sqrt(Math.max(totalVar, 1e-8) / T);
    }
  }
  return null;
}

/** Ürün sembolü -> snapshot yüzey sembolü eşlemesi (XAU fiyatlaması GLD smile'ını kullanır). */
export const PRODUCT_SURFACE_MAP: Record<string, string> = {
  XAU: 'GLD',
  XAG: 'SLV',
  GLD: 'GLD',
  SLV: 'SLV',
};
