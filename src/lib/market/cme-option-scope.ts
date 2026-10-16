/** Shared with the surface builder so validation cannot silently widen its maturity range. */
export const MAX_CME_SURFACE_DAYS = 400;

export function cmeOptionDays(expSec: number, evalSec: number): number {
  if (!Number.isFinite(expSec) || !Number.isFinite(evalSec)) throw new Error('Opsiyon değerleme/vade zamanı geçersiz');
  return Math.round(((expSec - evalSec) / 86400) * 10) / 10;
}

export function optionMaturityExclusion(expSec: number, evalSec: number): 'short_or_expired' | 'beyond_horizon' | null {
  const days = cmeOptionDays(expSec, evalSec);
  return days < 1 ? 'short_or_expired' : days > MAX_CME_SURFACE_DAYS ? 'beyond_horizon' : null;
}
