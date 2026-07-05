export function normCDF(x: number): number {
  let e = Math.abs(x), c = 0;
  if(e > 37){ c = 0; }
  else {
    const ex = Math.exp(-e*e/2);
    if(e < 7.07106781186547){
      let b = 3.52624965998911e-2*e + 0.700383064443688;
      b = b*e + 6.37396220353165;  b = b*e + 33.912866078383;
      b = b*e + 112.079291497871;  b = b*e + 221.213596169931;
      b = b*e + 220.206867912376;
      c = ex*b;
      b = 8.83883476483184e-2*e + 1.75566716318264;
      b = b*e + 16.064177579207;   b = b*e + 86.7807322029461;
      b = b*e + 296.564248779674;  b = b*e + 637.333633378831;
      b = b*e + 793.826512519948;  b = b*e + 440.413735824752;
      c = c/b;
    } else {
      let b = e + 0.65; b = e + 4/b; b = e + 3/b; b = e + 2/b; b = e + 1/b;
      c = ex/b/2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

export function normPDF(x: number): number {
  return Math.exp(-0.5*x*x)/2.5066282746310002;
}

export interface GKResult {
  d1: number; d2: number; Nd1: number; Nd2: number;
  call: number; put: number; dfR: number; dfQ: number;
  fwd: number; sigT: number; nd1: number;
  T: number; S: number; K: number; r: number; q: number; v: number;
}

export function gk(S: number, K: number, T: number, r: number, q: number, v: number): GKResult {
  if(T <= 0 || v <= 0 || S <= 0 || K <= 0){
    const cI = Math.max(S-K, 0), pI = Math.max(K-S, 0);
    return {
      d1: NaN, d2: NaN, Nd1: NaN, Nd2: NaN,
      call: cI, put: pI, dfR: 1, dfQ: 1,
      fwd: S, sigT: 0, nd1: 0, T, S, K, r, q, v
    };
  }
  const sigT = v * Math.sqrt(T);
  const d1 = (Math.log(S/K) + (r - q + v*v/2)*T) / sigT;
  const d2 = d1 - sigT;
  const dfR = Math.exp(-r*T), dfQ = Math.exp(-q*T);
  const Nd1 = normCDF(d1), Nd2 = normCDF(d2);
  const call = S*dfQ*Nd1 - K*dfR*Nd2;
  const put  = K*dfR*normCDF(-d2) - S*dfQ*normCDF(-d1);
  
  return {
    d1, d2, Nd1, Nd2, call, put, dfR, dfQ,
    fwd: S*Math.exp((r-q)*T), sigT, nd1: normPDF(d1), T, S, K, r, q, v
  };
}
