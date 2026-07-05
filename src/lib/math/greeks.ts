import { gk, normCDF, GKResult } from './gk';

export interface GreeksResult {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  charm: number;
  vanna: number;
  vomma: number;
  speed: number;
  color: number;
  ultima: number;
}

export function greeks(S: number, K: number, T: number, r: number, q: number, v: number, basis: number = 365) {
  const g = gk(S, K, T, r, q, v);
  if (!isFinite(g.d1)) return null;

  const { d1, d2, dfR, dfQ, nd1, Nd1, Nd2 } = g;
  const sqrtT = Math.sqrt(T);
  const Nmd1 = normCDF(-d1);
  const Nmd2 = normCDF(-d2);

  const deltaC = dfQ * Nd1;
  const deltaP = dfQ * (Nd1 - 1);
  const gamma  = dfQ * nd1 / (S * v * sqrtT);
  const vega   = S * dfQ * nd1 * sqrtT;
  const thetaC = (-S * dfQ * nd1 * v / (2 * sqrtT) + q * S * dfQ * Nd1 - r * K * dfR * Nd2);
  const thetaP = (-S * dfQ * nd1 * v / (2 * sqrtT) - q * S * dfQ * Nmd1 + r * K * dfR * Nmd2);
  const rhoC   = K * T * dfR * Nd2;
  const rhoP   = -K * T * dfR * Nmd2;
  const vanna  = -dfQ * nd1 * d2 / v;
  const vomma  = vega * d1 * d2 / v;
  const charmC = q * dfQ * Nd1 - dfQ * nd1 * (2 * (r - q) * T - d2 * v * sqrtT) / (2 * T * v * sqrtT);
  const charmP = -q * dfQ * Nmd1 - dfQ * nd1 * (2 * (r - q) * T - d2 * v * sqrtT) / (2 * T * v * sqrtT);
  const speed  = -gamma / S * (d1 / (v * sqrtT) + 1);
  const color  = -dfQ * nd1 / (2 * S * T * v * sqrtT) * (2 * q * T + 1 + (2 * (r - q) * T - d2 * v * sqrtT) / (v * sqrtT) * d1);
  const ultima = -vega / (v * v) * (d1 * d2 * (1 - d1 * d2) + d1 * d1 + d2 * d2);

  return {
    call: {
      delta: deltaC, gamma, theta: thetaC / basis, vega: vega / 100, rho: rhoC / 100,
      charm: charmC / basis, vanna: vanna / 100, vomma: vomma / 10000, speed, color: color / basis, ultima: ultima / 1e6
    } as GreeksResult,
    put: {
      delta: deltaP, gamma, theta: thetaP / basis, vega: vega / 100, rho: rhoP / 100,
      charm: charmP / basis, vanna: vanna / 100, vomma: vomma / 10000, speed, color: color / basis, ultima: ultima / 1e6
    } as GreeksResult,
    raw: g
  };
}
