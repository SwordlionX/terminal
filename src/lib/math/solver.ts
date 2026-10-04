import { gk } from './gk';

export function impliedVol(S: number, K: number, T: number, r: number, q: number, price: number, type: 'call' | 'put') {
  const failure = { vol: NaN, iter: 0, err: NaN, ok: false };
  const tol = Math.min(1e-8, Math.max(1e-12, price * 1e-6));
  if (
    ![S, K, T, r, q, price].every(Number.isFinite) ||
    S <= 0 ||
    K <= 0 ||
    price <= 0 ||
    T <= 0 ||
    (type !== 'call' && type !== 'put')
  )
    return failure;

  // Positive volatility prices lie strictly between the zero-volatility
  // forward payoff and the discounted underlying/strike upper bound.
  const dfR = Math.exp(-r * T),
    dfQ = Math.exp(-q * T);
  const upper = type === 'call' ? S * dfQ : K * dfR;
  const lower = type === 'call' ? Math.max(S * dfQ - K * dfR, 0) : Math.max(K * dfR - S * dfQ, 0);
  if (!Number.isFinite(upper) || !Number.isFinite(lower) || price <= lower + 1e-10 || price >= upper) return failure;

  let lo = 0,
    hi = 5;
  const f = (vv: number) => {
    const gg = gk(S, K, T, r, q, vv);
    return (type === 'call' ? gg.call : gg.put) - price;
  };
  const flo = f(lo),
    fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo >= 0 || fhi < 0) return failure;
  if (Math.abs(fhi) <= tol) return { vol: hi, iter: 0, err: fhi, ok: true };

  for (let iter = 1; iter <= 80; iter++) {
    const mid = (lo + hi) / 2;
    const err = f(mid);
    if (!Number.isFinite(err)) return failure;
    if (Math.abs(err) <= tol) return { vol: mid, iter, err, ok: true };
    if (err < 0) lo = mid;
    else hi = mid;
  }
  const vol = (lo + hi) / 2,
    err = f(vol);
  return Number.isFinite(err) && Math.abs(err) <= tol
    ? { vol, iter: 80, err, ok: true }
    : { vol: NaN, iter: 80, err, ok: false };
}

export function volForDelta(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  targetDelta: number,
  type: 'call' | 'put',
) {
  let v = 0.2;
  const tol = 1e-8;
  for (let i = 1; i <= 100; i++) {
    const g = gk(S, K, T, r, q, v);
    const delta = type === 'call' ? g.dfQ * g.Nd1 : g.dfQ * (g.Nd1 - 1);
    const vanna = (-g.dfQ * g.nd1 * g.d2) / v;
    const err = delta - targetDelta;
    if (Math.abs(err) < tol) return { vol: v, iter: i, ok: true };
    if (Math.abs(vanna) < 1e-12) break;
    v = v - err / vanna;
    if (v < 1e-6) v = 1e-6;
    if (v > 5) v = 5;
  }
  return { vol: v, iter: 100, ok: false };
}
