import { gk } from './gk';
import { barrierPrice } from './barrier';

/**
 * VANNA-VOLGA — bariyer opsiyonlarında smile (skew) düzeltmesi.
 *
 * Neden gerekli: Black-Scholes tek bir σ ile çalışır; bariyerli opsiyonun değeri ise hem
 * strike'ın hem de bariyer civarındaki oynaklığın fonksiyonudur. Tek vol kullanmak sistematik
 * hata verir. Vanna-Volga, FX/metal masalarının OTC bariyerlerde kullandığı piyasa standardı
 * düzeltmedir (Castagna-Mercurio; bariyerlerde hayatta-kalma ağırlığı için Wystup).
 *
 * Yöntem: egzotik opsiyonun vega/vanna/volga riskini, piyasada kote edilen ÜÇ vanilya
 * (25Δ put, ATM, 25Δ call) ile replike et. Bu üç vanilyanın "piyasa smile fiyatı" ile
 * "düz ATM vol fiyatı" farkı, egzotiğe replikasyon ağırlıklarıyla taşınır:
 *
 *   X_VV = X_BS(σ_ATM) + p · Σ wᵢ · [ Cᵢ(σᵢ) − Cᵢ(σ_ATM) ]
 *
 * p = hayatta kalma olasılığı (bariyere hiç değmeme). Bariyere değip iptal olan bir opsiyonun
 * smile düzeltmesini tam almaması gerekir; p bunu ölçekler.
 *
 * Bu modül barrier.ts'i DEĞİŞTİRMEZ — onu kara kutu olarak çağırır. Smile düz olduğunda
 * düzeltme tam olarak sıfırdır, yani mevcut davranışa indirgenir.
 */

/** Ters normal CDF (Acklam rasyonel yaklaşımı, |hata| ~1e-9). */
function normInv(p: number): number {
  if (p <= 0 || p >= 1) return NaN;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const pl = 0.02425, ph = 1 - pl;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > ph) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Vanilya vega / vanna / volga (ham birimler — ölçeklenmemiş). */
function vanillaRiskes(S: number, K: number, T: number, r: number, q: number, v: number) {
  const g = gk(S, K, T, r, q, v);
  const { d1, d2, dfQ, nd1 } = g;
  const vega = S * dfQ * nd1 * Math.sqrt(T);
  return { vega, vanna: -dfQ * nd1 * d2 / v, volga: vega * d1 * d2 / v };
}

/**
 * Verilen deltaya sahip strike (mutlak delta, ör. 0.25). type='c' call, 'p' put.
 * d1'den ters çözülür: K = S·exp(−d1·σ√T + (r−q+σ²/2)T)
 */
function strikeFromDelta(S: number, T: number, r: number, q: number, v: number,
                         absDelta: number, type: 'c' | 'p'): number {
  const dfQ = Math.exp(-q * T);
  // call: Δ = e^{-qT} N(d1) ; put: Δ = e^{-qT}(N(d1) − 1)
  const nd1 = type === 'c' ? absDelta / dfQ : 1 - absDelta / dfQ;
  if (!(nd1 > 0 && nd1 < 1)) return NaN;
  const d1 = normInv(nd1);
  return S * Math.exp(-d1 * v * Math.sqrt(T) + (r - q + v * v / 2) * T);
}

/**
 * Hayatta kalma olasılığı — bariyere vade boyunca HİÇ değmeme olasılığı (sürekli izleme).
 * Yansıma ilkesi (reflection principle) kapalı formu; risk-nötr ölçüde.
 */
export function survivalProbability(S: number, H: number, T: number, r: number, q: number,
                                    v: number, isUp: boolean): number {
  if (T <= 0 || v <= 0 || S <= 0 || H <= 0) return 0;
  if (isUp && S >= H) return 0;
  if (!isUp && S <= H) return 0;
  const nu = r - q - v * v / 2;
  const sT = v * Math.sqrt(T);
  const h = Math.log(H / S);
  const pow = Math.exp(2 * nu * h / (v * v));
  const cdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
  const p = isUp
    ? cdf((h - nu * T) / sT) - pow * cdf((-h - nu * T) / sT)
    : cdf((-h + nu * T) / sT) - pow * cdf((h + nu * T) / sT);
  return Math.min(Math.max(p, 0), 1);
}

/** erf — normCDF ile aynı yaklaşım ailesinden (Abramowitz-Stegun 7.1.26). */
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/** 3×3 lineer sistem çözümü (Cramer). Tekil matriste null. */
function solve3(A: number[][], b: number[]): number[] | null {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (!isFinite(D) || Math.abs(D) < 1e-14) return null;
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const M = A.map(row => row.slice());
    for (let k = 0; k < 3; k++) M[k][i] = b[k];
    out.push(det(M) / D);
  }
  return out;
}

