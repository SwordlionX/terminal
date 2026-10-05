import type { PremiumUnit, Quote, SearchResult } from './types';

export function premiumValue(q: Quote, unit: PremiumUnit): number {
  return unit === 'usd_per_unit'
    ? q.premiumPerUnit
    : unit === 'total_usd'
      ? q.premiumTotal
      : unit === 'pct_spot'
        ? q.premiumPctSpot
        : q.premiumPctStrike;
}

/** Multiple brackets, no monotonicity assumption; unavailable gaps never bridged. */
export function searchPremium(
  price: (value: number) => Quote,
  target: number,
  unit: PremiumUnit,
  minStrike: number,
  maxStrike: number,
  tolerance: number,
  /** The searched variable as read back from a quote: the strike, or the barrier level. */
  variableOf: (quote: Quote) => number = q => q.inputs.strike,
): SearchResult {
  if (
    ![target, minStrike, maxStrike, tolerance].every(Number.isFinite) ||
    target < 0 ||
    minStrike <= 0 ||
    maxStrike <= minStrike ||
    tolerance <= 0
  )
    throw new Error('Hedef prim veya arama aralığı geçersiz.');
  const cache = new Map<number, { quote: Quote; actual: number; error: number } | null>();
  let unavailable = 0;
  const evaluate = (k: number) => {
    if (cache.has(k)) return cache.get(k)!;
    if (cache.size >= 320) return null;
    let v = null;
    try {
      const quote = price(k),
        actual = premiumValue(quote, unit),
        error = actual - target;
      if (!Number.isFinite(actual)) throw new Error('Geçersiz prim.');
      v = { quote, actual, error };
    } catch {
      unavailable++;
    }
    cache.set(k, v);
    return v;
  };
  const candidates: SearchResult['candidates'] = [];
  const add = (v: NonNullable<ReturnType<typeof evaluate>>) => {
    if (
      Math.abs(v.error) <= tolerance &&
      !candidates.some(
        c => Math.abs(variableOf(c.quote) - variableOf(v.quote)) < Math.max(1e-8, variableOf(v.quote) * 1e-6),
      )
    )
      candidates.push(v);
  };
  const grid = Array.from({ length: 61 }, (_, i) => evaluate(minStrike + ((maxStrike - minStrike) * i) / 60));
  for (const v of grid) if (v) add(v);
  for (let i = 1; i < grid.length && candidates.length < 12; i++) {
    const a = grid[i - 1],
      b = grid[i];
    if (!a || !b || a.error * b.error >= 0) continue;
    let lo = variableOf(a.quote),
      hi = variableOf(b.quote),
      loError = a.error;
    for (let j = 0; j < 40; j++) {
      const mid = (lo + hi) / 2,
        v = evaluate(mid);
      if (!v) break;
      if (Math.abs(v.error) <= tolerance) {
        add(v);
        break;
      }
      if (loError * v.error < 0) hi = mid;
      else {
        lo = mid;
        loError = v.error;
      }
    }
  }
  const valid = [...cache.values()].filter((v): v is NonNullable<typeof v> => v !== null);
  valid.sort((a, b) => Math.abs(a.error) - Math.abs(b.error));
  candidates.sort((a, b) => Math.abs(a.error) - Math.abs(b.error));
  return {
    target,
    unit,
    tolerance,
    reached: candidates.length > 0,
    candidates: candidates.slice(0, 5),
    nearest: valid[0] ?? null,
    evaluations: cache.size,
    unavailable,
  };
}
