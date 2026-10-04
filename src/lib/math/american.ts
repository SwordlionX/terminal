import { gk } from './gk';
import { impliedVol } from './solver';

/**
 * Amerikan tipi opsiyon fiyatı — CRR Binom Ağacı.
 * GLD/SLV gibi ABD ETF opsiyonları Amerikan tipidir; Avrupa (GK) formülüyle
 * doğrudan IV çözmek özellikle put tarafında IV'yi olduğundan yüksek gösterir.
 */
export function americanPrice(
  S: number, K: number, T: number, r: number, q: number, v: number,
  type: 'call' | 'put', steps: number = 200
): number {
  if (![S, K, T, r, q, v].every(Number.isFinite) || S <= 0 || K <= 0 ||
      v < 0 || !Number.isInteger(steps) || steps < 1 || (type !== 'call' && type !== 'put')) return NaN;
  const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  if (T <= 0) return intrinsic;
  if (v === 0) {
    // With no diffusion, exercise can be optimal at an interior time.
    const exercise = (t: number) => type === 'call'
      ? Math.max(S * Math.exp(-q * t) - K * Math.exp(-r * t), 0)
      : Math.max(K * Math.exp(-r * t) - S * Math.exp(-q * t), 0);
    let value = Math.max(intrinsic, exercise(T));
    const ratio = r * K / (q * S);
    if (r !== q && ratio > 0 && Number.isFinite(ratio)) {
      const stationary = Math.log(ratio) / (r - q);
      if (stationary > 0 && stationary < T) value = Math.max(value, exercise(stationary));
    }
    return value;
  }
  const dt = T / steps;
  const x = v * Math.sqrt(dt);
  let u = Math.exp(x), d = Math.exp(-x);
  const disc = Math.exp(-r * dt);
  let p = (Math.exp((r - q) * dt) - d) / (u - d);
  if (!(p > 0 && p < 1)) {
    // Center the log moves around the drift. Equal probabilities keep the
    // tree recombining and the one-step expected spot exactly risk neutral.
    const center = (r - q) * dt - Math.log(Math.cosh(x));
    u = Math.exp(center + x);
    d = Math.exp(center - x);
    p = 0.5;
  }
  if (![u, d, disc, p].every(Number.isFinite) || u <= 0 || d <= 0) return NaN;

  // Vade sonu değerleri — Amerikan ve (control variate için) Avrupa bacağı
  // aynı kafes üzerinde paralel taşınır.
  const am: number[] = new Array(steps + 1);
  const eu: number[] = new Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const sT = S * Math.pow(u, steps - i) * Math.pow(d, i);
    const payoff = type === 'call' ? Math.max(sT - K, 0) : Math.max(K - sT, 0);
    am[i] = payoff;
    eu[i] = payoff;
  }

  // Geriye doğru indüksiyon: Amerikan'da erken kullanım, Avrupa'da salt iskonto
  for (let step = steps - 1; step >= 0; step--) {
    for (let i = 0; i <= step; i++) {
      const sNode = S * Math.pow(u, step - i) * Math.pow(d, i);
      const contAm = disc * (p * am[i] + (1 - p) * am[i + 1]);
      const exer = type === 'call' ? Math.max(sNode - K, 0) : Math.max(K - sNode, 0);
      am[i] = Math.max(contAm, exer);
      eu[i] = disc * (p * eu[i] + (1 - p) * eu[i + 1]);
    }
  }

  // Control variate (Hull): aynı ağaçtaki Avrupa fiyatının kapalı-form (GK)
  // çözümden sapması, CRR kesikleme hatasının ortak-mod (sawtooth) bileşenidir.
  // Amerikan fiyatından bu sapmayı düşerek salınımı büyük ölçüde yok eder;
  // maliyeti tek bir ekstra gk() çağrısı.
  const g = gk(S, K, T, r, q, v);
  const euClosed = type === 'call' ? g.call : g.put;
  const adjusted = am[0] - eu[0] + euClosed;
  return Number.isFinite(adjusted) && Number.isFinite(euClosed)
    ? Math.max(adjusted, intrinsic, euClosed) : NaN;
}

/**
 * Amerikan opsiyon piyasa fiyatından IV çözer (bisection — binom üstünde).
 */
