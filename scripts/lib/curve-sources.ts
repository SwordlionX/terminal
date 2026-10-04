import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { TIINGO_KEY } from '../../src/services/market.service';
import type { SofrFixing } from '../../src/lib/market/sofr';
import type { PricingCurves } from '../../src/lib/market/factors';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
async function cachedJSON(dir: string, identity: string, fetcher: () => Promise<unknown>): Promise<unknown> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, hash(identity) + '.json');
  try {
    const stored = JSON.parse(await readFile(file, 'utf8'));
    if (stored.sha256 !== hash(JSON.stringify(stored.payload))) throw new Error('Kaynak cache checksum uyuşmuyor.');
    return stored.payload;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const payload = await fetcher();
  await writeFile(file + '.tmp', JSON.stringify({ sha256: hash(JSON.stringify(payload)), payload }));
  await rename(file + '.tmp', file);
  return payload;
}
export async function loadSofrFixings(cacheDir: string, sessionDate: string): Promise<SofrFixing[]> {
  const first = Date.parse(sessionDate.slice(0, 7) + '-01T00:00:00Z');
  const start = new Date(first - 10 * 86400000).toISOString().slice(0, 10);
  const end = new Date(Date.parse(sessionDate + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const payload = (await cachedJSON(cacheDir, `NYFed SOFR ${start} ${end}`, async () => {
    const p = new URLSearchParams({ startDate: start, endDate: end });
    const res = await fetch(`https://markets.newyorkfed.org/api/rates/secured/sofr/search.json?${p}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`NY Fed SOFR HTTP ${res.status}`);
    return res.json();
  })) as { refRates?: { effectiveDate: string; type: string; percentRate: number; revisionIndicator?: string }[] };
  if (!Array.isArray(payload.refRates) || !payload.refRates.length) throw new Error('NY Fed fixing kayıtları eksik.');
  const result: SofrFixing[] = [];
  for (const row of payload.refRates) {
    if (
      row.type !== 'SOFR' ||
      row.effectiveDate < start ||
      row.effectiveDate > end ||
      !Number.isFinite(row.percentRate)
    )
      throw new Error('NY Fed SOFR kaydı geçersiz.');
    if (row.revisionIndicator)
      throw new Error('Geçmiş SOFR revizyonu var; settlement anındaki sürüm ayrıca doğrulanmalı.');
    result.push({ date: row.effectiveDate, rate: row.percentRate / 100 });
  }
  return result;
}
export function metalSettlementTime(date: string, product: 'XAU' | 'XAG') {
  const noon = Date.parse(date + 'T12:00:00Z');
  const nyHour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(noon),
  );
  return noon + ((13 - nyHour) * 60 + (product === 'XAU' ? 30 : 25)) * 60000;
}
export async function loadSettlementSpot(
  cacheDir: string,
  sessionDate: string,
  product: 'XAU' | 'XAG',
): Promise<PricingCurves['referenceSpot']> {
  const ticker = product === 'XAU' ? 'xauusd' : 'xagusd',
    target = metalSettlementTime(sessionDate, product);
  const payload = (await cachedJSON(cacheDir, `Tiingo FX 1min ${ticker} ${sessionDate}`, async () => {
    const p = new URLSearchParams({
      startDate: sessionDate,
      endDate: sessionDate,
      resampleFreq: '1min',
      token: TIINGO_KEY,
    });
    const res = await fetch(`https://api.tiingo.com/tiingo/fx/${ticker}/prices?${p}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Tiingo geçmiş spot HTTP ${res.status}`);
    return res.json();
  })) as { date: string; close: number; ticker: string }[];
  if (!Array.isArray(payload)) throw new Error('Tiingo geçmiş spot kaydı eksik.');
  const bars = payload
    .filter(b => b.ticker === ticker && Date.parse(b.date) + 60000 <= target)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const bar = bars.at(-1);
  if (!bar || !Number.isFinite(bar.close) || bar.close <= 0 || target - (Date.parse(bar.date) + 60000) > 60000)
    throw new Error('Settlement saatine yakın gerçek metal spotu yok; taşıma oranı uydurulmadı.');
  return {
    price: bar.close,
    at: new Date(Date.parse(bar.date) + 60000).toISOString(),
    source: `Tiingo ${ticker} 1min close; CME settlement-window proxy`,
  };
}