export interface VVResult {
  price: number;        // Vanna-Volga düzeltilmiş fiyat
  bsPrice: number;      // düz ATM vol ile Black-Scholes fiyatı
  correction: number;   // uygulanan düzeltme (p ile ölçeklenmiş)
  survival: number;     // hayatta kalma olasılığı
  atmVol: number;
  pillars: { K: number; vol: number }[]; // 25Δput / ATM / 25Δcall
}

/**
 * Bariyerli opsiyon için Vanna-Volga fiyatı.
 * `smileVol(K)`: piyasa smile'ından K strike'ının vol'ü (ondalık, ör. 0.42). Aralık dışında null.
 * Üç kolon (25Δ put, ATM, 25Δ call) smile'dan okunamazsa null döner — çağıran taraf
 * düz BS'e düşer.
 */
export function vannaVolgaBarrier(
  S: number, K: number, H: number, R: number, T: number, r: number, q: number,
  code: string, smileVol: (strike: number) => number | null,
): VVResult | null {
  if (!(T > 0) || !(S > 0)) return null;
  const F = S * Math.exp((r - q) * T);
  const atmVol = smileVol(F);
  if (atmVol == null || !(atmVol > 0)) return null;

  // Üç kolon: 25Δ put, ATM(forward), 25Δ call — hepsi ATM vol ile belirlenir (standart)
  const kP = strikeFromDelta(S, T, r, q, atmVol, 0.25, 'p');
  const kC = strikeFromDelta(S, T, r, q, atmVol, 0.25, 'c');
  if (!isFinite(kP) || !isFinite(kC)) return null;
  const pillars = [{ K: kP }, { K: F }, { K: kC }].map(p => ({ K: p.K, vol: smileVol(p.K) }));
  if (pillars.some(p => p.vol == null || !(p.vol > 0))) return null;
  const vols = pillars.map(p => p.vol as number);

  // Egzotiğin vega/vanna/volga'sı (sonlu fark)
  const dv = 0.005, dS = S * 0.002;
  const P = (s: number, v: number) => barrierPrice(s, K, H, R, T, r, q, v, code);
  const p0 = P(S, atmVol);
  const vegaX = (P(S, atmVol + dv) - P(S, atmVol - dv)) / (2 * dv);
  const volgaX = (P(S, atmVol + dv) - 2 * p0 + P(S, atmVol - dv)) / (dv * dv);
  const vannaX = (P(S + dS, atmVol + dv) - P(S + dS, atmVol - dv)
                - P(S - dS, atmVol + dv) + P(S - dS, atmVol - dv)) / (4 * dS * dv);

  // Üç vanilyanın riskleri (hepsi ATM vol ile)
  const risks = pillars.map(p => vanillaRiskes(S, p.K, T, r, q, atmVol));
  const A = [
    [risks[0].vega, risks[1].vega, risks[2].vega],
    [risks[0].vanna, risks[1].vanna, risks[2].vanna],
    [risks[0].volga, risks[1].volga, risks[2].volga],
  ];
  const w = solve3(A, [vegaX, vannaX, volgaX]);
  if (!w) return null;

  // Piyasa smile fiyatı − düz ATM fiyatı farkı (call kullanılır; put-call paritesi gereği
  // bu FARK opsiyon tipinden bağımsızdır, σ'ya bağlı olmayan terimler sadeleşir).
  let raw = 0;
  for (let i = 0; i < 3; i++) {
    const mkt = gk(S, pillars[i].K, T, r, q, vols[i]).call;
    const flat = gk(S, pillars[i].K, T, r, q, atmVol).call;
    raw += w[i] * (mkt - flat);
  }

  // Bariyer ağırlığı: knock-OUT'ta hayatta kalma olasılığı (Wystup). Knock-IN, in-out
  // paritesiyle türetilir (aşağıda çağıran taraf), burada KO ağırlığı uygulanır.
  const isUp = code[1] === 'u';
  const isOut = code[2] === 'o';
  const surv = isOut ? survivalProbability(S, H, T, r, q, atmVol, isUp) : 1;
  const correction = surv * raw;

  return {
    price: Math.max(p0 + correction, 0),
    bsPrice: p0, correction, survival: surv, atmVol,
    pillars: pillars.map((p, i) => ({ K: p.K, vol: vols[i] })),
  };
}
