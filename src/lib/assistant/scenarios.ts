import { gk } from '../math';
import { calculatePricing } from '../pricing/engine';
import type { VolSurface } from '../vol/surface';
import type { Quote, ScenarioResult } from './types';
import { bankHedgeFor } from './pricing';

export function scenarioPortfolio(
  label: string,
  quotes: Quote[],
  horizon: 'expiry' | 'now',
  entryPremiums: (number | undefined)[] = [],
  surface?: VolSurface | null,
): ScenarioResult {
  if (!quotes.length || quotes.length > 8) throw new Error('Karşılaştırma için bir ila sekiz bacak gerekli.');
  const product = quotes[0].product,
    spot = quotes[0].inputs.spot;
  if (quotes.some(q => q.product !== product || q.inputs.spot !== spot))
    throw new Error('Tek grafikte aynı dayanak ve spot kullanılmalı; farklı ürünleri ayrı karşılaştırın.');
  if (quotes.some(q => q.barrier))
    throw new Error(
      'Bariyerli portföy senaryosu geçmiş bariyer gözlemi gerektirir. Bu araç yalnız vanilya bacakları destekler.',
    );
  if (quotes.some(q => q.inputs.manualVol || q.volMode === 'manual' || q.spotSource === 'Manuel varsayım'))
    throw new Error('Manuel fiyatlar senaryoda kullanılmaz; terminal eğrisiyle fiyatlama tutarlılığını bozar.');
  if (horizon === 'now' && (!surface || quotes.some(q => q.surfaceAt !== surface.fetchedISO)))
    throw new Error('Bugünkü senaryo için fiyatlarla aynı terminal eğrisi gerekli; manuel IV kullanılmaz.');
  if (horizon === 'expiry' && quotes.some(q => q.inputs.expiryDate !== quotes[0].inputs.expiryDate))
    throw new Error(
      'Vade sonu grafiği için bütün bacakların vadesi aynı olmalı. Farklı vadeler için bugünkü model senaryosunu kullanın.',
    );
  if (quotes.some(q => q.inputs.tradeDate !== quotes[0].inputs.tradeDate))
    throw new Error('Portföyün bütün bacakları aynı değerleme tarihini kullanmalı.');
  const sum = (key: 'delta' | 'gamma' | 'vega' | 'theta' | 'cashflow') => quotes.reduce((s, q) => s + q[key], 0);
  const points = Array.from({ length: 21 }, (_, i) => {
    const movePct = -20 + i * 2,
      s = spot * (1 + movePct / 100);
    let pnl = 0;
    quotes.forEach((q, index) => {
      const p = q.inputs,
        sign = q.position === 'Long' ? 1 : -1;
      const shocked = horizon === 'now' ? calculatePricing({ ...p, spot: s, manualVol: false }, surface!) : null;
      if (shocked && !shocked.priceable)
        throw new Error(
          'Terminal eğrisi bu spot senaryosunu desteklemiyor. Manuel IV kullanılmaz; karşılaştırma durduruldu.',
        );
      const result = shocked ? shocked.result : gk(s, p.strike, 0, p.rate / 100, p.lease / 100, q.effectiveVol / 100);
      const mark = q.type === 'Call' ? result.call : result.put;
      const entry = entryPremiums[index] ?? q.premiumPerUnit;
      pnl += sign * (mark - entry) * p.contractSize;
    });
    if (!Number.isFinite(pnl)) throw new Error('Motor senaryoda geçerli sonuç üretemedi.');
    return { movePct, spot: s, pnl };
  });
  return {
    label,
    quotes,
    product,
    horizon,
    netCashflow: sum('cashflow'),
    delta: sum('delta'),
    gamma: sum('gamma'),
    vega: sum('vega'),
    theta: sum('theta'),
    bankHedge: bankHedgeFor(sum('delta'), sum('gamma')),
    points,
    note:
      (horizon === 'expiry'
        ? 'Vade sonu ödeme ve prim hesabı. Başlangıç primi belirtilmediyse bu hesap anındaki model primi esas alınır.'
        : 'Bugünkü kalan vadede spot şoku; her noktada IV aynı terminal eğrisinden yeniden sorgulanır. Eğri ve eğrinin faiz/kira bilgisi değiştirilmez; başlangıç primi belirtilmediyse mevcut model primi esas alınır.') +
      ' Net model primi bütün bacakların şu anki fiyatlarıyla hesaplanır; geçmiş tahsilat/ödeme değildir.',
  };
}
