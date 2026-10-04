import type { CarrySnapshot, CurveRoot } from './cme-carry';
import { factorAt, type PricingCurves, type FactorNode } from './factors';
import type { SofrProjection } from './sofr';

export function buildProxyCurves(snapshot: CarrySnapshot, root: Extract<CurveRoot, 'GC' | 'SI'>,
  usd: SofrProjection, referenceSpot: PricingCurves['referenceSpot'], id: string): PricingCurves {
  const asOf = Date.parse(referenceSpot.at);
  if (referenceSpot.at.slice(0, 10) !== snapshot.sessionDate || usd.asOfDate !== snapshot.sessionDate ||
      !Number.isFinite(referenceSpot.price) || referenceSpot.price <= 0 || !Number.isFinite(asOf))
    throw new Error('Spot, faiz ve futures aynı settlement seansından olmalı.');
  const anchor = factorAt(usd.nodes, asOf);
  if (anchor == null) throw new Error('Spot saatinde USD iskonto faktörü yok.');
  const funding = [{ at: referenceSpot.at, value: 1 }, ...usd.nodes.filter(n => Date.parse(n.at) > asOf).map(n => ({ at: n.at, value: n.value / anchor }))];
  const metal: FactorNode[] = [{ at: referenceSpot.at, value: 1 }];
  for (const node of snapshot.products[root].nodes) {
    const t = Date.parse(node.lastTradeTime), discount = factorAt(funding, t);
    if (t <= asOf || discount == null) continue;
    if (!(node.flags & 1) || (node.flags & 12)) throw new Error('Metal futures final/clearing settlement değil.');
    const value = discount * node.settlement / referenceSpot.price;
    if (!Number.isFinite(value) || value <= 0) throw new Error('Metal faktörü geçersiz.');
    const previous = metal.at(-1)!;
    if (previous.at === node.lastTradeTime) {
      if (Math.abs(previous.value - value) > 1e-12) throw new Error('Aynı vadede metal fiyatları çelişiyor.');
      continue;
    }
    metal.push({ at: node.lastTradeTime, value });
  }
  if (metal.length < 3) throw new Error('Metal taşıma eğrisinin kapsamı yetersiz.');
  return { version: 2, id, asOf: referenceSpot.at, method: 'CME-SOFR-indicative-proxy', usd: funding, metal,
    referenceSpot, warnings: [...usd.warnings,
      'Metal taşıması final CME futures + aynı settlement saatine yakın Tiingo spotundan türetilir; banka metal kira kotasyonu değildir.',
      'Futures son işlem tarihi vade proxy olarak kullanılır; OTC teslim valörü ve futures/forward baz farkı modellenmez.',
      'Gösterilen faiz/taşıma vade-eşdeğer oranlardır; manuel oran girilmez.'] };
}
