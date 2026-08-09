/**
 * BAŞABAŞ (break-even) seviyesi — opsiyonun içsel değerinin primi tam karşıladığı spot.
 *
 * Vade sonunda müşterinin net kâr/zararı sıfır olduğu fiyat:
 *   Call : K + prim/birim
 *   Put  : K − prim/birim
 *
 * DİKKAT: Seviye Long ve Short'ta AYNIDIR — değişen, hangi tarafın kâr olduğudur.
 * (Short put'ta başabaşın ÜSTÜ kâr, Long put'ta ALTI kâr.) Bu yüzden yön ayrı bir
 * fonksiyonla veriliyor: `profitSideOf`.
 *
 * Prim TOPLAM tutardır (bkz. db.ts: `premium` toplam, `currentPremium` birim); birim
 * başına düşen prim için kontrat büyüklüğüne bölünür.
 */

export type OptionType = 'Call' | 'Put';
export type OptionPosition = 'Long' | 'Short';

export function breakEvenSpot(
  type: OptionType,
  strike: number,
  premiumTotal: number,
  contractSize: number,
): number | null {
  if (!(contractSize > 0) || !(strike > 0) || !Number.isFinite(premiumTotal)) return null;
  const perUnit = premiumTotal / contractSize;
  const be = type === 'Call' ? strike + perUnit : strike - perUnit;
  return Number.isFinite(be) ? be : null;
}

/**
 * Başabaşın hangi tarafı müşteri lehine?
 *  Long Call / Short Put  → ÜSTÜ kâr
 *  Short Call / Long Put  → ALTI kâr
 */
export function profitSideOf(type: OptionType, position: OptionPosition): 'above' | 'below' {
  return (type === 'Call') === (position === 'Long') ? 'above' : 'below';
}

/** "70,04 üstü kâr" gibi kısa etiket. */
export function breakEvenLabel(
  type: OptionType,
  position: OptionPosition,
  be: number,
  digits = 2,
): string {
  const side = profitSideOf(type, position) === 'above' ? 'üstü' : 'altı';
  return `${be.toFixed(digits)} ${side} kâr`;
}
