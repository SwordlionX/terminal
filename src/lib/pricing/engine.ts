import { gk, greeks } from '../math';
import { surfaceVolEstimate, type VolSurface } from '../vol/surface';
import { curveFactors } from '../market/factors';

export interface PricingInputs {
  manualSpot?: boolean;
  spot: number;
  strike: number;
  rate: number;
  lease: number;
  vol: number;
  manualVol: boolean;
  contractSize: number;
  basis: number;
  tradeDate: string;
  expiryDate: string;
}

export function dateDay(text: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return NaN;
  const value = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === text ? value : NaN;
}

/** Shared by the pricing screen and assistant. Percent inputs use screen units. */
export function calculatePricing(md: PricingInputs, surface: VolSurface | null) {
  const rawDays = (dateDay(md.expiryDate) - dateDay(md.tradeDate)) / 86400000;
  const dateValid = Number.isFinite(rawDays) && rawDays > 0;
  const daysToExpiry = dateValid ? rawDays : 0;
  const validBasis = Number.isFinite(md.basis) && md.basis > 0;
  let factors: ReturnType<typeof curveFactors> | null = null, curveError: string | null = null;
  if (surface?.curves && dateValid) {
    try { factors = curveFactors(surface.curves, dateDay(md.tradeDate), dateDay(md.expiryDate)); }
    catch (e) { curveError = e instanceof Error ? e.message : 'Faiz/taşıma eğrisi okunamadı.'; }
  }
  const tYears = dateValid && validBasis ? daysToExpiry / (surface?.curves ? 365 : md.basis) : 0;
  const effectiveRate = factors ? factors.rate365 * 100 : surface?.curves ? NaN : md.rate;
  const effectiveLease = factors ? factors.lease365 * 100 : surface?.curves ? NaN : md.lease;
  const fwd = factors ? md.spot * factors.forwardRatio : md.spot * Math.exp((effectiveRate - effectiveLease) / 100 * tYears);
  const pricingSpot = md.spot;
  const smileEstimate = !surface || !(fwd > 0) || !(md.strike > 0) || !dateValid
    ? { vol: null, mode: 'unavailable' as const, reason: 'Geçerli spot, strike ve vade gerekli.' }
    : surfaceVolEstimate(surface, md.strike / fwd, daysToExpiry, md.tradeDate);
  const smileIv = smileEstimate.vol != null ? smileEstimate.vol * 100 : null;
  const contractSizeValid = Number.isFinite(md.contractSize) && md.contractSize > 0;
  const numericInputsValid = dateValid && validBasis && Number.isFinite(md.spot) && md.spot > 0 &&
    Number.isFinite(md.strike) && md.strike > 0 && contractSizeValid &&
    Number.isFinite(effectiveRate) && Number.isFinite(effectiveLease) && Number.isFinite(fwd) && fwd > 0;
  const manualAvailable = Number.isFinite(md.vol) && md.vol > 0 && md.vol < 400;
  const autoAvailable = smileIv != null && Number.isFinite(smileIv);
  const effVol = md.manualVol ? md.vol : (smileIv ?? md.vol);
  const result = gk(pricingSpot, md.strike, tYears, effectiveRate / 100, effectiveLease / 100, effVol / 100);
  const finitePrices = Number.isFinite(result.call) && result.call >= 0 && Number.isFinite(result.put) && result.put >= 0;
  const curveManual = !!(md.manualVol || md.manualSpot);
  const priceable = !curveManual && numericInputsValid && (md.manualVol ? manualAvailable : autoAvailable) && finitePrices;
  const unpriceableReason = priceable ? null
    : curveManual ? 'Manuel spot/volatilite, faiz–taşıma eğrisiyle fiyatlama tutarlılığını bozar; otomatik kaynağı kullanın.'
    : curveError ? curveError
    : !contractSizeValid ? 'Geçerli pozitif kontrat büyüklüğü gerekli.'
    : !numericInputsValid ? 'Geçerli işlem tarihi, ileri vade, spot, strike, faiz ve gün bazı gerekli.'
    : md.manualVol && !manualAvailable ? 'Manuel volatilite geçersiz.'
    : !finitePrices && (md.manualVol || autoAvailable) ? 'Model sonlu ve geçerli bir prim üretemedi; girdileri kontrol edin.'
    : !surface ? 'Smile verisi yok — faiz, taşıma ve IV verisini birlikte yenileyin.'
    : smileEstimate.reason ?? 'Bu strike/vade için güvenilir vol türetilemiyor.';
  const gr = greeks(pricingSpot, md.strike, tYears, effectiveRate / 100, effectiveLease / 100, effVol / 100, surface?.curves ? 365 : md.basis);
  // Curve theta rolls USD/metal factors while holding source IV fixed (standard partial).
  if (surface?.curves && factors && gr && rawDays >= 1) {
    const from = dateDay(md.tradeDate) + 86400000, to = dateDay(md.expiryDate);
    const next = from === to ? gk(pricingSpot, md.strike, 0, 0, 0, effVol / 100) : (() => {
      const f = curveFactors(surface.curves!, from, to);
      return gk(pricingSpot, md.strike, (rawDays - 1) / 365, f.rate365, f.lease365, effVol / 100);
    })();
    gr.call.theta = next.call - result.call; gr.put.theta = next.put - result.put;
  }
  return { dateValid, daysToExpiry, tYears, fwd, pricingSpot, smileEstimate, smileIv, numericInputsValid,
    effVol, result, gr, autoAvailable, priceable, unpriceableReason, effectiveRate, effectiveLease,
    discountFactor: factors?.discount ?? result.dfR, metalFactor: factors?.metal ?? result.dfQ,
    displayRate: factors ? -Math.log(factors.discount) / (rawDays / md.basis) * 100 : effectiveRate,
    displayLease: factors ? -Math.log(factors.metal) / (rawDays / md.basis) * 100 : effectiveLease };
}