export function impliedVolAmerican(
  S: number, K: number, T: number, r: number, q: number,
  price: number, type: 'call' | 'put', steps: number = 200
): { vol: number; ok: boolean } {
  if (![S, K, T, r, q, price].every(Number.isFinite) || S <= 0 || K <= 0 ||
      T <= 0 || price <= 0 || !Number.isInteger(steps) || steps < 1 ||
      (type !== 'call' && type !== 'put')) return { vol: NaN, ok: false };
  const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const zeroVol = americanPrice(S, K, T, r, q, 0, type, steps);
  if (!Number.isFinite(zeroVol) || price <= Math.max(intrinsic, zeroVol) + 1e-10)
    return { vol: NaN, ok: false };

  let lo = 0, hi = 5;
  let flo = americanPrice(S, K, T, r, q, lo, type, steps) - price;
  const fhi = americanPrice(S, K, T, r, q, hi, type, steps) - price;
  const tol = Math.min(1e-6, Math.max(1e-10, price * 1e-6));
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo >= 0 || fhi < 0)
    return { vol: NaN, ok: false };
  if (Math.abs(fhi) <= tol) return { vol: hi, ok: true };

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fm = americanPrice(S, K, T, r, q, mid, type, steps) - price;
    if (!Number.isFinite(fm)) return { vol: NaN, ok: false };
    if (Math.abs(fm) <= tol) return { vol: mid, ok: true };
    if (flo * fm < 0) { hi = mid; } else { lo = mid; flo = fm; }
  }
  const vol = (lo + hi) / 2;
  return Math.abs(americanPrice(S, K, T, r, q, vol, type, steps) - price) <= tol
    ? { vol, ok: true } : { vol: NaN, ok: false };
}

/**
 * De-Amerikanizasyon (sektör standardı — Carr & Wu 2010, OptionMetrics):
 * Amerikan piyasa fiyatı -> Amerikan model (binom) ile IV geriye çözülür ->
 * bu IV doğrudan Avrupa (GK) formülünde kullanılır.
 *
 * Not: q<=0 (temettüsüz ETF) VE r>=0 iken Amerikan CALL = Avrupa CALL (Merton:
 * temettü yokken call'u erken kullanmak asla optimal değildir), bu yüzden
 * call'larda hızlı Avrupa çözücü kullanılır; fark sadece PUT'ta. r<0 senaryosunda
 * bu eşitlik bozulur.
 */
export function deAmericanizedIV(
  S: number, K: number, T: number, r: number, q: number,
  price: number, type: 'call' | 'put'
): number {
  if (type === 'call' && q <= 0 && r >= 0) {
    const res = impliedVol(S, K, T, r, q, price, 'call');
    return res.ok ? res.vol : NaN;
  }
  const res = impliedVolAmerican(S, K, T, r, q, price, type);
  return res.ok ? res.vol : NaN;
}

/** American futures option, martingale futures tree with term-dependent USD discount. */
export function americanFutureCurvePrice(F: number, K: number, T: number, discounts: number[], v: number, type: 'call' | 'put'): number {
  const steps = discounts.length - 1;
  if (![F, K, T, v].every(Number.isFinite) || F <= 0 || K <= 0 || T <= 0 || v < 0 || steps < 1 ||
      discounts.some(d => !Number.isFinite(d) || d <= 0) || Math.abs(discounts[0] - 1) > 1e-10 ||
      (type !== 'call' && type !== 'put')) return NaN;
  const payoff = (s: number) => type === 'call' ? Math.max(s - K, 0) : Math.max(K - s, 0);
  if (v === 0) return Math.max(...discounts.map(d => payoff(F) * d));
  const x = v * Math.sqrt(T / steps), u = Math.exp(x), d = Math.exp(-x), p = (1 - d) / (u - d);
  const am = new Array<number>(steps + 1), eu = new Array<number>(steps + 1);
  for (let i = 0; i <= steps; i++) am[i] = eu[i] = payoff(F * Math.pow(u, steps - i) * Math.pow(d, i));
  for (let step = steps - 1; step >= 0; step--) {
    const disc = discounts[step + 1] / discounts[step];
    for (let i = 0; i <= step; i++) {
      am[i] = Math.max(payoff(F * Math.pow(u, step - i) * Math.pow(d, i)), disc * (p * am[i] + (1 - p) * am[i + 1]));
      eu[i] = disc * (p * eu[i] + (1 - p) * eu[i + 1]);
    }
  }
  const r = -Math.log(discounts[steps]) / T, european = gk(F, K, T, r, r, v);
  const closed = type === 'call' ? european.call : european.put;
  return Math.max(am[0] - eu[0] + closed, payoff(F), closed);
}

export function impliedVolAmericanFutureCurve(F: number, K: number, T: number, discounts: number[], price: number, type: 'call' | 'put') {
  const pricer = (v: number) => americanFutureCurvePrice(F, K, T, discounts, v, type);
  let lo = 0, hi = 5;
  const low = pricer(lo), high = pricer(hi);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(low) || !Number.isFinite(high) || price <= low + 1e-10 || price > high)
    return { ok: false, vol: NaN };
  const tolerance = Math.min(1e-6, Math.max(1e-10, price * 1e-6));
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2, estimate = pricer(mid);
    if (!Number.isFinite(estimate)) return { ok: false, vol: NaN };
    if (Math.abs(estimate - price) <= tolerance) return { ok: true, vol: mid };
    if (estimate > price) hi = mid; else lo = mid;
  }
  const vol = (lo + hi) / 2;
  return { ok: Math.abs(pricer(vol) - price) <= tolerance, vol };
}
