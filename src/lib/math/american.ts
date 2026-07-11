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
  if (T <= 0 || v <= 0 || S <= 0 || K <= 0) {
    return type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  const dt = T / steps;
  const u = Math.exp(v * Math.sqrt(dt));
  const d = 1 / u;
  const disc = Math.exp(-r * dt);
  const p = (Math.exp((r - q) * dt) - d) / (u - d);
  if (p <= 0 || p >= 1) {
    // Ağaç dejenere — Avrupa fiyatına düş
    const g = gk(S, K, T, r, q, v);
    return type === 'call' ? g.call : g.put;
  }

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
  return am[0] - eu[0] + euClosed;
}

/**
 * Amerikan opsiyon piyasa fiyatından IV çözer (bisection — binom üstünde).
 */
export function impliedVolAmerican(
  S: number, K: number, T: number, r: number, q: number,
  price: number, type: 'call' | 'put', steps: number = 200
): { vol: number; ok: boolean } {
  if (price <= 0 || T <= 0) return { vol: NaN, ok: false };
  const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  if (price <= intrinsic + 1e-10) return { vol: NaN, ok: false };

  let lo = 1e-4, hi = 5;
  let flo = americanPrice(S, K, T, r, q, lo, type, steps) - price;
  const fhi = americanPrice(S, K, T, r, q, hi, type, steps) - price;
  if (flo * fhi > 0) return { vol: NaN, ok: false };

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fm = americanPrice(S, K, T, r, q, mid, type, steps) - price;
    if (Math.abs(fm) < 1e-6) return { vol: mid, ok: true };
    if (flo * fm < 0) { hi = mid; } else { lo = mid; flo = fm; }
  }
  return { vol: (lo + hi) / 2, ok: true };
}

/**
 * De-Amerikanizasyon (sektör standardı — Carr & Wu 2010, OptionMetrics):
 * Amerikan piyasa fiyatı -> Amerikan model (binom) ile IV geriye çözülür ->
 * bu IV doğrudan Avrupa (GK) formülünde kullanılır.
 *
 * Not: q<=0 (temettüsüz ETF) VE r>=0 iken Amerikan CALL = Avrupa CALL (Merton:
 * temettü yokken call'u erken kullanmak asla optimal değildir), bu yüzden
 * call'larda hızlı Avrupa çözücü kullanılır; fark sadece PUT'ta. r<0 senaryosunda
 * bu eşitlik bozulur — bu araçta USD faizi r>=0 olduğundan kısayol güvenli.
 */
export function deAmericanizedIV(
  S: number, K: number, T: number, r: number, q: number,
  price: number, type: 'call' | 'put'
): number {
  if (type === 'call' && q <= 0) {
    const res = impliedVol(S, K, T, r, q, price, 'call');
    return res.ok ? res.vol : NaN;
  }
  const res = impliedVolAmerican(S, K, T, r, q, price, type);
  return res.ok ? res.vol : NaN;
}
