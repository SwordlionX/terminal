/* eslint-disable @typescript-eslint/no-require-imports -- Fully mocked storage/provider pipeline regression. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
function load(file, imports = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText,
    { module: mod, exports: mod.exports, require: name => imports[name], Error },
  );
  return mod.exports;
}
const carry = load('src/lib/market/cme-carry.ts');
const scope = load('src/lib/market/cme-option-scope.ts');
const optionInputs = load('src/lib/market/cme-option-inputs.ts', { './cme-carry': carry, './cme-option-scope': scope });
const date = '2026-10-12';
const ns = value => String(BigInt(Date.parse(value)) * 1000000n);
const defHeader = 'instrument_id,instrument_class,expiration,strike_price,underlying_id,security_update_action';
const statHeader = 'instrument_id,stat_type,price,ts_ref,ts_recv,ts_event,stat_flags,update_action';
const stat = (id, price = '2000000000', flags = 3) =>
  [id, 3, price, ns(date + 'T00:00:00Z'), ns(date + 'T23:36:00Z'), ns(date + 'T23:36:00Z'), flags, 1].join(',');

async function runPipeline(failure) {
  const events = [],
    batches = [],
    statuses = [],
    artifacts = [],
    logs = [],
    downloads = [];
  const node = { instrumentId: '77', settlement: 100, lastTradeTime: '2026-12-29T18:30:00Z' };
  const snapshot = {
    sessionDate: date,
    rawHash: 'fixture-hash',
    products: { GC: { nodes: [node] }, SI: { nodes: [node] }, SR1: { nodes: [node] } },
  };
  const db = {
    execute: async query => ({
      rows:
        query.args[0] === 'databento_curve_inputs_v1:latest'
          ? [{ v: JSON.stringify(snapshot) }]
          : query.args[0] === 'pricing_bundle_v3:latest' && failure?.latest
            ? [{ v: JSON.stringify(failure.latest) }]
            : [],
    }),
    batch: async queries => {
      events.push('activate');
      batches.push(queries);
      return [{ rowsAffected: 1 }, { rowsAffected: 1 }];
    },
    close: () => events.push('close'),
  };
  const csv = schema =>
    schema === 'definition'
      ? [
          defHeader,
          ['live', 'C', ns('2026-12-28T18:30:00Z'), '100000000000', '77', 'A'].join(','),
          ['expired', 'C', ns(date + 'T18:30:00Z'), '100000000000', '77', 'A'].join(','),
        ].join('\n')
      : [
          statHeader,
          stat('live', failure?.price ?? '2000000000', failure?.flags ?? 3),
          stat('expired', '9223372036854775807'),
        ].join('\n');
  class Cache {
    cacheDir = 'mock-cache';
    newEstimateUsd = 0;
    downloads = 0;
    availableEnd = async () => '2026-10-13T16:00:00Z';
    download = async args => ({ text: csv(args.schema), sha256: 'fixture-' + args.schema, cached: true });
  }
  const imports = {
    '@next/env': { loadEnvConfig: () => {} },
    '@libsql/client': { createClient: () => db },
    'node:crypto': crypto,
    'node:path': path,
    './lib/databento-cache': { DatabentoCache: Cache },
    './lib/databento-windows': {
      downloadWindowed: async (cache, args) => {
        downloads.push(args);
        return { text: csv('statistics'), sha256: 'fixture-statistics', cached: true };
      },
    },
    './lib/curve-sources': {
      loadSofrFixings: async () => ({ fixings: [], revised: [] }),
      loadSettlementSpot: async (_dir, _date, product) => {
        events.push('spot-' + product);
        return { price: 100, at: date + 'T23:35:00Z', source: 'fixture' };
      },
    },
    '../src/lib/market/sofr': { projectSofr: () => ({ nodes: [], months: [], warnings: [] }) },
    '../src/lib/market/factors': {
      factorAt: () => {
        throw new Error('Unexpected fallback');
      },
    },
    './lib/refresh-status': {
      writeRefreshStatus: async status => {
        statuses.push(status);
      },
    },
    '../src/lib/market/proxy-curves': { buildProxyCurves: () => ({ id: 'building' }) },
    '../src/lib/market/cme-carry': carry,
    '../src/lib/market/cme-option-inputs': optionInputs,
    // IV is tested with the real numerical model elsewhere. Here mock only the expensive
    // boundary, to verify ingestion and atomic activation without any external writes.
    '../src/lib/vol/cme': {
      buildCmeSurface: (inputs, product) => {
        assert.equal(inputs.optSettle.size, 1);
        assert.equal(inputs.optSettle.get('live'), 2);
        events.push('surface-' + product);
        if (failure?.surface === product) throw new Error(product + ': IV yüzeyi yetersiz');
        return {
          curves: inputs.curves,
          expiries: failure?.tooFew === product ? [{}, {}] : [{}, {}, {}],
          ...(failure?.quarantine
            ? {
                quarantinedExpiries: [
                  {
                    expiryAt: '2026-10-14T18:30:00Z',
                    date: '2026-10-14',
                    days: 2,
                    reason: 'zero_calibration',
                    instrumentIds: ['42762966'],
                    issueCount: 1,
                  },
                ],
              }
            : {}),
        };
      },
    },
    '../src/services/pricing-bundle.service': {
      validatePricingBundle: bundle => {
        assert.ok(bundle.surfaces.XAU && bundle.surfaces.XAG);
        events.push('validate');
      },
    },
    'node:fs/promises': {
      writeFile: async (...args) => {
        events.push('artifact');
        artifacts.push(args);
      },
    },
  };
  const source = fs
    .readFileSync('scripts/build-pricing-bundle.ts', 'utf8')
    .replace('main().catch(', 'module.exports.finished = main().catch(');
  const mod = { exports: {} },
    processMock = {
      argv: ['node', 'build-pricing-bundle.ts', '--write'],
      cwd: () => '/fixture',
      env: { TURSO_DATABASE_URL: 'mock-only', TURSO_AUTH_TOKEN: 'mock-only' },
      exitCode: 0,
    };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText,
    {
      module: mod,
      exports: mod.exports,
      Error,
      process: processMock,
      require: name => {
        if (!Object.hasOwn(imports, name)) throw new Error('Unexpected dependency: ' + name);
        return imports[name];
      },
      console: { log: message => logs.push(message), error: message => logs.push(message) },
    },
  );
  await mod.exports.finished;
  return { events, batches, statuses, artifacts, logs, downloads, exitCode: processMock.exitCode };
}

test('known expired sentinel is excluded; both metals validate before one atomic activation', async () => {
  const result = await runPipeline();
  assert.equal(result.exitCode, 0);
  assert.equal(result.batches.length, 1);
  assert.equal(result.batches[0].length, 2);
  assert.equal(result.batches[0][1].args[0], 'pricing_bundle_v3:latest');
  assert.equal(JSON.parse(result.batches[0][1].args[1]).version, 3);
  assert.ok(result.events.indexOf('surface-XAU') < result.events.indexOf('validate'));
  assert.ok(result.events.indexOf('surface-XAG') < result.events.indexOf('validate'));
  assert.ok(result.events.indexOf('validate') < result.events.indexOf('activate'));
  assert.equal(result.statuses.at(-1).result, 'updated');
});

test('in-scope sentinel fails immediately without wider-window download, artifact or activation', async () => {
  const result = await runPipeline({ price: '9223372036854775807' });
  assert.equal(result.exitCode, 1);
  assert.equal(result.downloads.length, 1);
  assert.equal(result.batches.length, 0);
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.statuses.at(-1).result, 'failed');
  assert.match(result.logs.at(-1), /priceStatus=sentinel/);
  assert.ok(!result.events.includes('spot-XAG'));
});

test('preliminary waits and attempts only the allowed wider window; no package is activated', async () => {
  const result = await runPipeline({ flags: 2 });
  assert.equal(result.exitCode, 1);
  assert.equal(result.downloads.length, 2);
  assert.equal(result.batches.length, 0);
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.statuses.at(-1).result, 'waiting');
});

test('failure on the second metal cannot replace latest with a half-package', async () => {
  const result = await runPipeline({ surface: 'XAG' });
  assert.equal(result.exitCode, 1);
  assert.ok(result.events.includes('surface-XAU'));
  assert.ok(result.events.includes('surface-XAG'));
  assert.equal(result.batches.length, 0);
  assert.equal(result.artifacts.length, 0);
  assert.equal(result.statuses.at(-1).result, 'failed');
});

test('quarantined expiries persist atomically in v3 and warn in refresh status', async () => {
  const result = await runPipeline({ quarantine: true });
  assert.equal(result.exitCode, 0);
  const bundle = JSON.parse(result.batches[0][1].args[1]);
  assert.equal(bundle.surfaces.XAU.quarantinedExpiries[0].instrumentIds[0], '42762966');
  assert.equal(bundle.surfaces.XAG.quarantinedExpiries.length, 1);
  assert.match(result.statuses.at(-1).message, /fiyatlamaya kapalı/);
  assert.ok(result.batches[0].every(q => q.args[0].startsWith('pricing_bundle_v3:')));
});

test('quarantine leaving fewer than three clean tenors cannot activate either metal', async () => {
  const result = await runPipeline({ quarantine: true, tooFew: 'XAG' });
  assert.equal(result.exitCode, 1);
  assert.equal(result.batches.length, 0);
  assert.equal(result.artifacts.length, 0);
});

test('up-to-date v3 keeps the coverage warning without another download or activation', async () => {
  const surface = { quarantinedExpiries: [{ date: '2026-10-14' }] };
  const result = await runPipeline({
    latest: {
      version: 3,
      id: 'current',
      sessionDate: date,
      inputs: { curveRawHash: 'fixture-hash', degraded: false },
      surfaces: { XAU: surface, XAG: {} },
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.batches.length, 0);
  assert.equal(result.downloads.length, 0);
  assert.equal(result.statuses.at(-1).result, 'up_to_date');
  assert.match(result.statuses.at(-1).message, /XAU: 1 vade.*fiyatlamaya kapalı/);
});
