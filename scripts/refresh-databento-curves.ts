import { loadEnvConfig } from '@next/env';
import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import {
  buildCarrySnapshot,
  parseFutureDefinitions,
  parseSessionSettlements,
  publicationWindows,
  type FutureDefinition,
  type Settlement,
} from '../src/lib/market/cme-carry';
import { DatabentoCache } from './lib/databento-cache';
import { writeRefreshStatus } from './lib/refresh-status';

loadEnvConfig(process.cwd());
async function main() {
  const args = process.argv.slice(2),
    dateArg = args.find(x => x.startsWith('--date='))?.slice(7);
  const cacheOnly = args.includes('--cache-only'),
    write = args.includes('--write');
  if (cacheOnly && !dateArg) throw new Error('--cache-only için --date gerekli');
  const data = new DatabentoCache(cacheOnly);
  const availableEnd = cacheOnly ? null : await data.availableEnd();
  const candidates = dateArg
    ? [dateArg]
    : Array.from({ length: 12 }, (_, i) =>
        new Date(Date.parse(availableEnd!.slice(0, 10) + 'T00:00:00Z') - i * 86400000).toISOString().slice(0, 10),
      )
        .filter(date => ![0, 6].includes(new Date(date + 'T00:00:00Z').getUTCDay()))
        .slice(0, 5);
  const skipped: string[] = [];
  for (const date of candidates) {
    const windows = publicationWindows(date);
    if (availableEnd && Date.parse(availableEnd) < Date.parse(windows.statistics.end)) {
      skipped.push(`${date}: final yayın penceresi tamamlanmadı`);
      continue;
    }
    // Standard window first; the extended window catches late or weekend-delayed finals.
    const statisticWindows = [windows.statistics];
    if (!availableEnd || Date.parse(availableEnd) >= Date.parse(windows.statisticsExtended.end))
      statisticWindows.push(windows.statisticsExtended);
    const collect = async (statisticsWindow: { start: string; end: string }) => {
      const definitions = new Map<string, FutureDefinition>(),
        settlements = new Map<string, Settlement>();
      const files: { symbols: string; schema: string; sha256: string; cached: boolean }[] = [];
      // Four small requests per window: SOFR and metal futures from the same final publication.
      for (const symbols of ['SR1.FUT,SR3.FUT', 'GC.FUT,SI.FUT']) {
        for (const schema of ['definition', 'statistics'] as const) {
          const window = schema === 'definition' ? windows.definitions : statisticsWindow;
          const downloaded = await data.download({
            dataset: 'GLBX.MDP3',
            start: window.start,
            end: window.end,
            stype_in: 'parent',
            symbols,
            schema,
          });
          files.push({ symbols, schema, sha256: downloaded.sha256, cached: downloaded.cached });
          if (schema === 'definition')
            for (const [id, def] of parseFutureDefinitions(downloaded.text)) definitions.set(id, def);
          else for (const [id, stat] of parseSessionSettlements(downloaded.text, date)) settlements.set(id, stat);
        }
      }
      return { snapshot: buildCarrySnapshot(date, definitions, settlements, new Date().toISOString()), files };
    };
    let collected: Awaited<ReturnType<typeof collect>> | undefined, failure: unknown;
    for (const statisticsWindow of statisticWindows) {
      try {
        const attempt = await collect(statisticsWindow);
        // Metal finals present; keep looking only when SOFR finals are still missing.
        if (!collected || (collected.snapshot.products.SR1.unavailable && !attempt.snapshot.products.SR1.unavailable))
          collected = attempt;
        if (!collected.snapshot.products.SR1.unavailable) break;
      } catch (error) {
        failure = error;
        if (cacheOnly) break;
      }
    }
    if (!collected) {
      skipped.push(`${date}: ${failure instanceof Error ? failure.message : 'eksik veri'}`);
      if (dateArg) throw failure;
      continue;
    }
    const { snapshot, files } = collected;
    // Diagnostic storage is deliberately separate from cme_surface_* / interest_rate.
    const rawHash = createHash('sha256')
      .update(files.map(f => f.sha256).join(':'))
      .digest('hex');
    const record = {
      ...snapshot,
      rawHash,
      files,
      publicationWindows: windows,
      skipped,
      fundingCurveStatus: 'SOFR futures raw inputs; fixing/accrual/calendar/convexity modelling pending',
      metalCurveStatus: 'Futures last-trade proxy; bank value dates and USD discount curve pending',
    };
    let latestPromoted = false;
    if (write) {
      if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('Turso bağlantısı eksik');
      const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
      try {
        const json = JSON.stringify(record);
        const results = await db.batch(
          [
            {
              sql: 'INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO NOTHING',
              args: [`databento_curve_inputs_v1:${date}:${rawHash}`, json],
            },
            {
              sql: `INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v
            WHERE json_extract(kv.v, '$.sessionDate') <= json_extract(excluded.v, '$.sessionDate')`,
              args: ['databento_curve_inputs_v1:latest', json],
            },
          ],
          'write',
        );
        latestPromoted = results[1].rowsAffected > 0;
      } finally {
        db.close();
      }
    }
    console.log(
      JSON.stringify(
        {
          sessionDate: date,
          status: snapshot.status,
          pricingReady: snapshot.pricingReady,
          counts: Object.fromEntries(Object.entries(snapshot.products).map(([root, p]) => [root, p.nodes.length])),
          newDownloads: data.downloads,
          newDownloadEstimateUsd: data.newEstimateUsd,
          cachedFiles: files.filter(x => x.cached).length,
          databaseWritten: write,
          latestPromoted,
          rawHash,
          skipped,
        },
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(`Tam final veri bulunamadı: ${skipped.join(' | ')}`);
}
main().catch(async error => {
  await writeRefreshStatus({
    stage: 'collect',
    result: 'failed',
    message:
      error instanceof Error ? error.message.replace(/db-[A-Za-z0-9]+/g, '[redacted]') : 'Veri kontrolü başarısız',
  });
  console.error(
    error instanceof Error ? error.message.replace(/db-[A-Za-z0-9]+/g, '[redacted]') : 'Veri kontrolü başarısız',
  );
  process.exitCode = 1;
});
