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

interface ParsedNodes {
  length: number;
  times: number[];
  logs: number[];
}
// Curves are immutable once built; parse and validate each node array once instead of per lookup.
const parsedNodes = new WeakMap<FactorNode[], ParsedNodes | null>();

function parse(nodes: FactorNode[]): ParsedNodes | null {
  const cached = parsedNodes.get(nodes);
  if (cached !== undefined && (cached === null || cached.length === nodes.length)) return cached;
  const times: number[] = [],
    logs: number[] = [];
  let valid = true;
  for (let i = 0; i < nodes.length; i++) {
    const t = Date.parse(nodes[i].at),
      v = nodes[i].value;
    if (!Number.isFinite(t) || !Number.isFinite(v) || v <= 0 || (i > 0 && t <= times[i - 1])) {
      valid = false;
      break;
    }
    times.push(t);
    logs.push(Math.log(v));
  }
  const result = valid ? { length: nodes.length, times, logs } : null;
  parsedNodes.set(nodes, result);
  return result;
}

/** Positive factors, log interpolation, strictly bounded source coverage. */
export function factorAt(nodes: FactorNode[], at: number): number | null {
  if (!Number.isFinite(at) || nodes.length < 2) return null;
  const parsed = parse(nodes);
  if (!parsed) return null;
  const { times, logs } = parsed;
  if (at < times[0] || at > times[times.length - 1]) return null;
  let lo = 0,
    hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= at) lo = mid;
    else hi = mid;
  }
  if (at === times[lo]) return nodes[lo].value;
  if (at === times[hi]) return nodes[hi].value;
  return Math.exp(logs[lo] + ((at - times[lo]) / (times[hi] - times[lo])) * (logs[hi] - logs[lo]));
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
