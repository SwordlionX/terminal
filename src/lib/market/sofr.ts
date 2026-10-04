import type { CurveNode } from './cme-carry';
import type { FactorNode } from './factors';

export interface SofrFixing {
  date: string;
  rate: number;
}
const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const midnight = (date: string) => Date.parse(date + 'T00:00:00Z');
function nthWeekday(year: number, month: number, wd: number, nth: number) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return iso(Date.UTC(year, month, 1 + ((wd - first + 7) % 7) + 7 * (nth - 1)));
}
function observed(year: number, month: number, day: number) {
  let ms = Date.UTC(year, month, day);
  const wd = new Date(ms).getUTCDay();
  if (wd === 6) ms -= DAY;
  else if (wd === 0) ms += DAY;
  return iso(ms);
}
function easter(year: number) {
  const a = year % 19,
    b = Math.floor(year / 100),
    c = year % 100,
    d = Math.floor(b / 4),
    e = b % 4;
  const f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31);
  return Date.UTC(year, month - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
/** US government securities full holidays; half days still accrue a SOFR fixing. */
export function sofrBusinessDay(date: string) {
  const ms = midnight(date),
    d = new Date(ms),
    year = d.getUTCFullYear();
  if ([0, 6].includes(d.getUTCDay())) return false;
  const holidays = new Set([
    observed(year, 0, 1),
    observed(year + 1, 0, 1),
    nthWeekday(year, 0, 1, 3),
    nthWeekday(year, 1, 1, 3),
    iso(easter(year) - 2 * DAY),
    nthWeekday(year, 8, 1, 1),
    nthWeekday(year, 9, 1, 2),
    observed(year, 10, 11),
    nthWeekday(year, 10, 4, 4),
    observed(year, 6, 4),
    observed(year, 11, 25),
  ]);
  // Juneteenth became a federal holiday in 2021; rate histories may expose extra closures.
  if (year >= 2021) holidays.add(observed(year, 5, 19));
  let memorial = Date.UTC(year, 5, 0);
  while (new Date(memorial).getUTCDay() !== 1) memorial -= DAY;
  holidays.add(iso(memorial));
  return !holidays.has(date);
}

export interface SofrProjection {
  asOfDate: string;
  source: 'CME SR1 + NY Fed SOFR';
  method: 'monthly-constant-overnight-proxy';
  nodes: FactorNode[];
  months: {
    month: string;
    instrumentId: string;
    expectedAverage: number;
    projectedOvernight: number;
    reconstructedAverage: number;
  }[];
  warnings: string[];
}

/** Fit SR1 arithmetic averages, then compound projected overnight accruals (ACT/360).
 * No swap/futures convexity model is inferred: this is explicitly an indicative proxy.
 */
export function projectSofr(
  asOfDate: string,
  contracts: CurveNode[],
  fixings: SofrFixing[],
  maxDays = 400,
): SofrProjection {
  const asOf = midnight(asOfDate),
    start = midnight(asOfDate.slice(0, 7) + '-01');
  if (!Number.isFinite(asOf) || iso(asOf) !== asOfDate || !Number.isInteger(maxDays) || maxDays < 1 || maxDays > 1000)
    throw new Error('SOFR projection tarihi/kapsamı geçersiz.');
  if (
    new Set(fixings.map(f => f.date)).size !== fixings.length ||
    fixings.some(
      f => !Number.isFinite(midnight(f.date)) || iso(midnight(f.date)) !== f.date || !sofrBusinessDay(f.date),
    )
  )
    throw new Error('SOFR fixing tarihi geçersiz veya yinelenmiş.');
  const historical = new Map(fixings.filter(f => f.date < asOfDate).map(f => [f.date, f.rate]));
  if (fixings.some(f => !Number.isFinite(f.rate) || f.rate <= -1 || f.rate > 1))
    throw new Error('SOFR fixing geçersiz.');
  let lastFix: number | undefined;
  for (let ms = start - DAY; ms >= start - 10 * DAY; ms -= DAY) {
    if (historical.has(iso(ms))) {
      lastFix = historical.get(iso(ms));
      break;
    }
  }
  if (lastFix == null) throw new Error('Ay başından önceki SOFR fixing eksik.');
  const byMonth = new Map<string, CurveNode>();
  for (const c of contracts) {
    const month = c.lastTradeTime.slice(0, 7);
    if (byMonth.has(month)) throw new Error('Aynı SR1 ayı için birden fazla kontrat var.');
    byMonth.set(month, c);
  }
  const projected = new Map<string, number>(),
    months: SofrProjection['months'] = [];
  let monthStart = start;
  while (monthStart < asOf + maxDays * DAY) {
    const d = new Date(monthStart),
      next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const month = iso(monthStart).slice(0, 7),
      contract = byMonth.get(month);
    if (!contract) throw new Error(`${month} SR1 kontratı eksik; faiz eğrisi uydurulmadı.`);
    const average = (100 - contract.settlement) / 100;
    if (!Number.isFinite(average) || average <= -1 || average > 1) throw new Error('SR1 fiyatı geçersiz.');
    let prior: number | undefined = lastFix,
      knownSum = 0,
      unknown = 0;
    const rates: { date: string; rate: number | undefined }[] = [];
    for (let ms = monthStart; ms < next; ms += DAY) {
      const date = iso(ms);
      if (sofrBusinessDay(date)) {
        if (date < asOfDate) {
          prior = historical.get(date);
          if (prior == null) throw new Error(`${date} gerçekleşmiş SOFR fixing eksik.`);
        } else prior = undefined;
      }
      rates.push({ date, rate: prior });
      if (prior == null) unknown++;
      else knownSum += prior;
    }
    if (!unknown) throw new Error('SR1 projection için ileri gün yok.');
    const rate = (average * rates.length - knownSum) / unknown;
    if (!(rate > -1 && rate < 1)) throw new Error('SR1 kalan-gün faizi geçersiz.');
    let sum = 0;
    for (const day of rates) {
      const value = day.rate ?? rate;
      projected.set(day.date, value);
      sum += value;
    }
    lastFix = rates.at(-1)!.rate ?? rate;
    months.push({
      month,
      instrumentId: contract.instrumentId,
      expectedAverage: average,
      projectedOvernight: rate,
      reconstructedAverage: sum / rates.length,
    });
    monthStart = next;
  }
  let df = 1,
    accruedDays = 0;
  // Carry into a weekend as-of uses the preceding business-day accrual period.
  if (!sofrBusinessDay(asOfDate)) {
    for (let ms = asOf - DAY; !sofrBusinessDay(iso(ms)); ms -= DAY) accruedDays++;
    accruedDays++;
  }
  const nodes: FactorNode[] = [{ at: asOfDate + 'T00:00:00.000Z', value: 1 }];
  for (let ms = asOf; ms < asOf + maxDays * DAY; ms += DAY) {
    const date = iso(ms),
      rate = projected.get(date);
    if (rate == null) throw new Error('SOFR projection kapsamı eksik.');
    if (sofrBusinessDay(date)) accruedDays = 0;
    const before = 1 + (rate * accruedDays) / 360,
      after = 1 + (rate * (accruedDays + 1)) / 360;
    if (!(before > 0 && after > 0)) throw new Error('SOFR iskonto faktörü geçersiz.');
    df *= before / after;
    accruedDays++;
    nodes.push({ at: new Date(ms + DAY).toISOString(), value: df });
  }
  return {
    asOfDate,
    source: 'CME SR1 + NY Fed SOFR',
    method: 'monthly-constant-overnight-proxy',
    nodes,
    months,
    warnings: [
      'Endikatif SOFR futures proxy; futures/swap konveksite düzeltmesi yok.',
      'Ayın bilinmeyen business-day gecelik faizleri ay içinde sabit varsayılır; FOMC gün içi dağılımı modellenmez.',
    ],
  };
}
