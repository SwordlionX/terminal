import { gk, greeks } from '../math';
import { surfaceVolEstimate, type VolSurface } from '../vol/surface';

export interface PricingInputs {
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
  const tYears = dateValid && validBasis ? daysToExpiry / md.basis : 0;
  const fwd = md.spot * Math.exp((md.rate - md.lease) / 100 * tYears);
  const pricingSpot = md.spot;
  const smileEstimate = !surface || !(fwd > 0) || !(md.strike > 0) || !dateValid
    ? { vol: null, mode: 'unavailable' as const, reason: 'Geçerli spot, strike ve vade gerekli.' }
    : surfaceVolEstimate(surface, md.strike / fwd, daysToExpiry, md.tradeDate);
  const smileIv = smileEstimate.vol != null ? smileEstimate.vol * 100 : null;
  const contractSizeValid = Number.isFinite(md.contractSize) && md.contractSize > 0;
  const numericInputsValid = dateValid && validBasis && Number.isFinite(md.spot) && md.spot > 0 &&
    Number.isFinite(md.strike) && md.strike > 0 && contractSizeValid &&
    Number.isFinite(md.rate) && Number.isFinite(md.lease) && Number.isFinite(fwd) && fwd > 0;
  const manualAvailable = Number.isFinite(md.vol) && md.vol > 0 && md.vol < 400;
  const autoAvailable = smileIv != null && Number.isFinite(smileIv);
  const effVol = md.manualVol ? md.vol : (smileIv ?? md.vol);
  const result = gk(pricingSpot, md.strike, tYears, md.rate / 100, md.lease / 100, effVol / 100);
  const finitePrices = Number.isFinite(result.call) && result.call >= 0 && Number.isFinite(result.put) && result.put >= 0;
  const priceable = numericInputsValid && (md.manualVol ? manualAvailable : autoAvailable) && finitePrices;
  const unpriceableReason = priceable ? null
    : !contractSizeValid ? 'Geçerli pozitif kontrat büyüklüğü gerekli.'
    : !numericInputsValid ? 'Geçerli işlem tarihi, ileri vade, spot, strike, faiz ve gün bazı gerekli.'
    : md.manualVol && !manualAvailable ? 'Manuel volatilite geçersiz.'
    : !finitePrices && (md.manualVol || autoAvailable) ? 'Model sonlu ve geçerli bir prim üretemedi; girdileri kontrol edin.'
    : !surface ? 'Smile verisi yok — opsiyon zincirini yenileyin veya manuel vol girin.'
    : smileEstimate.reason ?? 'Bu strike/vade için güvenilir vol türetilemiyor.';
  const gr = greeks(pricingSpot, md.strike, tYears, md.rate / 100, md.lease / 100, effVol / 100, md.basis);
  return { dateValid, daysToExpiry, tYears, fwd, pricingSpot, smileEstimate, smileIv, numericInputsValid,
    effVol, result, gr, autoAvailable, priceable, unpriceableReason };
}
