import { gk } from './gk';

export function impliedVol(S: number, K: number, T: number, r: number, q: number, price: number, type: 'call' | 'put') {
  let v = 0.2, iter = 0, err = NaN;
  const tol = 1e-8;
  const maxIter = 100;
  if (price <= 0 || T <= 0) return { vol: NaN, iter: 0, err: NaN, ok: false };

  for (iter = 1; iter <= maxIter; iter++) {
    const g = gk(S, K, T, r, q, v);
    const mdl = (type === 'call') ? g.call : g.put;
    const vega = S * g.dfQ * g.nd1 * Math.sqrt(T);
    err = mdl - price;
    if (Math.abs(err) < tol) return { vol: v, iter, err, ok: true };
    if (vega < 1e-12) break;
    v = v - err / vega;
    if (v < 1e-6) v = 1e-6;
    if (v > 5) v = 5;
  }

  if (Math.abs(err) < 1e-4) return { vol: v, iter, err, ok: true };

  // Bisection fallback if Newton fails
  let lo = 1e-6, hi = 5;
  const f = (vv: number) => {
    const gg = gk(S, K, T, r, q, vv);
    return ((type === 'call') ? gg.call : gg.put) - price;
  };
  
  let flo = f(lo), fhi = f(hi);
  if (isFinite(flo) && isFinite(fhi) && flo * fhi < 0) {
    for (let j = 0; j < 200; j++) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if (Math.abs(fm) < 1e-8) return { vol: mid, iter: iter + j, err: fm, ok: true };
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    const vm = (lo + hi) / 2, em = f(vm);
    return { vol: vm, iter: iter + 200, err: em, ok: Math.abs(em) < 1e-4 };
  }

  return { vol: v, iter, err, ok: false };
}

export function volForDelta(S: number, K: number, T: number, r: number, q: number, targetDelta: number, type: 'call' | 'put') {
  let v = 0.2;
  const tol = 1e-8;
  for (let i = 1; i <= 100; i++) {
    const g = gk(S, K, T, r, q, v);
    const delta = (type === 'call') ? g.dfQ * g.Nd1 : g.dfQ * (g.Nd1 - 1);
    const vanna = -g.dfQ * g.nd1 * g.d2 / v;
    const err = delta - targetDelta;
    if (Math.abs(err) < tol) return { vol: v, iter: i, ok: true };
    if (Math.abs(vanna) < 1e-12) break;
    v = v - err / vanna;
    if (v < 1e-6) v = 1e-6;
    if (v > 5) v = 5;
  }
  return { vol: v, iter: 100, ok: false };
}
