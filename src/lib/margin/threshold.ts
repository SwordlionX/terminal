/** Shared, deterministic procedure calculation. No IV, model calls or database writes. */
export interface MarginSnapshot {
  observedAt: string;
  valuationDate: string;
  spots: { product: string; price: number; source: string; quoteAt: number | null; stale: boolean }[];
  positions: {
    id: string;
    product: string;
    type: 'Call' | 'Put';
    position: 'Long' | 'Short';
    strike: number;
    quantity: number;
    premium: number;
    expiryDate: string;
    barrier: boolean;
    currentSpot: number;
  }[];
  collaterals: { currency: string; quantity: number; valueUsd: number; haircut: number }[];
  warnings: string[];
}

export interface MarginThresholdResult {
  product: string;
  observedAt: string;
  spots: MarginSnapshot['spots'];
  tradeIds: string[];
  validBefore: string;
  currentSpot: number;
  currentLossUsd: number;
  recordedCollateralUsd: number;
  usedCollateralUsd: number;
  collateralOverride: boolean;
  currentRatioPct: number | null;
  targetRatioPct: number | null;
  status: 'current_only' | 'solved' | 'unreachable' | 'non_unique';
  levels: { spot: number; lossUsd: number; collateralUsd: number; ratioPct: number; movePct: number }[];
  warnings: string[];
  notes: string[];
}

