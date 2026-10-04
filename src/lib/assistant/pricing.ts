import { calculatePricing, dateDay, type PricingInputs } from '../pricing/engine';
import { priceBarrier } from '../pricing/barrier';
import { surfaceVolEstimate } from '../vol/surface';
import { assertCurvePricing, terminalCurveInputs } from './policy';
import type { MarketSnapshot, OptionRequest, Quote, ScreenContext } from './types';

/** No HTTP, browser, research, customer database or external price arguments here. */
export function quoteOption(request: OptionRequest, screen: ScreenContext, market: MarketSnapshot): Quote {
  assertCurvePricing(request, screen);
  const product = request.product ?? screen.product;
  if (product !== 'XAU' && product !== 'XAG') throw new Error('Bu terminalde yalnız XAU veya XAG seçilmeli.');
  if (product !== market.product) throw new Error('Piyasa verisi farklı bir ürüne ait.');
  const same = product === screen.product;
  const curve = terminalCurveInputs(screen, market);
  const { spot } = curve;
  const inputs: PricingInputs = {
    ...curve, strike: request.strike ?? (same ? screen.strike : spot),
    contractSize: request.contractSize ?? screen.contractSize, basis: request.basis ?? screen.basis,
    tradeDate: request.tradeDate ?? screen.tradeDate, expiryDate: request.expiryDate ?? screen.expiryDate,
  };
  const p = calculatePricing(inputs, market.surface);
  if (!p.priceable) throw new Error(p.unpriceableReason ?? 'Terminal motoru bu girdiyi fiyatlayamıyor.');
  const sign = request.position === 'Long' ? 1 : -1;
  let premiumPerUnit = request.type === 'Call' ? p.result.call : p.result.put;
  let gr = request.type === 'Call' ? p.gr?.call : p.gr?.put;
  const warnings: string[] = [];
  let model = 'Terminal X · Avrupa / GK';
  if (request.barrier) {
    const { variant, level, rebate = 0 } = request.barrier;
    if (!(level > 0) || !Number.isFinite(level) || rebate < 0 || !Number.isFinite(rebate)) throw new Error('Bariyer veya rebate geçersiz.');
    const estimate = (k: number) => surfaceVolEstimate(market.surface!, k / p.fwd, p.daysToExpiry, inputs.tradeDate);
    const result = priceBarrier({ spot, strike: inputs.strike, tYears: p.tYears, rate: inputs.rate,
      lease: inputs.lease, vol: p.effVol,
      ...{ volAtLevel: (k: number) => {
        const e = estimate(k); return e.vol == null ? null : e.vol * 100;
      }, volModeAtLevel: (k: number) => estimate(k).mode },
    }, { variant, barrierH: level, rebateR: rebate });
    const leg = request.type === 'Call' ? result.call : result.put;
    premiumPerUnit = leg.price;
    gr = { ...p.gr![request.type === 'Call' ? 'call' : 'put'], ...leg.greeks };
    model = leg.vv ? 'Terminal X · Bariyer / Vanna–Volga' : 'Terminal X · Bariyer / tek IV';
    warnings.push('Sürekli gözlemli yeni bariyer fiyatı; geçmişte bariyere değme bilgisi bu hesapta yok.');
    if (!leg.vv) warnings.push('Vanna–Volga kurulamadı; mevcut motorun eğriden aldığı tek IV kullanıldı. Manuel IV kullanılmadı.');
    if (result.smileModes.includes('extrapolated')) warnings.push('Bariyer hesabındaki yardımcı IV sorgusunda model uzatması kullanıldı.');
    if (result.nearBarrier) warnings.push('Bariyere yakın: Delta ve Gamma hassas.');
    if (result.knockedOut) warnings.push('Spot knock-out bariyerini geçmiş; değer rebate ile sınırlı.');
  }
  if (!gr || ![premiumPerUnit, gr.delta, gr.gamma, gr.vega, gr.theta].every(Number.isFinite) || premiumPerUnit < 0)
    throw new Error('Terminal motoru geçerli fiyat/risk sonucu üretemedi.');
  const premiumTotal = premiumPerUnit * inputs.contractSize;
  if (!Number.isFinite(premiumTotal)) throw new Error('Toplam prim sayı sınırını aşıyor.');
  if (market.spotStale) warnings.push('Spot yenilenemedi; terminalin süresi geçmiş önbellek fiyatı kullanıldı. Veri tarihini kontrol edin.');
  if (p.smileEstimate.mode === 'extrapolated') warnings.push('IV, sınırlı SSVI model uzatmasından geliyor.');
  if (market.surface) {
    const age = (dateDay(inputs.tradeDate) - dateDay(market.surface.fetchedISO.slice(0, 10))) / 86400000;
    if (age > 1) warnings.push(`Yüzey verisi değerleme tarihinden ${age} gün önce; tarih güncellemesi yeni piyasa verisi üretmez.`);
  }
  const delta = sign * gr.delta * inputs.contractSize;
  return {
    id: [product, request.type, request.position, inputs.strike, inputs.expiryDate, request.barrier?.variant ?? 'vanilla', request.barrier?.level ?? ''].join('-'),
    product, type: request.type, position: request.position, inputs, barrier: request.barrier,
    premiumPerUnit, premiumTotal, premiumPctSpot: premiumPerUnit / spot * 100,
    premiumPctStrike: premiumPerUnit / inputs.strike * 100, cashflow: -sign * premiumTotal,
    delta, gamma: sign * gr.gamma * inputs.contractSize, vega: sign * gr.vega * inputs.contractSize,
    theta: sign * gr.theta * inputs.contractSize, hedgeUnits: -delta,
    effectiveVol: p.effVol, volMode: p.smileEstimate.mode,
    model, spotSource: market.spotSource,
    spotAt: market.spotAt, surfaceAt: market.surface?.fetchedISO ?? null,
    pricedAt: new Date().toISOString(), warnings,
  };
}
