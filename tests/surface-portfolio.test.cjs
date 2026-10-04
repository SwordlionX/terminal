/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');

function load(file, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(output, {
    module: loadedModule,
    exports: loadedModule.exports,
    require(id) {
      if (Object.hasOwn(imports, id)) return imports[id];
      throw new Error(`Unmocked dependency: ${id}`);
    },
  });
  return loadedModule.exports;
}

const ssvi = load('src/lib/vol/ssvi.ts');
const surface = load('src/lib/vol/surface.ts', {
  './ssvi': ssvi,
});
const smile = (days, points) => ({ days, date: `day-${days}`, points });
const broad = [
  { m: 0.8, iv: 0.2 },
  { m: 1, iv: 0.25 },
  { m: 1.2, iv: 0.3 },
];

test('exact first, interior, and last tenors use only their own smile coverage', () => {
  const volSurface = {
    expiries: [
      smile(30, broad),
      smile(60, [
        { m: 0.9, iv: 0.4 },
        { m: 1, iv: 0.45 },
        { m: 1.1, iv: 0.5 },
      ]),
      smile(90, broad),
    ],
  };
  assert.equal(surface.surfaceVol(volSurface, 0.85, 30), 0.2125); // next tenor lacks this strike
  assert.ok(Math.abs(surface.surfaceVol(volSurface, 1.05, 60) - 0.475) < 1e-12);
  assert.ok(Math.abs(surface.surfaceVol(volSurface, 1.15, 90) - 0.2875) < 1e-12);
  assert.equal(surface.surfaceVol(volSurface, 0.85, 90), 0.2125);
  for (const [m, days] of [
    [1, NaN],
    [Infinity, 30],
    [0, 30],
    [1, 0],
    [1, Infinity],
  ]) {
    assert.equal(surface.surfaceVol(volSurface, m, days), null);
  }
});

test('between-tenor variance interpolation still requires both smiles', () => {
  const volSurface = {
    expiries: [
      smile(30, broad),
      smile(60, [
        { m: 0.9, iv: 0.4 },
        { m: 1, iv: 0.45 },
        { m: 1.1, iv: 0.5 },
      ]),
    ],
  };
  assert.equal(surface.surfaceVol(volSurface, 0.85, 45), null);
  const expected = Math.sqrt((0.5 * 0.25 ** 2 * (30 / 365) + 0.5 * 0.45 ** 2 * (60 / 365)) / (45 / 365));
  assert.ok(Math.abs(surface.surfaceVol(volSurface, 1, 45) - expected) < 1e-12);
  assert.equal(surface.surfaceVol(volSurface, 1, 29), null);
  assert.equal(surface.surfaceVol(volSurface, 1, 61), null);
});

function portfolioFixture(trades, quotes = {}) {
  const requested = [];
  const db = { trades: { findMany: async () => trades }, customers: { findMany: async () => [] } };
  const service = load('src/services/portfolio.service.ts', {
    '@/services/mockDb': { db },
    '@/services/market.service': {
      getSpot: async product => {
        requested.push(product);
        if (Object.hasOwn(quotes, product)) return quotes[product];
        return null;
      },
    },
  });
  return { requested, evaluatePortfolio: service.evaluatePortfolio };
}

const trade = (changes = {}) => ({
  id: 't1',
  customerId: 'c1',
  underlying: 'XAU',
  type: 'Call',
  position: 'Long',
  tradeDate: '2026-01-01',
  expiryDate: '2027-01-01',
  spot: 100,
  strike: 90,
  contractSize: 2,
  premium: 10,
  status: 'Open',
  ...changes,
});

test('closed and expired products are excluded from spot requests and portfolio rows', async () => {
  const f = portfolioFixture(
    [
      trade(),
      trade({ id: 'closed', underlying: 'DELISTED', status: 'Closed' }),
      trade({ id: 'expired', underlying: 'UNSUPPORTED', status: 'Expired' }),
    ],
    { XAU: { price: 100 } },
  );
  const result = await f.evaluatePortfolio();
  assert.deepEqual(f.requested, ['XAU']);
  assert.equal(result.trades.map(row => row.trade.id).join(','), 't1');
  assert.equal(result.trades[0].pnl, 10); // intrinsic 20 less premium 10
});

test('zero open trades make no quote requests', async () => {
  const f = portfolioFixture([
    trade({ status: 'Closed' }),
    trade({ id: 'expired', status: 'Expired', underlying: 'UNKNOWN' }),
  ]);
  const result = await f.evaluatePortfolio();
  assert.equal(f.requested.length, 0);
  assert.equal(result.trades.length, 0);
});

test('a missing quote for an active product still fails explicitly', async () => {
  const f = portfolioFixture([trade()]);
  await assert.rejects(f.evaluatePortfolio(), /Canlı spot alınamadı: XAU/);
});
