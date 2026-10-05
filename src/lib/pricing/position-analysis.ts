import { calculatePricing, dateDay } from './engine';
import { quoteOption } from '../assistant/pricing';
import type { MarketSnapshot, OptionRequest, Quote, ScreenContext } from '../assistant/types';

export interface AnalysisLeg {
  option: OptionRequest;
  /** Historical execution premium, USD per unit. Omission uses today's model premium. */
  entryPremiumPerUnit?: number;
}
export interface AnalysisCell {
  pnl: number | null;
  pnlPct: number | null;
  value: number | null;
  delta: number | null;
  gamma: number | null;
  reason?: string;
}
export interface PayoffLimits {
  maxProfit: number | null; // null denotes an unbounded tail, never a missing quote
  maxLoss: number | null;
  breakevens: number[];
  flatZeroRanges: { from: number; to: number | null }[];
}
export interface PositionAnalysis {
  label: string;
  quotes: Quote[];
  dates: string[];
  rows: { movePct: number; spot: number; cells: AnalysisCell[] }[];
  valuationDate: string;
  firstExpiry: string;
  allSameExpiry: boolean;
  nominal: number;
  entryCashflow: number;
  entryPremiums: number[];
  modelCashflow: number;
  modelCashflowPct: number;
  delta: number;
  gamma: number;
  limits: PayoffLimits | null;
  /** Spot levels where the model P&L crosses zero on each scenario date (searched within ±40% of spot). */
  breakevens: { date: string; levels: number[] }[];
  missingCells: number;
  notes: string[];
}

export function analysisDates(valuationDate: string, firstExpiry: string): string[] {
  const start = dateDay(valuationDate),
    end = dateDay(firstExpiry);
  if (!Number.isFinite(start) || !(end > start))
    throw new Error('Analiz için geçerli değerleme tarihi ve ileri vade gerekli.');
  const days = Math.round((end - start) / 86400000);
  return [...new Set([0, Math.min(14, days), ...[0.25, 0.5, 0.75, 1].map(x => Math.round(days * x))])]
    .sort((a, b) => a - b)
    .map(d => new Date(start + d * 86400000).toISOString().slice(0, 10));
}

const signOf = (q: Quote) => (q.position === 'Long' ? 1 : -1);
const intrinsic = (q: Quote, spot: number) =>
  q.type === 'Call' ? Math.max(0, spot - q.inputs.strike) : Math.max(0, q.inputs.strike - spot);

/** Piecewise-linear maturity payoff on S >= 0, including the unbounded call tail. */
export function expiryPayoffLimits(quotes: Quote[], entries: number[]): PayoffLimits {
  if (!quotes.length || entries.length !== quotes.length || quotes.some(q => q.barrier))
    throw new Error('Vanilya bacakları ve başlangıç primleri gerekli.');
  if (quotes.some(q => q.inputs.expiryDate !== quotes[0].inputs.expiryDate))
    throw new Error('Teorik vade sonu sınırları yalnız ortak vadede hesaplanır.');
  const pnl = (s: number) =>
    quotes.reduce((total, q, i) => total + signOf(q) * (intrinsic(q, s) - entries[i]) * q.inputs.contractSize, 0);
  const knots = [...new Set([0, ...quotes.map(q => q.inputs.strike)])].sort((a, b) => a - b);
  const values = knots.map(pnl);
  const tail = quotes.reduce((s, q) => s + (q.type === 'Call' ? signOf(q) * q.inputs.contractSize : 0), 0);
  const scale = Math.max(1, ...values.map(Math.abs));
  const zero = (v: number) => Math.abs(v) <= scale * 1e-10;
  const roots: number[] = [],
    ranges: PayoffLimits['flatZeroRanges'] = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const a = values[i],
      b = values[i + 1];
    if (zero(a) && zero(b)) ranges.push({ from: knots[i], to: knots[i + 1] });
    else {
      if (zero(a)) roots.push(knots[i]);
      if (a * b < 0) roots.push(knots[i] - (a * (knots[i + 1] - knots[i])) / (b - a));
      if (zero(b)) roots.push(knots[i + 1]);
    }
  }
  const last = knots.at(-1)!,
    lastValue = values.at(-1)!;
  if (tail === 0 && zero(lastValue)) ranges.push({ from: last, to: null });
  else if (tail !== 0 && -lastValue / tail >= 0) roots.push(last - lastValue / tail);
  const flatZeroRanges: PayoffLimits['flatZeroRanges'] = [];
  for (const range of ranges) {
    const prior = flatZeroRanges.at(-1);
    if (prior?.to === range.from) prior.to = range.to;
    else flatZeroRanges.push({ ...range });
  }
  return {
    maxProfit: tail > 0 ? null : Math.max(0, ...values),
    maxLoss: tail < 0 ? null : Math.max(0, -Math.min(...values)),
    breakevens: [...new Set(roots)]
      .filter(r => !flatZeroRanges.some(x => r >= x.from && (x.to === null || r <= x.to)))
      .sort((a, b) => a - b),
    flatZeroRanges,
  };
}

