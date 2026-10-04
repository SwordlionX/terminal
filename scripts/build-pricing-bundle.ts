import { loadEnvConfig } from '@next/env';
import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DatabentoCache } from './lib/databento-cache';
import { loadSofrFixings, loadSettlementSpot } from './lib/curve-sources';
import { projectSofr } from '../src/lib/market/sofr';
import { buildProxyCurves } from '../src/lib/market/proxy-curves';
import { csvRows, nanosISO, parseSessionSettlements, publicationWindows, type CarrySnapshot } from '../src/lib/market/cme-carry';
import { buildCmeSurface, type CmeOptionDef } from '../src/lib/vol/cme';
import { validatePricingBundle, type PricingBundle } from '../src/services/pricing-bundle.service';
import { writeFile } from 'node:fs/promises';
import type { VolSurface } from '../src/lib/vol/surface';
loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2), requested = args.find(a => a.startsWith('--date='))?.slice(7), write = args.includes('--write');
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error('Turso bağlantısı eksik.');
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const result = await db.execute({ sql: 'SELECT v FROM kv WHERE k=?', args: ['databento_curve_inputs_v1:latest'] });
    if (!result.rows.length) throw new Error('Önce collect:cme:curves ile final futures girdileri kaydedilmeli.');
    const snapshot = JSON.parse(String(result.rows[0].v)) as CarrySnapshot & { rawHash: string };
    if (requested && requested !== snapshot.sessionDate) throw new Error('İstenen seans final girdi snapshot tarihiyle uyuşmuyor.');
    const data = new DatabentoCache(args.includes('--cache-only'), 2);
    const date = snapshot.sessionDate, sourcesDir = path.join(data.cacheDir, 'curve-sources');
    const available = await data.availableEnd(), windows = publicationWindows(date);
    if (Date.parse(available) < Date.parse(windows.statistics.end)) throw new Error('Final yayın kapsamı eksik.');
    const fixings = await loadSofrFixings(sourcesDir, date);
    const usd = projectSofr(date, snapshot.products.SR1.nodes, fixings, 400);
    const surfaces = {} as Record<'XAU' | 'XAG', VolSurface>;
    const sources: string[] = [snapshot.rawHash, JSON.stringify(fixings)];
    // Build both metals before a single atomic activation; a half-bundle never replaces live curves.
    for (const product of ['XAU', 'XAG'] as const) {
      console.log(`[curve] ${product}: final opsiyon girdileri ve yeniden IV çözümü`);
      const spot = await loadSettlementSpot(sourcesDir, date, product), root = product === 'XAU' ? 'GC' : 'SI';
      const opt = product === 'XAU' ? 'OG' : 'SO';
      const symbols = [`${opt}.OPT`, ...[1, 2, 3, 4, 5].map(i => `${opt}${i}.OPT`)].join(',');
      const files = [];
      for (const schema of ['definition', 'statistics'] as const) {
        // Late EOD window includes final revisions across midnight in CDT/CST.
        const win = schema === 'definition' ? windows.definitions : { start: date + 'T21:00:00Z', end: windows.statistics.end };
        files.push(await data.download({ dataset: 'GLBX.MDP3', start: win.start, end: win.end, stype_in: 'parent', symbols, schema }));
      }
      sources.push(JSON.stringify(spot), ...files.map(f => f.sha256));
      const options = new Map<string, CmeOptionDef>();
      for (const row of csvRows(files[0].text, ['instrument_id', 'instrument_class', 'expiration', 'strike_price', 'underlying_id', 'security_update_action'])) {
        if (row.security_update_action === 'D') { options.delete(row.instrument_id); continue; }
        if (row.instrument_class !== 'C' && row.instrument_class !== 'P') continue;
        const expiry = nanosISO(row.expiration), strike = Number(row.strike_price) / 1e9;
        if (!expiry || !Number.isFinite(strike) || strike <= 0 || strike >= 9e9) throw new Error('Opsiyon tanımı geçersiz.');
        options.set(row.instrument_id, { cls: row.instrument_class, expSec: Date.parse(expiry) / 1000, strike, und: row.underlying_id });
      }
      const stats = parseSessionSettlements(files[1].text, date), optSettle = new Map<string, number>();
      for (const [id, stat] of stats) {
        if (!options.has(id)) throw new Error('Final opsiyon settlement için tanım eksik.');
        if (!(stat.flags & 1) || stat.deleted || stat.price == null) throw new Error('Opsiyon settlement final değil veya geçersiz.');
        optSettle.set(id, stat.price);
      }
      const curves = buildProxyCurves(snapshot, root, usd, spot, 'building');
      const nodes = snapshot.products[root].nodes;
      surfaces[product] = buildCmeSurface({ options, optSettle, futSettle: new Map(nodes.map(n => [n.instrumentId, n.settlement])),
        futureExpirations: new Map(nodes.map(n => [n.instrumentId, n.lastTradeTime])), curves,
        evalSec: Date.parse(spot.at) / 1000, fetchedISO: spot.at }, product, NaN);
      if (surfaces[product].expiries.length < 3) throw new Error(`${product}: yeniden kurulan IV yüzeyi yetersiz.`);
    }
    const id = createHash('sha256').update('proxy-v2.3:' + sources.join(':')).digest('hex');
    for (const surface of Object.values(surfaces)) surface.curves!.id = id;
    const bundle: PricingBundle = { version: 2, id, sessionDate: date, builtAt: new Date().toISOString(), usd, surfaces };
    validatePricingBundle(bundle);
    // Private local artifact allows validation/replay without new provider requests.
    await writeFile(path.join(data.cacheDir, 'pricing-bundle-' + date + '.json'), JSON.stringify(bundle));
    const json = JSON.stringify(bundle); let promoted = false;
    if (write) {
      const results = await db.batch([
        { sql: 'INSERT INTO kv(k,v) VALUES (?,?) ON CONFLICT(k) DO NOTHING', args: [`pricing_bundle_v2:${date}:${id}`, json] },
        { sql: `INSERT INTO kv(k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v WHERE json_extract(kv.v,'$.sessionDate') <= json_extract(excluded.v,'$.sessionDate')`, args: ['pricing_bundle_v2:latest', json] },
      ], 'write'); promoted = results[1].rowsAffected > 0;
    }
    console.log(JSON.stringify({ id, date, written: write, promoted, usdMonths: usd.months.length,
      expiryCounts: Object.fromEntries(Object.entries(surfaces).map(([p, s]) => [p, s.expiries.length])),
      downloadEstimateUsd: data.newEstimateUsd, newDownloads: data.downloads, geminiRequests: 0 }, null, 2));
  } finally { db.close(); }
}
main().catch(e => { console.error(e instanceof Error ? e.message.replace(/db-[A-Za-z0-9]+/g, '[redacted]') : 'Eğri kurulamadı.'); process.exitCode = 1; });