export function marginThreshold(
  snapshot: MarginSnapshot,
  options: { product?: string; targetRatioPct?: number; collateralOverrideUsd?: number },
): MarginThresholdResult {
  const { positions, collaterals } = snapshot;
  const finite = (v: number, min = 0) => Number.isFinite(v) && v >= min;
  if (!positions.length) throw new Error('Hesaplanacak açık işlem yok.');
  if (new Set(positions.map(p => p.id)).size !== positions.length)
    throw new Error('İşlem listesinde yinelenen kayıt var.');
  if (positions.some(p => p.barrier))
    throw new Error('Bariyerli işlemlerde geçmiş temas bilgisi gerekir; basit içsel zarar eşiği hesaplanmadı.');
  if (positions.some(p => !/^\d{4}-\d{2}-\d{2}$/.test(p.expiryDate) || p.expiryDate <= snapshot.valuationDate))
    throw new Error('Vadesi gelmiş açık işlem var. Vade sonucu işlenmeden ileriye dönük eşik hesaplanamaz.');
  if (
    positions.some(
      p =>
        !['XAU', 'XAG'].includes(p.product) ||
        !['Call', 'Put'].includes(p.type) ||
        !['Long', 'Short'].includes(p.position) ||
        !finite(p.quantity, Number.MIN_VALUE) ||
        !finite(p.strike, Number.MIN_VALUE) ||
        !finite(p.premium),
    )
  )
    throw new Error('İşlem koşulları eksik veya geçersiz; eşik hesaplanmadı.');
  if (
    collaterals.some(
      c =>
        !['USD', 'XAU', 'XAG'].includes(c.currency) ||
        !finite(c.quantity) ||
        !finite(c.valueUsd) ||
        !finite(c.haircut) ||
        c.haircut > 1,
    )
  )
    throw new Error('Teminat bileşimi bu senaryo için doğrulanamadı.');
  const products = [...new Set(positions.filter(p => p.position === 'Short').map(p => p.product))];
  const product = options.product ?? (products.length === 1 ? products[0] : undefined);
  if (!product || !['XAU', 'XAG'].includes(product) || !products.includes(product))
    throw new Error('Hangi metalin spot eşiği hesaplansın: XAU (altın) veya XAG (gümüş)?');
  const requiredProducts = [
    ...new Set([
      ...positions.map(p => p.product),
      ...collaterals.filter(c => c.currency !== 'USD').map(c => c.currency),
    ]),
  ];
  for (const p of requiredProducts) {
    const quote = snapshot.spots.find(s => s.product === p);
    if (!quote || !finite(quote.price, Number.MIN_VALUE))
      throw new Error('Ortak spot gözlemi alınamadı; kayıtlı giriş spotlarıyla hedef seviye hesaplanmaz.');
    if (positions.some(t => t.product === p && t.currentSpot !== quote.price))
      throw new Error('Pozisyon spotları aynı veri anına ait değil; dosyayı yeniden okuyun.');
  }
  const target = options.targetRatioPct;
  if (target !== undefined && (!finite(target, Number.MIN_VALUE) || target > 1000))
    throw new Error('Hedef zarar/teminat yüzdesi 0’dan büyük ve en fazla 1000 olmalı.');
  const override = options.collateralOverrideUsd;
  if (override !== undefined && !finite(override, Number.MIN_VALUE))
    throw new Error('Varsayımsal toplam USD teminatı sıfırdan büyük olmalı.');
  const currentSpot = snapshot.spots.find(s => s.product === product)!.price;
  const longPremium = positions.filter(p => p.position === 'Long').reduce((v, p) => v + p.premium, 0);
  const recordedCollateralUsd = longPremium + collaterals.reduce((v, c) => v + c.valueUsd * (1 - c.haircut), 0);
  // An override replaces the ENTIRE denominator. It is not a deposit, and long premiums are not added twice.
  const collateralSlope =
    override === undefined
      ? collaterals.filter(c => c.currency === product).reduce((v, c) => v + c.quantity * (1 - c.haircut), 0)
      : 0;
  const collateralConstant =
    override ??
    longPremium + collaterals.filter(c => c.currency !== product).reduce((v, c) => v + c.valueUsd * (1 - c.haircut), 0);
  const lossAt = (spot: number) =>
    positions.reduce((v, p) => {
      if (p.position !== 'Short') return v;
      const s = p.product === product ? spot : p.currentSpot;
      return v + Math.max(0, p.type === 'Put' ? p.strike - s : s - p.strike) * p.quantity;
    }, 0);
  const collateralAt = (spot: number) => collateralConstant + collateralSlope * spot;
  const currentLossUsd = lossAt(currentSpot),
    usedCollateralUsd = collateralAt(currentSpot);
  if (
    ![recordedCollateralUsd, currentLossUsd, usedCollateralUsd, collateralSlope, collateralConstant].every(v =>
      finite(v),
    )
  )
    throw new Error('Tutarlar hesaplama sınırını aşıyor; sonuç üretilmedi.');
  if (
    override === undefined &&
    Math.abs(recordedCollateralUsd - usedCollateralUsd) > 1e-6 * Math.max(1, recordedCollateralUsd)
  )
    throw new Error('Metal teminat ve işlem spotları aynı veri anına ait değil; dosyayı yeniden okuyun.');
  const notes = [
    'Müşterinin tüm açık işlemlerinin brüt içsel zararıdır; alınmış short primleri düşülmez. Model MTM/K/Z değildir.',
    'İşlemler ve teminat adetleri değişmeden, ilk vadeden önce geçerlidir. Bir tarih veya piyasa tahmini değildir.',
    override !== undefined
      ? 'Kullanıcının varsayımsal toplam USD teminatı kullanıldı; kayıtlı teminat değiştirilmedi.'
      : 'Seçilen metal teminatı aynı senaryo spotuyla yeniden değerlenir; diğer metal fiyatları sabittir.',
  ];
  const result: MarginThresholdResult = {
    product,
    observedAt: snapshot.observedAt,
    spots: snapshot.spots,
    tradeIds: positions.map(p => p.id),
    validBefore: positions.map(p => p.expiryDate).sort()[0],
    currentSpot,
    currentLossUsd,
    recordedCollateralUsd,
    usedCollateralUsd,
    collateralOverride: override !== undefined,
    currentRatioPct: usedCollateralUsd > 0 ? (currentLossUsd / usedCollateralUsd) * 100 : null,
    targetRatioPct: target ?? null,
    status: 'current_only',
    levels: [],
    warnings: [...snapshot.warnings],
    notes,
  };
  if (target === undefined) return result;
  const ratio = target / 100;
  const changing = positions.filter(p => p.position === 'Short' && p.product === product);
  const fixedLoss = positions
    .filter(p => p.position === 'Short' && p.product !== product)
    .reduce(
      (v, p) => v + Math.max(0, p.type === 'Put' ? p.strike - p.currentSpot : p.currentSpot - p.strike) * p.quantity,
      0,
    );
  const knots = [...new Set([0, ...changing.map(p => p.strike)])].sort((a, b) => a - b);
  let flat = false;
  // Loss is piecewise linear; collateral is linear. Solve each interval, including the unbounded call wing.
  for (let i = 0; i < knots.length; i++) {
    const lo = knots[i],
      hi = knots[i + 1] ?? Infinity;
    const mid = Number.isFinite(hi) ? (lo + hi) / 2 : lo + 1;
    let a = -ratio * collateralSlope,
      b = fixedLoss - ratio * collateralConstant;
    for (const p of changing) {
      if (p.type === 'Put' && mid < p.strike) {
        a -= p.quantity;
        b += p.strike * p.quantity;
      }
      if (p.type === 'Call' && mid > p.strike) {
        a += p.quantity;
        b -= p.strike * p.quantity;
      }
    }
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) < 1e-7 && collateralAt(mid) > 0) flat = true;
      continue;
    }
    const root = -b / a;
    if (!finite(root) || root < lo - 1e-9 || root > hi + 1e-9) continue;
    const spot = Math.max(lo, Math.min(hi, root)),
      collateralUsd = collateralAt(spot),
      lossUsd = lossAt(spot);
    if (
      collateralUsd <= 0 ||
      !finite(lossUsd) ||
      !finite(collateralUsd) ||
      Math.abs(lossUsd / collateralUsd - ratio) > 1e-8 ||
      result.levels.some(l => Math.abs(l.spot - spot) < 1e-8)
    )
      continue;
    result.levels.push({
      spot,
      collateralUsd,
      lossUsd,
      ratioPct: (lossUsd / collateralUsd) * 100,
      movePct: (spot / currentSpot - 1) * 100,
    });
  }
  result.status = flat ? 'non_unique' : result.levels.length ? 'solved' : 'unreachable';
  if (flat) result.notes.push('Hedef oran bir fiyat aralığında sabit; tek bir eşik fiyatı yoktur.');
  if (result.status === 'unreachable')
    result.notes.push('Sıfır veya üzerindeki sonlu spotlarda, pozitif teminatla bu hedef orana ulaşılamıyor.');
  return result;
}