/** Local deterministic analysis. Never fetches data or overrides the curve's r/q/IV. */
export function analyzeEuropeanPosition(
  screen: ScreenContext,
  market: MarketSnapshot,
  legs: AnalysisLeg[],
  label = 'Mevcut pozisyon',
  dates?: string[],
  moves = [-20, -15, -10, -8, -5, 0, 5, 8, 10, 15, 20],
  referenceQuantity?: number,
): PositionAnalysis {
  if (!legs.length || legs.length > 24) throw new Error('Analiz için bir ila 24 vanilya bacağı gerekli.');
  const quotes = legs.map(leg => {
    const r = leg.option;
    if (r.barrier) throw new Error('Bu ekran yalnız Avrupa tipi vanilya opsiyonları destekler.');
    if (
      !['Call', 'Put'].includes(r.type) ||
      !['Long', 'Short'].includes(r.position) ||
      !(r.contractSize! > 0) ||
      !Number.isFinite(r.contractSize)
    )
      throw new Error('Her bacakta tip, müşteri yönü ve pozitif miktar gerekli.');
    if (r.product && r.product !== market.product) throw new Error('Tek analizde aynı dayanak kullanılmalı.');
    if (r.tradeDate && r.tradeDate !== screen.tradeDate)
      throw new Error('Bütün bacaklar aynı değerleme tarihinde hesaplanmalı.');
    return quoteOption(r, screen, market);
  });
  const entries = legs.map((leg, i) => leg.entryPremiumPerUnit ?? quotes[i].premiumPerUnit);
  if (entries.some(v => !Number.isFinite(v) || v < 0))
    throw new Error('Geçmiş işlem primi negatif veya geçersiz olamaz.');
  const entryCashflow = quotes.reduce((s, q, i) => s - signOf(q) * entries[i] * q.inputs.contractSize, 0);
  if (!Number.isFinite(entryCashflow)) throw new Error('Başlangıç prim akışı sayı sınırını aşıyor.');
  const firstExpiry = quotes.map(q => q.inputs.expiryDate).sort()[0];
  const columns = dates ?? analysisDates(screen.tradeDate, firstExpiry);
  if (
    !columns.length ||
    columns.length > 8 ||
    new Set(columns).size !== columns.length ||
    columns.some(d => !Number.isFinite(dateDay(d)) || d < screen.tradeDate || d > firstExpiry) ||
    columns.some((d, i) => i > 0 && d <= columns[i - 1])
  )
    throw new Error(
      'Senaryo tarihleri sıralı olmalı ve değerleme ile ilk vade arasında kalmalı. Geçmiş vade ödemesi daha sonraki spotla hesaplanmaz.',
    );
  if (
    !moves.length ||
    moves.length > 31 ||
    moves.some(v => !Number.isFinite(v) || v <= -100 || Math.abs(v) > 100) ||
    new Set(moves).size !== moves.length ||
    moves.some((v, i) => i > 0 && v <= moves[i - 1])
  )
    throw new Error('Spot şokları sıralı, benzersiz ve -%100 ile +%100 arasında olmalı.');
  const qty = referenceQuantity ?? quotes[0].inputs.contractSize;
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Pozitif referans miktarı gerekli.');
  const nominal = quotes[0].inputs.spot * qty;
  if (!Number.isFinite(nominal) || nominal <= 0) throw new Error('Referans nominal sayı sınırını aşıyor.');
  const cellAt = (spot: number, date: string): AnalysisCell => {
    let pnl = 0,
      value = 0,
      delta = 0,
      gamma = 0;
    for (let i = 0; i < quotes.length; i++) {
      const q = quotes[i],
        sign = signOf(q),
        amount = q.inputs.contractSize;
      if (date === q.inputs.expiryDate) {
        const mark = intrinsic(q, spot);
        value += sign * mark * amount;
        pnl += sign * (mark - entries[i]) * amount;
        // Delta/gamma are undefined at the expiry kink; never display zeros as Greeks.
      } else {
        const p = calculatePricing({ ...q.inputs, spot, tradeDate: date, manualVol: false }, market.surface);
        const gr = q.type === 'Call' ? p.gr?.call : p.gr?.put;
        if (!p.priceable || !gr || ![gr.delta, gr.gamma].every(Number.isFinite))
          return {
            pnl: null,
            pnlPct: null,
            value: null,
            delta: null,
            gamma: null,
            reason: p.unpriceableReason ?? 'Motor bu senaryoyu desteklemiyor.',
          };
        const mark = q.type === 'Call' ? p.result.call : p.result.put;
        value += sign * mark * amount;
        pnl += sign * (mark - entries[i]) * amount;
        delta += sign * gr.delta * amount;
        gamma += sign * gr.gamma * amount;
      }
    }
    if (![pnl, value, delta, gamma].every(Number.isFinite))
      return {
        pnl: null,
        pnlPct: null,
        value: null,
        delta: null,
        gamma: null,
        reason: 'Sonuç sayı sınırını aşıyor.',
      };
    const anyExpiry = quotes.some(q => date === q.inputs.expiryDate);
    return {
      pnl,
      pnlPct: (pnl / nominal) * 100,
      value,
      delta: anyExpiry ? null : delta,
      gamma: anyExpiry ? null : gamma,
    };
  };
  const rows = moves.map(movePct => {
    const spot = quotes[0].inputs.spot * (1 + movePct / 100);
    const cells = columns.map(date => cellAt(spot, date));
    return { movePct, spot, cells };
  });
  const allSameExpiry = quotes.every(q => q.inputs.expiryDate === firstExpiry);
  // Zero crossings of the model P&L, refined by bisection on the same pricing path as the grid.
  const base = quotes[0].inputs.spot;
  const breakevens = columns.map(date => {
    const levels: number[] = [];
    const pnlAt = (spot: number) => cellAt(spot, date).pnl;
    let prevSpot = base * 0.6,
      prev = pnlAt(prevSpot);
    for (let step = 1; step <= 80; step++) {
      const spot = base * (0.6 + step * 0.01),
        value = pnlAt(spot);
      if (prev !== null && value !== null && prev !== 0 && Math.sign(prev) !== Math.sign(value)) {
        let lo = prevSpot,
          hi = spot,
          flo = prev;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2,
            fm = pnlAt(mid);
          if (fm === null) break;
          if (Math.sign(fm) === Math.sign(flo)) {
            lo = mid;
            flo = fm;
          } else hi = mid;
        }
        levels.push((lo + hi) / 2);
      } else if (value === 0) levels.push(spot);
      prevSpot = spot;
      prev = value;
    }
    return { date, levels };
  });
  const modelCashflow = quotes.reduce((s, q) => s + q.cashflow, 0);
  return {
    label,
    quotes,
    dates: columns,
    rows,
    valuationDate: screen.tradeDate,
    firstExpiry,
    allSameExpiry,
    nominal,
    entryCashflow,
    entryPremiums: entries,
    modelCashflow,
    modelCashflowPct: (modelCashflow / nominal) * 100,
    delta: quotes.reduce((s, q) => s + q.delta, 0),
    gamma: quotes.reduce((s, q) => s + q.gamma, 0),
    limits: allSameExpiry ? expiryPayoffLimits(quotes, entries) : null,
    breakevens,
    missingCells: rows.reduce((n, r) => n + r.cells.filter(c => c.pnl === null).length, 0),
    notes: [
      'Avrupa tipi: vade öncesi kullanım yok. Ters işlem eski sözleşmeyi feshetmez; vade değişikliği yeni bir işlem gerektirir.',
      'Gelecek tarih sonuçları senaryodur. Mevcut tarihli smile ve faiz/taşıma varsayımları korunur; her spot şokunda IV aynı yüzeyden tekrar okunur. Gelecekteki piyasa eğrisi tahmin edilmez.',
      'USD ve yüzde aynı K/Z değerini gösterir. Yüzde bazı: terminal spotu × referans miktarı; yatırılan teminatın getirisi değildir.',
      'Belirtilmeyen başlangıç primleri bugünkü model primidir; gerçekleşmiş müşteri K/Z’si değildir. Prim finansmanı, teminat, spread ve komisyon hariçtir.',
      ...(!allSameExpiry
        ? [
            'Farklı vadeler ilk vadeye kadar ortak tarihte karşılaştırılır. Ortak vade sonu teorik maksimum/başabaş gösterilmez.',
          ]
        : []),
      ...new Set(quotes.flatMap(q => q.warnings)),
    ],
  };
}
