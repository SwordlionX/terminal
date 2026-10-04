export interface FactorNode {
  at: string;
  value: number;
}
export interface PricingCurves {
  version: 2;
  id: string;
  asOf: string;
  method: 'CME-SOFR-indicative-proxy';
  usd: FactorNode[];
  metal: FactorNode[];
  referenceSpot: { price: number; at: string; source: string };
  warnings: string[];
}

/** Positive factors, log interpolation, strictly bounded source coverage. */
export function factorAt(nodes: FactorNode[], at: number): number | null {
  if (!Number.isFinite(at) || nodes.length < 2) return null;
  if (
    nodes.some(
      (n, i) =>
        !Number.isFinite(Date.parse(n.at)) ||
        !Number.isFinite(n.value) ||
        n.value <= 0 ||
        (i > 0 && Date.parse(n.at) <= Date.parse(nodes[i - 1].at)),
    )
  )
    return null;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i],
      ta = Date.parse(a.at);
    if (!Number.isFinite(ta) || !(a.value > 0) || !Number.isFinite(a.value)) return null;
    if (at === ta) return a.value;
    const b = nodes[i + 1];
    if (!b) continue;
    const tb = Date.parse(b.at);
    if (!(tb > ta) || !(b.value > 0) || !Number.isFinite(b.value)) return null;
    if (at > ta && at < tb) return Math.exp(Math.log(a.value) + ((at - ta) / (tb - ta)) * Math.log(b.value / a.value));
  }
  return null;
}

export function curveFactors(curve: PricingCurves, from: number, to: number) {
  if (!(to > from) || curve.version !== 2) throw new Error('Geçerli vade ve eğri sürümü gerekli.');
  const d0 = factorAt(curve.usd, from),
    d1 = factorAt(curve.usd, to);
  const q0 = factorAt(curve.metal, from),
    q1 = factorAt(curve.metal, to);
  if (d0 == null || d1 == null || q0 == null || q1 == null)
    throw new Error('İşlem tarihi/vade faiz veya taşıma eğrisinin veri aralığı dışında.');
  const discount = d1 / d0,
    metal = q1 / q0,
    years365 = (to - from) / (365 * 86400000);
  return {
    discount,
    metal,
    forwardRatio: metal / discount,
    rate365: -Math.log(discount) / years365,
    lease365: -Math.log(metal) / years365,
  };
}
