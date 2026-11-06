/* eslint-disable @typescript-eslint/no-require-imports -- Mocked database, real bundle validation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');

function load(file, imports = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      module: mod,
      exports: mod.exports,
      require: id => {
        if (!Object.hasOwn(imports, id)) throw new Error('Unexpected dependency: ' + id);
        return imports[id];
      },
    },
  );
  return mod.exports;
}
const factors = load('src/lib/market/factors.ts');
const DAY = 86400000;
const reference = Date.parse('2026-11-04T18:30:00Z');
const at = days => new Date(reference + days * DAY).toISOString();
const coordinates = days => ({ days, expiryAt: at(days), date: at(days).slice(0, 10) });
function fixture(version = 3) {
  const discount = [
    { at: at(0), value: 1 },
    { at: at(400), value: 0.95 },
  ];
  const curves = {
    version: 2,
    id: 'test-bundle',
    method: 'CME-SOFR-indicative-proxy',
    asOf: at(0),
    referenceSpot: { at: at(0), price: 100 },
    usd: discount,
    metal: discount,
  };
  const surface = {
    symbol: 'XAU',
    spot: 100,
    fetchedISO: at(0),
    curves,
    expiries: [10, 30, 60].map(days => ({
      ...coordinates(days),
      underlyingId: '100',
      underlyingLastTradeTime: at(100),
      f: 100,
      points: [0.9, 1, 1.1].map(m => ({ m, iv: 0.2 })),
    })),
  };
  return {
    version,
    id: curves.id,
    sessionDate: '2026-11-04',
    builtAt: at(1),
    usd: { asOfDate: '2026-11-04', nodes: [{ at: '2026-11-04T00:00:00Z', value: 1 }, ...discount.slice(1)] },
    surfaces: { XAU: surface, XAG: { ...structuredClone(surface), symbol: 'XAG' } },
  };
}
const quarantine = () => ({
  ...coordinates(20),
  reason: 'zero_calibration',
  instrumentIds: ['42762966'],
  issueCount: 1,
});
function service(values = {}) {
  const queried = [];
  const api = load('src/services/pricing-bundle.service.ts', {
    '../lib/market/factors': factors,
    '../lib/db': {
      dbc: async () => ({
        execute: async query => {
          const key = query.args[0];
          queried.push(key);
          return { rows: Object.hasOwn(values, key) ? [{ v: values[key] }] : [] };
        },
      }),
    },
  });
  return { ...api, queried };
}

test('V3 admits healthy tenors plus explicit quarantine; V2 rejects quarantine metadata', () => {
  const { validatePricingBundle } = service();
  const bundle = fixture();
  bundle.surfaces.XAU.quarantinedExpiries = [quarantine()];
  validatePricingBundle(bundle);
  bundle.surfaces.XAG.quarantinedExpiries = [
    {
      ...coordinates(20),
      reason: 'forward_vol_outlier',
      instrumentIds: [],
      issueCount: 0,
    },
  ];
  validatePricingBundle(bundle);
  assert.throws(() => validatePricingBundle({ ...bundle, version: 2 }), /sürüm 3/);
  validatePricingBundle(fixture(2));
});

test('V3 requires at least three ordered, dated, ATM-bracketing usable tenors', () => {
  const { validatePricingBundle } = service();
  const mutations = [
    surface => surface.expiries.pop(),
    surface => surface.expiries.reverse(),
    surface => {
      surface.expiries[0].days += 0.1;
    },
    surface => {
      surface.expiries[0].date = '2026-11-15';
    },
    surface => {
      surface.expiries[0].f = 0;
    },
    surface => {
      surface.fetchedISO = at(1);
    },
    surface => {
      surface.expiries[0].points = [1.1, 1.2, 1.3].map(m => ({ m, iv: 0.2 }));
    },
  ];
  for (const mutate of mutations) {
    const bundle = fixture();
    mutate(bundle.surfaces.XAU);
    assert.throws(() => validatePricingBundle(bundle), /vade kapsamı/);
  }
});

test('invalid or ambiguous quarantine metadata cannot be published', () => {
  const { validatePricingBundle } = service();
  const mutations = [
    q => {
      q.expiryAt = 'invalid';
    },
    q => {
      q.date = '2026-02-31';
    },
    q => {
      q.days = NaN;
    },
    q => {
      q.days = 21;
    },
    q => {
      q.reason = 'unknown';
    },
    q => {
      q.issueCount = 0;
    },
    q => {
      q.issueCount = 1.5;
    },
    q => {
      q.instrumentIds = [];
    },
    q => {
      q.instrumentIds = ['42762966', '42762966'];
      q.issueCount = 2;
    },
    q => {
      q.instrumentIds = Array.from({ length: 13 }, (_, i) => String(i));
      q.issueCount = 13;
    },
    q => {
      Object.assign(q, coordinates(10));
    },
  ];
  for (const mutate of mutations) {
    const bundle = fixture(),
      q = quarantine();
    mutate(q);
    bundle.surfaces.XAU.quarantinedExpiries = [q];
    assert.throws(() => validatePricingBundle(bundle), /karantina/);
  }
  for (const quarantinedExpiries of [null, {}, [quarantine(), quarantine()]]) {
    const bundle = fixture();
    bundle.surfaces.XAU.quarantinedExpiries = quarantinedExpiries;
    assert.throws(() => validatePricingBundle(bundle), /karantina/);
  }
});

test('reader prefers isolated V3 key and only falls back when it is absent', async () => {
  const v3 = fixture(),
    v2 = fixture(2);
  const current = service({
    'pricing_bundle_v3:latest': JSON.stringify(v3),
    'pricing_bundle_v2:latest': JSON.stringify(v2),
  });
  assert.equal((await current.loadPricingBundle()).version, 3);
  assert.deepEqual(current.queried, ['pricing_bundle_v3:latest']);
  const legacy = service({ 'pricing_bundle_v2:latest': JSON.stringify(v2) });
  assert.equal((await legacy.loadPricingBundle()).version, 2);
  assert.deepEqual(legacy.queried, ['pricing_bundle_v3:latest', 'pricing_bundle_v2:latest']);
  assert.equal(await service().loadPricingBundle(), null);
});

test('corrupt or mismatched V3 fails closed without silently returning the older package', async () => {
  const invalid = fixture();
  invalid.surfaces.XAU.quarantinedExpiries = [{ ...quarantine(), days: 999 }];
  for (const value of ['broken JSON', JSON.stringify(fixture(2)), JSON.stringify(invalid)]) {
    const api = service({ 'pricing_bundle_v3:latest': value, 'pricing_bundle_v2:latest': JSON.stringify(fixture(2)) });
    await assert.rejects(api.loadPricingBundle());
    assert.deepEqual(api.queried, ['pricing_bundle_v3:latest']);
  }
});
