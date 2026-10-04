export interface SpotHistoryBar {
  date: string;
  high: number;
  low: number;
}
export interface BarrierHistoryReport {
  status: 'touch_observed' | 'no_touch_observed' | 'unavailable';
  source: string;
  checkedAt: string;
  startDate: string;
  endDate: string;
  bars: number;
  firstDate?: string;
  lastDate?: string;
  touchDate?: string;
  observedExtreme?: number;
  note: string;
}

export function validHistoryDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

/** Tarama yalnız sağlayıcının spot barları için gözlem üretir; sözleşme kapanışı değildir. */
export function scanBarrierHistory(
  raw: unknown,
  ticker: string,
  barrierType: string,
  level: number,
  startDate: string,
  endDate: string,
  checkedAt: string,
): BarrierHistoryReport {
  const base = { source: `Tiingo ${ticker.toUpperCase()} spot OHLC`, checkedAt, startDate, endDate };
  const unavailable = (note: string): BarrierHistoryReport => ({ ...base, status: 'unavailable', bars: 0, note });
  if (
    !['xauusd', 'xagusd'].includes(ticker) ||
    !validHistoryDate(startDate) ||
    !validHistoryDate(endDate) ||
    endDate < startDate ||
    !Number.isFinite(level) ||
    level <= 0 ||
    !['Knock Out Up', 'Knock Out Down', 'Knock In Up', 'Knock In Down'].includes(barrierType)
  ) {
    return unavailable('Bariyer veya gözlem aralığı geçersiz.');
  }
  if (!Array.isArray(raw) || raw.length === 0)
    return unavailable('Geçmiş spot verisi alınamadı; değmedi sonucu çıkarılamaz.');
  const bars: SpotHistoryBar[] = [];
  let rejected = 0;
  for (const row of raw) {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.date !== 'string' ||
      !Number.isFinite(Date.parse(row.date)) ||
      (row.ticker !== undefined && (typeof row.ticker !== 'string' || row.ticker.toLowerCase() !== ticker)) ||
      typeof row.high !== 'number' ||
      typeof row.low !== 'number' ||
      !Number.isFinite(row.high) ||
      !Number.isFinite(row.low) ||
      row.low <= 0 ||
      row.high < row.low
    ) {
      rejected++;
      continue;
    }
    const date = new Date(row.date).toISOString().slice(0, 10);
    if (date >= startDate && date <= endDate) bars.push({ date, high: row.high, low: row.low });
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  if (!bars.length) return unavailable('Gözlem aralığında geçerli spot barı yok; doğrulanamadı.');
  const up = barrierType.endsWith(' Up');
  const touch = bars.find(bar => (up ? bar.high >= level : bar.low <= level));
  return {
    ...base,
    status: touch ? 'touch_observed' : 'no_touch_observed',
    bars: bars.length,
    firstDate: bars[0].date,
    lastDate: bars[bars.length - 1].date,
    touchDate: touch?.date,
    observedExtreme: touch ? (up ? touch.high : touch.low) : undefined,
    note: `${touch ? 'Spot barında seviyeye erişim gözlendi.' : "Alınan spot barlarında değme gözlenmedi; kesin 'değmedi' onayı değildir."} Günlük bar taramasıdır; ilk/son günün işlem saatini ve bid/ask sözleşme koşulunu teyit edin. Veri kapsamının eksiksizliği doğrulanmadı.${rejected ? ` ${rejected} geçersiz bar atlandı.` : ''} İşlem durumu, teminat ve K/Z değiştirilmedi.`,
  };
}
