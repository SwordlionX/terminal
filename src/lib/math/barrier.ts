import { gk, normCDF } from './gk';

export function barVanilla(S: number, K: number, T: number, r: number, q: number, v: number, cp: string) {
  const g = gk(S, K, T, r, q, v);
  return cp === 'c' ? g.call : g.put;
}

export function barrierKO(S: number, K: number, H: number, R: number, T: number, r: number, q: number, v: number, kind: string) {
  const isUp = kind[1] === 'u';
  if (isUp && S >= H) return R;
  if (!isUp && S <= H) return R;
  if (T <= 0 || v <= 0) {
    return kind[0] === 'c' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  const b = r - q;
  const sT = v * Math.sqrt(T);
  const mu = (b - v * v / 2) / (v * v);
  const lam = Math.sqrt(mu * mu + 2 * r / (v * v));
  const er = Math.exp(-r * T), eb = Math.exp(-q * T);
  const x1 = Math.log(S / K) / sT + (1 + mu) * sT;
  const x2 = Math.log(S / H) / sT + (1 + mu) * sT;
  const y1 = Math.log(H * H / (S * K)) / sT + (1 + mu) * sT;
  const y2 = Math.log(H / S) / sT + (1 + mu) * sT;
  const z = Math.log(H / S) / sT + lam * sT;

  const mp: Record<string, [number, number]> = { cdo: [1, 1], cuo: [1, -1], pdo: [-1, 1], puo: [-1, -1] };
  const params = mp[kind];
  if (!params) return 0;

  const phi = params[0], eta = params[1], HS = H / S;
  const A = phi * S * eb * normCDF(phi * x1) - phi * K * er * normCDF(phi * x1 - phi * sT);
  const B = phi * S * eb * normCDF(phi * x2) - phi * K * er * normCDF(phi * x2 - phi * sT);
  const C = phi * S * eb * Math.pow(HS, 2 * (mu + 1)) * normCDF(eta * y1) - phi * K * er * Math.pow(HS, 2 * mu) * normCDF(eta * y1 - eta * sT);
  const D = phi * S * eb * Math.pow(HS, 2 * (mu + 1)) * normCDF(eta * y2) - phi * K * er * Math.pow(HS, 2 * mu) * normCDF(eta * y2 - eta * sT);
  const F = R * (Math.pow(HS, mu + lam) * normCDF(eta * z) + Math.pow(HS, mu - lam) * normCDF(eta * z - 2 * eta * lam * sT));
  const HleK = H <= K;
  let val = 0;
  switch (kind) {
    case 'cdo': val = HleK ? A - C + F : B - D + F; break;
    case 'cuo': val = HleK ? F : A - B + C - D + F; break;
    case 'pdo': val = HleK ? A - B + C - D + F : F; break;
    case 'puo': val = HleK ? B - D + F : A - C + F; break;
  }
  return Math.max(val, 0);
}

/**
 * Knock-in rebate — Reiner-Rubinstein "E" terimi: opsiyon vade boyunca hiç
 * knock-in OLMAZSA vade sonunda ödenen R nakdi. (Knock-out'un rebate'i "F"
 * bariyere değince ödenir ve barrierKO içinde; bu terim in-opsiyonlara özgü.)
 * eta: down-in = +1, up-in = -1.
 */
function knockInRebate(S: number, H: number, R: number, T: number, r: number, q: number, v: number, isUp: boolean): number {
  if (R === 0 || T <= 0 || v <= 0) return 0;
  if (isUp && S >= H) return 0;   // zaten tetiklendi → in-rebate yok
  if (!isUp && S <= H) return 0;
  const b = r - q;
  const sT = v * Math.sqrt(T);
  const mu = (b - v * v / 2) / (v * v);
  const eta = isUp ? -1 : 1;
  const x2 = Math.log(S / H) / sT + (1 + mu) * sT;
  const y2 = Math.log(H / S) / sT + (1 + mu) * sT;
  const HS = H / S;
  return R * Math.exp(-r * T) * (
    normCDF(eta * x2 - eta * sT) - Math.pow(HS, 2 * mu) * normCDF(eta * y2 - eta * sT)
  );
}

export function barrierPrice(S: number, K: number, H: number, R: number, T: number, r: number, q: number, v: number, code: string) {
  if (code[2] === 'o') return barrierKO(S, K, H, R, T, r, q, v, code);
  const cp = code[0], isUp = code[1] === 'u';
  const van = barVanilla(S, K, T, r, q, v, cp);
  if (isUp && S >= H) return van;   // zaten knock-in oldu → vanilla (rebate anlamsız)
  if (!isUp && S <= H) return van;
  const koKind = code[0] + code[1] + 'o';
  // in-out paritesi (R=0) + knock-in'e özgü vade-sonu rebate'i
  const inVal = Math.max(van - barrierKO(S, K, H, 0, T, r, q, v, koKind), 0);
  return inVal + knockInRebate(S, H, R, T, r, q, v, isUp);
}

export function barrierGreeks(S: number, K: number, H: number, R: number, T: number, r: number, q: number, v: number, code: string, basis: number = 365) {
  const hS = S * 0.001, dv = 0.005, dt = 1 / basis;
  const p = barrierPrice(S, K, H, R, T, r, q, v, code);
  const pu = barrierPrice(S + hS, K, H, R, T, r, q, v, code);
  const pd = barrierPrice(S - hS, K, H, R, T, r, q, v, code);
  return {
    price: p,
    delta: (pu - pd) / (2 * hS),
    gamma: (pu - 2 * p + pd) / (hS * hS),
    vega: (barrierPrice(S, K, H, R, T, r, q, v + dv, code) - barrierPrice(S, K, H, R, T, r, q, v - dv, code)) / (2 * dv) / 100,
    theta: (barrierPrice(S, K, H, R, Math.max(T - dt, 1e-8), r, q, v, code) - p)
  };
}

/**
 * Bariyer opsiyonundan IV (Newton). DİKKAT: bariyer fiyatı vol'de MONOTON DEĞİLDİR
 * (ör. up-and-out call vega'sı negatife dönebilir) → kök tek olmayabilir ya da Newton
 * yakınsamayabilir. Bu durumda `ok:false` döner; çağıran taraf o zaman IV'yi
 * göstermemeli, "türetilemedi" mesajı basmalıdır.
 */
export function barrierIV(S: number, K: number, H: number, R: number, T: number, r: number, q: number, price: number, code: string) {
  let v = 0.25;
  for (let i = 1; i <= 100; i++) {
    const p = barrierPrice(S, K, H, R, T, r, q, v, code);
    const vega = (barrierPrice(S, K, H, R, T, r, q, v + 1e-4, code) - p) / 1e-4;
    const e = p - price;
    if (Math.abs(e) < 1e-8) return { vol: v, it: i, ok: true };
    if (Math.abs(vega) < 1e-10) break;
    v -= e / vega;
    if (v < 1e-4) v = 1e-4;
    if (v > 5) v = 5;
  }
  return { vol: v, it: 100, ok: false };
}
