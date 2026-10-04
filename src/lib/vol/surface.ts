import { fitSsvi, ssviSafeAtDays, ssviVol, type SsviFit } from './ssvi';
import type { PricingCurves } from '../market/factors';

/**
 * CME COMEX settlement'larından kurulan IV yüzeyi. Smile forward-moneyness (m = K/F) ekseninde
 * tutulur; fiyatlama hedef vadenin forward'ıyla m'i hesaplar ve iki komşu vadeyi aynı m'de okur.
 */

export interface SmilePoint {
  m: number;
  iv: number;
}

export interface ExpirySmile {
  /** Exact CME option expiry; distinct from the underlying futures last trade. */
  expiryAt?: string;
  days: number;
  date: string;
  points: SmilePoint[];
  /** Vade-başına gözlemlenen forward: dayanak futures'ın settlement fiyatı (m = K/f çapası). */
  f?: number;
  underlyingId?: string;
  underlyingLastTradeTime?: string;
}

export interface VolSurface {
  curves?: PricingCurves;
  symbol: string;
  spot: number;
  fetchedISO: string;
  expiries: ExpirySmile[];
  /** Eğri paketi olmadan sabit faizle kurulmuş yüzeyin faizi (paketli metal yüzeyinde yok). */
  builtWithR?: number;
  /**
   * Yüzey kurulurken oluşan İŞLEYİŞ NOTLARI (ör. "2026-08-07 atlandı: yetersiz futures
   * settlement"). `fetchedISO` bir TARİH alanıdır ve ekranda tarih olarak gösterilir;
   * bir dönem hata metni oraya iliştiriliyordu ("2026-08-07 CME (Atlananlar: …)") ve
   * rozet okunmaz hale geliyordu. Teşhis bilgisi artık burada durur.
   */
  notes?: string;
  /**
   * Yüzey kurulurken CME futures fiyatları arasındaki farklardan hesaplanan
   * piyasanın anlık Zımni Kira Oranı (Implied Lease Rate).
   * Yıllık oran olarak tutulur (örn: 0.015 = %1.5).
   */
  impliedLeaseRate?: number;
}

/**
 * Fitted SSVI unavailable olduğunda kote aralığındaki yedek lineer smile.
 * Kote aralığının dışında değer üretmez.
 */
function smileAt(points: SmilePoint[], m: number): number {
  if (points.length === 0) return NaN;
  if (m < points[0].m) return NaN;
  if (m > points[points.length - 1].m) return NaN;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    if (m >= a.m && m <= b.m) {
      const w = (m - a.m) / (b.m - a.m);
      return a.iv + w * (b.iv - a.iv);
    }
  }
  return points[points.length - 1].iv;
}

export type VolEstimateMode = 'observed' | 'interpolated' | 'model' | 'extrapolated' | 'unavailable';
export interface VolEstimate {
  vol: number | null;
  mode: VolEstimateMode;
  reason?: string;
  fitQuality?: { rmseVol: number; maxErrorVol: number; points: number };
}

const fittedSlices = new WeakMap<ExpirySmile, SsviFit | null>();
const MAX_LOG_WING = 0.22;

