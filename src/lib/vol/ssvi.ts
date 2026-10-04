/** A single-expiry SSVI slice. k = log(K/F), w = IV² × years. */
export interface SsviFit {
  theta: number;
  rho: number;
  phi: number;
  originalDays: number;
  rmseVol: number;
  maxErrorVol: number;
  points: number;
}

export interface SsviPoint {
  m: number;
  iv: number;
}

export function ssviTotalVariance(fit: Pick<SsviFit, 'theta' | 'rho' | 'phi'>, k: number): number {
  const x = fit.phi * k;
  return (fit.theta * (1 + fit.rho * x + Math.sqrt((x + fit.rho) ** 2 + 1 - fit.rho ** 2))) / 2;
}

/** Gatheral–Jacquier sufficient butterfly conditions (Theorem 5.2). */
export function ssviButterflySafe(fit: Pick<SsviFit, 'theta' | 'rho' | 'phi'>): boolean {
  const { theta, rho, phi } = fit;
  return (
    Number.isFinite(theta) &&
    theta > 0 &&
    Number.isFinite(rho) &&
    Math.abs(rho) < 1 &&
    Number.isFinite(phi) &&
    phi > 0 &&
    theta * phi * (1 + Math.abs(rho)) < 4 &&
    theta * phi * phi * (1 + Math.abs(rho)) <= 4
  );
}

export function ssviVol(fit: SsviFit, m: number): number {
  if (!(m > 0) || !Number.isFinite(m)) return NaN;
  return Math.sqrt(ssviTotalVariance(fit, Math.log(m)) / (fit.originalDays / 365));
}

/**
 * Rebased IV values imply a shorter total-variance tenor. The smile's shape
 * parameters rho and phi stay fixed; only theta scales with remaining time.
 */
export function ssviSafeAtDays(fit: SsviFit, days: number): boolean {
  if (!(days > 0) || !Number.isFinite(days)) return false;
  const scale = days / fit.originalDays;
  return ssviButterflySafe({ theta: fit.theta * scale, rho: fit.rho, phi: fit.phi });
}

/** Deterministic constrained least-squares fit; refuses sparse or noisy slices. */
export function fitSsvi(points: SsviPoint[], days: number): SsviFit | null {
  if (!(days > 0) || !Number.isFinite(days) || points.length < 5) return null;
  const sorted = [...points].sort((a, b) => a.m - b.m);
  if (
    sorted.some(
      (p, i) =>
        !Number.isFinite(p.m) ||
        !(p.m > 0) ||
        !Number.isFinite(p.iv) ||
        p.iv <= 0.005 ||
        p.iv >= 4 ||
        (i > 0 && p.m - sorted[i - 1].m < 1e-7),
    )
  )
    return null;
  const left = sorted.filter(p => p.m < 1);
  const right = sorted.filter(p => p.m > 1);
  if (left.length < 2 || right.length < 2 || sorted[sorted.length - 1].m - sorted[0].m < 0.08) return null;

  const nearLeft = left[left.length - 1],
    nearRight = right[0];
  const atmWeight = (1 - nearLeft.m) / (nearRight.m - nearLeft.m);
  const atmIv2 = (1 - atmWeight) * nearLeft.iv ** 2 + atmWeight * nearRight.iv ** 2;
  const theta0 = (atmIv2 * days) / 365;
  if (!(theta0 > 0) || !Number.isFinite(theta0)) return null;

  const ks = sorted.map(p => Math.log(p.m));
  const years = days / 365;
  let best = { theta: theta0, rho: 0, phi: 0.1, loss: Infinity };
  const score = (theta: number, rho: number, phi: number): number => {
    if (!ssviButterflySafe({ theta, rho, phi })) return Infinity;
    let loss = 0;
    for (let i = 0; i < sorted.length; i++) {
      const iv = Math.sqrt(ssviTotalVariance({ theta, rho, phi }, ks[i]) / years);
      const error = iv - sorted[i].iv;
      loss += error * error;
    }
    return loss / sorted.length;
  };
  // Log spacing covers both shallow and steep smiles without a data-dependent seed.
  for (let ti = 0; ti <= 6; ti++) {
    const theta = theta0 * (0.85 + ti * 0.05);
    for (let ri = -9; ri <= 9; ri++) {
      const rho = ri / 10;
      for (let pi = 0; pi <= 48; pi++) {
        const phi = 0.02 * 1000 ** (pi / 48);
        const loss = score(theta, rho, phi);
        if (loss < best.loss) best = { theta, rho, phi, loss };
      }
    }
  }
  if (!Number.isFinite(best.loss)) return null;
  // Bounded coordinate refinement improves continuity and reduces grid artefacts.
  let thetaStep = theta0 * 0.03,
    rhoStep = 0.05,
    logPhiStep = 0.12;
  for (let iteration = 0; iteration < 32; iteration++) {
    let improved = false;
    const candidates = [
      [best.theta - thetaStep, best.rho, best.phi],
      [best.theta + thetaStep, best.rho, best.phi],
      [best.theta, best.rho - rhoStep, best.phi],
      [best.theta, best.rho + rhoStep, best.phi],
      [best.theta, best.rho, best.phi * Math.exp(-logPhiStep)],
      [best.theta, best.rho, best.phi * Math.exp(logPhiStep)],
    ];
    for (const [theta, rho, phi] of candidates) {
      if (theta < theta0 * 0.8 || theta > theta0 * 1.2 || Math.abs(rho) >= 0.98) continue;
      const loss = score(theta, rho, phi);
      if (loss + 1e-16 < best.loss) {
        best = { theta, rho, phi, loss };
        improved = true;
      }
    }
    if (!improved) {
      thetaStep *= 0.55;
      rhoStep *= 0.55;
      logPhiStep *= 0.55;
    }
  }
  let maxErrorVol = 0;
  for (let i = 0; i < sorted.length; i++) {
    const iv = Math.sqrt(ssviTotalVariance(best, ks[i]) / years);
    maxErrorVol = Math.max(maxErrorVol, Math.abs(iv - sorted[i].iv));
  }
  const rmseVol = Math.sqrt(best.loss);
  // A poor fit must not masquerade as market data, especially in the wings.
  if (rmseVol > 0.008 || maxErrorVol > 0.02) return null;
  return {
    theta: best.theta,
    rho: best.rho,
    phi: best.phi,
    originalDays: days,
    rmseVol,
    maxErrorVol,
    points: sorted.length,
  };
}
