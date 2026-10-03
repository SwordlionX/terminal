import type { MarketSnapshot, ScreenContext } from './types';

export const MANUAL_PRICING_BLOCKED = 'Manuel spot, volatilite, faiz veya kira varsayımı terminal eğrisiyle fiyatlama tutarlılığını bozar. Asistan manuel fiyatlama yapmaz; terminalin otomatik verisini ve mevcut eğrisini kullanır. Manuel spot/IV modunu kapatın.';
const marketOverrides = ['spot', 'vol', 'manualVol', 'manualSpot', 'rate', 'lease'];

/** Checked again at the pricing boundary, even when bypassing JSON validation. */
export function assertCurvePricing(request: unknown, screen: ScreenContext) {
  if (screen.manualSpot || screen.manualVol || (request && typeof request === 'object' &&
    marketOverrides.some(key => Object.prototype.hasOwnProperty.call(request, key)))) {
    throw new Error(MANUAL_PRICING_BLOCKED);
  }
}

export function terminalCurveInputs(screen: ScreenContext, market: MarketSnapshot) {
  assertCurvePricing({}, screen);
  if (market.spot == null || !Number.isFinite(market.spot) || market.spot <= 0)
    throw new Error('Terminalin spot verisi alınamadı. Dışarıdan fiyat aranmaz; fiyatlama durduruldu.');
  if (!market.surface) throw new Error('Terminalin volatilite eğrisi yok. Manuel veya dış veri kullanılmaz; fiyatlama durduruldu.');
  const { builtWithR, impliedLeaseRate } = market.surface;
  if (builtWithR == null || !Number.isFinite(builtWithR) || impliedLeaseRate == null || !Number.isFinite(impliedLeaseRate))
    throw new Error('Terminal eğrisinin faiz/kira bilgisi eksik. Manuel varsayımla tamamlanmaz; fiyatlama durduruldu.');
  return { spot: market.spot, rate: builtWithR * 100, lease: impliedLeaseRate * 100,
    vol: 0, manualVol: false as const };
}
