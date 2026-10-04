/** Read-only audit of the privately cached, rebuilt market bundle; no Gemini or paid API calls. */
import { loadEnvConfig } from '@next/env';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { DatabentoCache } from './lib/databento-cache';
import { validatePricingBundle, type PricingBundle } from '../src/services/pricing-bundle.service';
import { calculatePricing } from '../src/lib/pricing/engine';
import { curveFactors } from '../src/lib/market/factors';
import type { CarrySnapshot } from '../src/lib/market/cme-carry';
import { inDeliveryPeriod } from '../src/lib/market/proxy-curves';
import type { VolSurface } from '../src/lib/vol/surface';
loadEnvConfig(process.cwd());
async function main() {
  const date = process.argv.find(a => a.startsWith('--date='))?.slice(7) ?? '2026-10-01';
  const data = new DatabentoCache(true);
  const bundle = JSON.parse(
    await readFile(path.join(data.cacheDir, 'pricing-bundle-' + date + '.json'), 'utf8'),
  ) as PricingBundle;
  validatePricingBundle(bundle);
  const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    const raw = await db.execute({ sql: 'SELECT v FROM kv WHERE k=?', args: ['databento_curve_inputs_v1:latest'] });
    const snapshot = JSON.parse(String(raw.rows[0].v)) as CarrySnapshot;
    if (snapshot.sessionDate !== date) throw new Error('Seans uyuşmuyor.');
    const valuation = new Date(Date.parse(date + 'T00:00:00Z') + 3 * 86400000).toISOString().slice(0, 10);
    const report: Record<string, unknown> = {
      bundleId: bundle.id,
      session: date,
      valuation,
      spotMode: 'Matched historical settlement spot; not a live quote',
      geminiRequests: 0,
      paidApiRequests: 0,
    };
    for (const product of ['XAU', 'XAG'] as const) {
      const surface = bundle.surfaces[product],
        c = surface.curves!,
        spot = c.referenceSpot.price;
      let maxFutureError = 0,
        testedNodes = 0,
        priced = 0,
        blocked = 0,
        maxParityError = 0,
        maxBasisError = 0;
      const root = product === 'XAU' ? 'GC' : 'SI';
      for (const n of snapshot.products[root].nodes) {
        if (inDeliveryPeriod(n.lastTradeTime, snapshot.sessionDate)) continue;
        try {
          const f = curveFactors(c, Date.parse(c.asOf), Date.parse(n.lastTradeTime));
          maxFutureError = Math.max(maxFutureError, Math.abs(spot * f.forwardRatio - n.settlement));
          testedNodes++;
        } catch {
          /* Nodes beyond the explicitly bounded USD/metal coverage cannot be used. */
        }
      }
      const samples = [];
      for (const days of [7, 30, 60, 90, 180, 270]) {
        for (const ratio of [0.9, 0.95, 1, 1.05, 1.1]) {
          const input = {
            spot,
            strike: spot * ratio,
            rate: 88,
            lease: -88,
            vol: 20,
            manualVol: false,
            manualSpot: false,
            contractSize: 10,
            basis: 365,
            tradeDate: valuation,
            expiryDate: new Date(Date.parse(valuation) + days * 86400000).toISOString().slice(0, 10),
          };
          const p = calculatePricing(input, surface),
            b = calculatePricing({ ...input, basis: 360, rate: -50, lease: 50 }, surface);
          if (!p.priceable) {
            blocked++;
            continue;
          }
          if (!b.priceable) throw new Error('Gün bazı fiyatlamayı bozdu.');
          priced++;
          maxParityError = Math.max(
            maxParityError,
            Math.abs(p.result.call - p.result.put - (spot * p.metalFactor! - input.strike * p.discountFactor!)),
          );
          maxBasisError = Math.max(
            maxBasisError,
            Math.abs(p.result.call - b.result.call),
            Math.abs(p.result.put - b.result.put),
          );
          if (days === 90 && ratio === 1)
            samples.push({
              days,
              strike: input.strike,
              forward: p.fwd,
              ratePct: p.displayRate,
              carryPct: p.displayLease,
              ivPct: p.effVol,
              callTotalUsd: p.result.call * 10,
              putTotalUsd: p.result.put * 10,
              callPctNominal: (p.result.call / spot) * 100,
              putPctNominal: (p.result.put / spot) * 100,
            });
        }
      }
      if (testedNodes < 3 || priced < 20 || maxFutureError > 1e-7 || maxParityError > 1e-7 || maxBasisError > 1e-8)
        throw new Error(product + ': gerçek veri doğrulaması başarısız.');
      const oldRaw = await db.execute({ sql: 'SELECT v FROM kv WHERE k=?', args: ['cme_surface_' + product] });
      const old = oldRaw.rows.length ? (JSON.parse(String(oldRaw.rows[0].v)) as VolSurface) : null;
      report[product] = {
        referenceSpot: c.referenceSpot,
        usdNodes: c.usd.length,
        metalNodes: c.metal.length,
        ivExpiries: surface.expiries.length,
        reconstructedFutureNodes: testedNodes,
        maxFutureError,
        pricedCases: priced,
        blockedCases: blocked,
        maxParityError,
        maxBasisError,
        samples,
        legacy: old
          ? {
              sourceAt: old.fetchedISO,
              builtRate: old.builtWithR,
              lease: old.impliedLeaseRate,
              comparison:
                'Legacy snapshot has a different source date; direct before/after premium attribution is not valid.',
            }
          : 'Legacy surface absent',
      };
    }
    for (const m of bundle.usd.months)
      if (Math.abs(m.expectedAverage - m.reconstructedAverage) > 1e-10)
        throw new Error('SR1 ay ortalaması yeniden üretilemiyor.');
    await writeFile(path.join(data.cacheDir, 'pricing-validation-' + date + '.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    db.close();
  }
}
main().catch(() => {
  console.error('Eğri doğrulaması başarısız; yeni sürüm etkinleştirilmedi.');
  process.exitCode = 1;
});
