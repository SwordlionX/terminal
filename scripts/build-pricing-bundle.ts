import { loadEnvConfig } from '@next/env';
import { createClient, type Client } from '@libsql/client';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DatabentoCache } from './lib/databento-cache';
import { loadSofrFixings, loadSettlementSpot } from './lib/curve-sources';
import { projectSofr, type SofrProjection } from '../src/lib/market/sofr';
import { factorAt } from '../src/lib/market/factors';
import { writeRefreshStatus } from './lib/refresh-status';
import { buildProxyCurves } from '../src/lib/market/proxy-curves';
import {
  publicationWindows,
  type CarrySnapshot,
} from '../src/lib/market/cme-carry';
import { buildCmeSurface } from '../src/lib/vol/cme';
import { parseOptionDefinitions, finalOptionSettlements } from '../src/lib/market/cme-option-inputs';
import { validatePricingBundle, type PricingBundle } from '../src/services/pricing-bundle.service';
import { writeFile } from 'node:fs/promises';
import type { VolSurface } from '../src/lib/vol/surface';
loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2),
    requested = args.find(a => a.startsWith('--date='))?.slice(7),
    write = args.includes('--write');
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('Turso bağlantısı eksik.');
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const result = await db.execute({ sql: 'SELECT v FROM kv WHERE k=?', args: ['databento_curve_inputs_v1:latest'] });
    if (!result.rows.length) throw new Error('Önce collect:cme:curves ile final futures girdileri kaydedilmeli.');
    const snapshot = JSON.parse(String(result.rows[0].v)) as CarrySnapshot & { rawHash: string; skipped?: string[] };
    // A newer session the collector passed over because its finals are not out yet.
    const pending = snapshot.skipped?.find(
      s => s.slice(0, 10) > snapshot.sessionDate && !s.includes('penceresi tamamlanmadı'),
    );
    const pendingText = pending ? `${pending.slice(0, 10)} seansının final settlementları henüz yayımlanmadı. ` : '';
    if (requested && requested !== snapshot.sessionDate)
      throw new Error('İstenen seans final girdi snapshot tarihiyle uyuşmuyor.');
    const date = snapshot.sessionDate;
    const latestRow = await db.execute({ sql: 'SELECT v FROM kv WHERE k=?', args: ['pricing_bundle_v2:latest'] });
    const latest = latestRow.rows.length ? (JSON.parse(String(latestRow.rows[0].v)) as PricingBundle) : null;
    if (
      !requested &&
      latest &&
      (latest.sessionDate > date ||
        (latest.sessionDate === date && latest.inputs?.curveRawHash === snapshot.rawHash && !latest.inputs.degraded))
    ) {
      if (write)
        await writeRefreshStatus({
          stage: 'bundle',
          result: pending ? 'waiting' : 'up_to_date',
          sessionDate: latest.sessionDate,
          sofrSession: latest.inputs?.sofrSession,
          message: pending
            ? `${pendingText}${latest.sessionDate} paketi kullanılıyor.`
            : 'Fiyatlama paketi güncel; yeni final veri yok.',
        });
      console.log(JSON.stringify({ upToDate: true, sessionDate: latest.sessionDate, id: latest.id }));
      return;
    }
    const data = new DatabentoCache(args.includes('--cache-only'), 2);
    const sourcesDir = path.join(data.cacheDir, 'curve-sources');
    const available = await data.availableEnd(),
      windows = publicationWindows(date);
    if (Date.parse(available) < Date.parse(windows.statistics.end)) throw new Error('Final yayın kapsamı eksik.');
    const sofr = await buildUsd(db, snapshot, sourcesDir, latest);
    const usd = sofr.usd;
    const surfaces = {} as Record<'XAU' | 'XAG', VolSurface>;
    const sources: string[] = [snapshot.rawHash, sofr.source];
    // Options settle with the futures; a late or weekend-delayed final gets one wider window.
    const statisticWindows = [{ start: date + 'T21:00:00Z', end: windows.statistics.end }];
    if (Date.parse(available) >= Date.parse(windows.statisticsExtended.end))
      statisticWindows.push({ start: date + 'T21:00:00Z', end: windows.statisticsExtended.end });
    // Build both metals before a single atomic activation; a half-bundle never replaces live curves.
    for (const product of ['XAU', 'XAG'] as const) {
      console.log(`[curve] ${product}: final opsiyon girdileri ve yeniden IV çözümü`);
      const spot = await loadSettlementSpot(sourcesDir, date, product),
        root = product === 'XAU' ? 'GC' : 'SI';
      const opt = product === 'XAU' ? 'OG' : 'SO';
      const symbols = [`${opt}.OPT`, ...[1, 2, 3, 4, 5].map(i => `${opt}${i}.OPT`)].join(',');
      const definitions = await data.download({
        dataset: 'GLBX.MDP3',
        start: windows.optionDefinitions.start,
        end: windows.optionDefinitions.end,
        stype_in: 'parent',
        symbols,
        schema: 'definition',
      });
      const options = parseOptionDefinitions(definitions.text);
      let optSettle = new Map<string, number>(),
        statistics: { sha256: string } | undefined,
        failure: unknown;
      for (const window of statisticWindows) {
        try {
          const downloaded = await data.download({
            dataset: 'GLBX.MDP3',
            start: window.start,
            end: window.end,
            stype_in: 'parent',
            symbols,
            schema: 'statistics',
          });
          optSettle = finalOptionSettlements(downloaded.text, date, options, product);
          statistics = downloaded;
          break;
        } catch (error) {
          failure = error;
        }
      }
      if (!statistics) throw failure;
      sources.push(JSON.stringify(spot), definitions.sha256, statistics.sha256);
      const curves = buildProxyCurves(snapshot, root, usd, spot, 'building');
      const nodes = snapshot.products[root].nodes;
      surfaces[product] = buildCmeSurface(
        {
          options,
          optSettle,
          futSettle: new Map(nodes.map(n => [n.instrumentId, n.settlement])),
          futureExpirations: new Map(nodes.map(n => [n.instrumentId, n.lastTradeTime])),
          curves,
          evalSec: Date.parse(spot.at) / 1000,
          fetchedISO: spot.at,
        },
        product,
        NaN,
      );
      if (surfaces[product].expiries.length < 3) throw new Error(`${product}: yeniden kurulan IV yüzeyi yetersiz.`);
    }
    const id = createHash('sha256')
      .update('proxy-v2.3:' + sources.join(':'))
      .digest('hex');
    for (const surface of Object.values(surfaces)) surface.curves!.id = id;
    const bundle: PricingBundle = {
      version: 2,
      id,
      sessionDate: date,
      builtAt: new Date().toISOString(),
      usd,
      surfaces,
      inputs: { curveRawHash: snapshot.rawHash, sofrSession: sofr.session, degraded: sofr.degraded },
    };
    validatePricingBundle(bundle);
    // Private local artifact allows validation/replay without new provider requests.
    await writeFile(path.join(data.cacheDir, 'pricing-bundle-' + date + '.json'), JSON.stringify(bundle));
    const json = JSON.stringify(bundle);
    let promoted = false;
    if (write) {
      const results = await db.batch(
        [
          {
            sql: 'INSERT INTO kv(k,v) VALUES (?,?) ON CONFLICT(k) DO NOTHING',
            args: [`pricing_bundle_v2:${date}:${id}`, json],
          },
          {
            sql: `INSERT INTO kv(k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v WHERE json_extract(kv.v,'$.sessionDate') <= json_extract(excluded.v,'$.sessionDate')`,
            args: ['pricing_bundle_v2:latest', json],
          },
        ],
        'write',
      );
      promoted = results[1].rowsAffected > 0;
      await writeRefreshStatus({
        stage: 'bundle',
        result: 'updated',
        sessionDate: date,
        sofrSession: sofr.session,
        message:
          pendingText +
          (sofr.degraded ? `Opsiyonlar güncellendi; ${sofr.note}` : 'Opsiyon, futures ve SOFR finalleri yüklendi.'),
      });
    }
    console.log(
      JSON.stringify(
        {
          id,
          date,
          written: write,
          promoted,
          usdMonths: usd.months.length,
          expiryCounts: Object.fromEntries(Object.entries(surfaces).map(([p, s]) => [p, s.expiries.length])),
          downloadEstimateUsd: data.newEstimateUsd,
          newDownloads: data.downloads,
          geminiRequests: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
}
/**
 * USD discount curve for the session. SOFR moves option values only marginally, so it never blocks
 * the option surfaces: missing SR1 finals fall back to the latest stored SR1 settlements, and a
 * failed projection falls back to the live bundle's curve re-based to the new session.
 */
async function buildUsd(
  db: Client,
  snapshot: CarrySnapshot,
  sourcesDir: string,
  latest: PricingBundle | null,
): Promise<{ usd: SofrProjection; source: string; session: string; degraded: boolean; note: string }> {
  const date = snapshot.sessionDate;
  let nodes = snapshot.products.SR1.nodes,
    session = date,
    note = '';
  if (!nodes.length) {
    const rows = await db.execute({
      sql: `SELECT v FROM kv WHERE k LIKE 'databento_curve_inputs_v1:%' AND k != 'databento_curve_inputs_v1:latest'
            AND json_extract(v,'$.sessionDate') < ? AND json_array_length(v,'$.products.SR1.nodes') > 0
            ORDER BY json_extract(v,'$.sessionDate') DESC LIMIT 1`,
      args: [date],
    });
    if (rows.rows.length) {
      const older = JSON.parse(String(rows.rows[0].v)) as CarrySnapshot;
      nodes = older.products.SR1.nodes;
      session = older.sessionDate;
      note = `SR1 finali gelmedi; ${session} SOFR futures settlementları kullanıldı.`;
    }
  }
  try {
    const { fixings, revised } = await loadSofrFixings(sourcesDir, date);
    const usd = projectSofr(date, nodes, fixings, 400);
    if (note) usd.warnings.push(note);
    if (revised.length) usd.warnings.push(`NY Fed revize SOFR fixingi kullanıldı: ${revised.join(', ')}.`);
    return { usd, source: JSON.stringify(fixings) + ':' + session, session, degraded: Boolean(note), note };
  } catch (error) {
    if (!latest) throw error;
    const reason = error instanceof Error ? error.message : 'SOFR eğrisi kurulamadı';
    const at = Date.parse(date + 'T00:00:00Z'),
      base = factorAt(latest.usd.nodes, at) ?? NaN;
    if (!(base > 0) || Date.parse(latest.usd.nodes.at(-1)!.at) < at + 180 * 86400000) throw error;
    note = `${reason} — ${latest.usd.asOfDate} USD eğrisi yeni seansa taşındı.`;
    const usd: SofrProjection = {
      ...latest.usd,
      asOfDate: date,
      nodes: [
        { at: date + 'T00:00:00.000Z', value: 1 },
        ...latest.usd.nodes.filter(n => Date.parse(n.at) > at).map(n => ({ at: n.at, value: n.value / base })),
      ],
      warnings: [...latest.usd.warnings.filter(w => !w.includes('USD eğrisi yeni seansa')), note],
    };
    return {
      usd,
      source: 'rebased:' + (latest.inputs?.sofrSession ?? latest.usd.asOfDate),
      session: latest.inputs?.sofrSession ?? latest.usd.asOfDate,
      degraded: true,
      note,
    };
  }
}

main().catch(async e => {
  const message = e instanceof Error ? e.message.replace(/db-[A-Za-z0-9]+/g, '[redacted]') : 'Eğri kurulamadı.';
  if (process.argv.includes('--write'))
    await writeRefreshStatus({
      stage: 'bundle',
      result: /yayın kapsamı eksik|final değil|settlement yok/i.test(message) ? 'waiting' : 'failed',
      message,
    });
  console.error(message);
  process.exitCode = 1;
});