function dateDay(value: string): number | null {
  const prefix = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(prefix)) return null;
  const time = Date.parse(`${prefix}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === prefix ? time / 86400000 : null;
}

export function rebasedExpiryDays(surface: VolSurface, expiry: ExpirySmile, valuationDate?: string): number {
  if (!valuationDate) return expiry.days;
  if (surface.curves && expiry.expiryAt) {
    const valuation = dateDay(valuationDate),
      at = Date.parse(expiry.expiryAt);
    return valuation == null || !Number.isFinite(at) ? NaN : at / 86400000 - valuation;
  }
  const asOf = dateDay(surface.fetchedISO);
  const valuation = dateDay(valuationDate);
  const expiryDate = dateDay(expiry.date);
  if (asOf == null || valuation == null || expiryDate == null) return NaN;
  // Retain the snapshot's fractional day (or settlement-time offset).
  const fractionalOffset = expiry.days - (expiryDate - asOf);
  return expiryDate - valuation + fractionalOffset;
}

function sliceEstimate(expiry: ExpirySmile, m: number, rebasedDays: number): VolEstimate {
  if (!(rebasedDays > 0)) return { vol: null, mode: 'unavailable', reason: 'Bu kote vade değerleme tarihinde dolmuş.' };
  const points = expiry.points;
  if (!points.length) return { vol: null, mode: 'unavailable', reason: 'Bu vadede smile noktası yok.' };
  const sorted = points.every((p, i) => i === 0 || p.m > points[i - 1].m);
  if (!sorted || points.some(p => !(p.m > 0) || !(p.iv > 0) || !Number.isFinite(p.m) || !Number.isFinite(p.iv))) {
    return { vol: null, mode: 'unavailable', reason: 'Smile noktaları geçersiz veya yinelenmiş.' };
  }
  const first = points[0].m,
    last = points[points.length - 1].m;
  const outside = m < first || m > last;
  if (!fittedSlices.has(expiry)) fittedSlices.set(expiry, fitSsvi(points, expiry.days));
  const fit = fittedSlices.get(expiry);
  if (fit && ssviSafeAtDays(fit, rebasedDays)) {
    if (outside && (Math.log(first / m) > MAX_LOG_WING || Math.log(m / last) > MAX_LOG_WING)) {
      return { vol: null, mode: 'unavailable', reason: 'Strike, sınırlandırılmış model kanadının dışında.' };
    }
    const vol = ssviVol(fit, m);
    if (Number.isFinite(vol) && vol > 0 && vol < 4) {
      return {
        vol,
        mode: outside ? 'extrapolated' : 'model',
        fitQuality: { rmseVol: fit.rmseVol, maxErrorVol: fit.maxErrorVol, points: fit.points },
      };
    }
  }
  if (outside)
    return {
      vol: null,
      mode: 'unavailable',
      reason: fit ? 'Kalan vadede SSVI kanadı güvenli değil.' : 'SSVI uyumu için yeterli ve tutarlı kote yok.',
    };
  const vol = smileAt(points, m);
  if (!Number.isFinite(vol)) return { vol: null, mode: 'unavailable', reason: 'Smile enterpolasyonu başarısız.' };
  const observed = points.some(p => Math.abs(p.m - m) <= 1e-10);
  return {
    vol,
    mode: observed ? 'observed' : 'interpolated',
    reason: fit ? 'SSVI uyumu kalan vadede güvenli değil; kote smile kullanıldı.' : undefined,
  };
}

/**
 * Yüzeyden (forward-moneyness, gün) için IV tahmini döndürür. m = K/F_hedef; çağıran,
 * fiyatlanan ürünün forward'ını (XAU: S·e^{(r−lease)T}) kullanarak m'i hesaplar.
 * Her iki kuşatan vadenin eğrisi de aynı m'de değerlenir — forward-moneyness
 * normalize koordinat olduğundan (ATM = 1) bu tutarlıdır.
 * Vadeler arası enterpolasyon toplam varyans üzerinden yapılır. Kote vade aralığı
 * dışındaki zaman ekstrapolasyonu kapalıdır; strike kanadı yalnız kabul edilen
 * SSVI uyumu ile ve sınırlı mesafede kullanılabilir.
 */
export function surfaceVolEstimate(surface: VolSurface, m: number, days: number, valuationDate?: string): VolEstimate {
  const exps = surface.expiries;
  if (exps.length === 0) return { vol: null, mode: 'unavailable', reason: 'Smile verisi yok.' };
  if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(days) || days <= 0)
    return { vol: null, mode: 'unavailable', reason: 'Strike veya vade geçersiz.' };
  const aged = exps
    .map(expiry => ({ expiry, days: rebasedExpiryDays(surface, expiry, valuationDate) }))
    .filter(entry => Number.isFinite(entry.days) && entry.days > 0)
    .sort((a, b) => a.days - b.days);
  if (!aged.length)
    return { vol: null, mode: 'unavailable', reason: 'Değerleme tarihinde kote vadeler dolmuş veya tarih geçersiz.' };

  // An observed expiry needs only its own smile. A neighboring tenor may not quote
  // this moneyness, which must not invalidate the exact-tenor observation.
  const exact = aged.find(entry => Math.abs(entry.days - days) < 1e-8);
  if (exact) return sliceEstimate(exact.expiry, m, exact.days);

  const first = aged[0],
    last = aged[aged.length - 1];
  // Ekstrapolasyon yok: kote vade aralığının dışında güvenilir vol türetilemez.
  if (days < first.days || days > last.days)
    return { vol: null, mode: 'unavailable', reason: 'Vade kote vadelerin dışında.' };

  for (let i = 0; i < aged.length - 1; i++) {
    const e1 = aged[i],
      e2 = aged[i + 1];
    if (days > e1.days && days < e2.days) {
      const a = sliceEstimate(e1.expiry, m, e1.days);
      const b = sliceEstimate(e2.expiry, m, e2.days);
      if (a.vol == null || b.vol == null)
        return { vol: null, mode: 'unavailable', reason: a.reason ?? b.reason ?? 'İki vadede de vol bulunmalı.' };
      const v1 = a.vol * a.vol * e1.days,
        v2 = b.vol * b.vol * e2.days;
      if (v2 + 1e-12 < v1)
        return {
          vol: null,
          mode: 'unavailable',
          reason: 'Vadeler arasında toplam varyans azalıyor; takvim arbitrajı riski.',
        };
      const weight = (days - e1.days) / (e2.days - e1.days);
      const vol = Math.sqrt(((1 - weight) * v1 + weight * v2) / days);
      return {
        vol,
        mode:
          a.mode === 'extrapolated' || b.mode === 'extrapolated'
            ? 'extrapolated'
            : a.mode === 'model' || b.mode === 'model'
              ? 'model'
              : 'interpolated',
        fitQuality: a.fitQuality ?? b.fitQuality,
      };
    }
  }
  return { vol: null, mode: 'unavailable', reason: 'Uygun kote vade bulunamadı.' };
}

export function surfaceVol(surface: VolSurface, m: number, days: number, valuationDate?: string): number | null {
  return surfaceVolEstimate(surface, m, days, valuationDate).vol;
}
