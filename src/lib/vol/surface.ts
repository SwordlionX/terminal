import { deAmericanizedIV } from '../math/american';

/**
 * Yahoo snapshot formatı (fetch_yahoo.py / api/market/refresh üretir):
 * row = [K, cBid, cAsk, cLast, cYahooIV, pBid, pAsk, pLast, pYahooIV, cOI, pOI]
 * Smile, moneyness (K/S) ekseninde tutulur; böylece GLD eğrisi XAU spotuna,
 * SLV eğrisi XAG spotuna bire bir taşınabilir.
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

function mid(bid: number | null, ask: number | null, last: number | null): number | null {
  if (bid != null && ask != null && bid > 0 && ask > 0 && ask >= bid) return (bid + ask) / 2;
  if (last != null && last > 0) return last;
  return null;
}

/**
 * Snapshot ürününden de-Amerikanize IV smile yüzeyi kurar.
 * Her strike için OTM taraf kullanılır (piyasa standardı):
 * K >= S -> call IV, K < S -> put IV; o taraf yoksa diğerine düşülür.
 */
export function buildSurface(prod: SnapshotProduct, r: number, fetchedISO: string, q: number = 0): VolSurface {
  const expiries: ExpirySmile[] = [];
  const S = prod.spot;

  for (const e of prod.expiries) {
    const T = Math.max(e.days, 0.5) / 365;
    const points: SmilePoint[] = [];

    for (const row of e.rows) {
      const K = row[0] as number;
      const cMid = mid(row[1], row[2], row[3]);
      const pMid = mid(row[5], row[6], row[7]);
      const m = K / S;

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

/** Tek vade smile'ı üzerinde moneyness'e göre lineer enterpolasyon (uçlarda düz). */
function smileAt(points: SmilePoint[], m: number): number {
  if (points.length === 0) return NaN;
  if (m <= points[0].m) return points[0].iv;
  if (m >= points[points.length - 1].m) return points[points.length - 1].iv;
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
 * Yüzeyden (moneyness, gün) için IV döndürür.
 * Vadeler arası enterpolasyon toplam varyans üzerinden yapılır
 * (varyans = iv^2 * T, T'de lineer — piyasa standardı).
 */
export function surfaceVol(surface: VolSurface, m: number, days: number): number | null {
  const exps = surface.expiries;
  if (exps.length === 0) return null;

  if (days <= exps[0].days) {
    const iv = smileAt(exps[0].points, m);
    return isFinite(iv) ? iv : null;
  }
  if (days >= exps[exps.length - 1].days) {
    const iv = smileAt(exps[exps.length - 1].points, m);
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
