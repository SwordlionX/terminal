/* eslint-disable @typescript-eslint/no-require-imports -- Deterministic financial regression tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
const cache = new Map();
function load(file) {
  const full = path.resolve(__dirname, '..', file);
  if (cache.has(full)) return cache.get(full).exports;
  const fixture = { exports: {} };
  cache.set(full, fixture);
  const js = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, {
    module: fixture,
    exports: fixture.exports,
    require(id) {
      if (id.startsWith('node:')) return require(id);
      if (!id.startsWith('.')) throw new Error('Unapproved dependency: ' + id);
      let target = path.resolve(path.dirname(full), id);
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory())
        target += fs.existsSync(target + '.ts') ? '.ts' : '/index.ts';
      return load(target);
    },
  });
  return fixture.exports;
}
const {
  analyzeEuropeanPosition: analyze,
  analysisDates,
  expiryPayoffLimits,
} = load('src/lib/pricing/position-analysis.ts');
const { createToolExecutor } = load('src/lib/assistant/tools.ts');
const { calculatePricing } = load('src/lib/pricing/engine.ts');
const screen = {
  product: 'XAU',
  spot: 100,
  strike: 100,
  rate: 88,
  lease: -50,
  vol: 300,
  manualSpot: false,
  manualVol: false,
  contractSize: 10,
  basis: 365,
  tradeDate: '2026-01-01',
  expiryDate: '2026-04-01',
};
const surface = {
  symbol: 'GC',
  spot: 100,
  fetchedISO: '2026-01-01',
  builtWithR: 0.04,
  impliedLeaseRate: 0.01,
  expiries: [
    {
      days: 90,
      date: '2026-04-01',
      points: [
        { m: 0.65, iv: 0.2 },
        { m: 1.45, iv: 0.2 },
      ],
    },
    {
      days: 181,
      date: '2026-07-01',
      points: [
        { m: 0.65, iv: 0.22 },
        { m: 1.45, iv: 0.22 },
      ],
    },
  ],
};
const market = {
  product: 'XAU',
  spot: 100,
  spotSource: 'Terminal fixture',
  spotAt: '2026-01-01T00:00:00Z',
  surface,
  surfaceSource: 'cme',
};
const leg = (changes = {}, premium = 5) => ({
  option: {
    product: 'XAU',
    tradeDate: '2026-01-01',
    basis: 365,
    type: 'Put',
    position: 'Short',
    strike: 100,
    expiryDate: '2026-04-01',
    contractSize: 10,
    ...changes,
  },
  entryPremiumPerUnit: premium,
});
const near = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('European expiry grid uses intrinsic payoff; short put loss is finite and short call unbounded', () => {
  const put = analyze(screen, market, [leg()], 'Put', ['2026-04-01'], [-50, 0, 50]);
  near(put.rows[0].cells[0].pnl, -450);
  near(put.rows[1].cells[0].pnl, 50);
  near(put.limits.maxLoss, 950);
  near(put.limits.maxProfit, 50);
  near(put.limits.breakevens[0], 95);
  assert.equal(put.rows[0].cells[0].delta, null);
  assert.equal(put.rows[0].cells[0].gamma, null);
  const call = analyze(screen, market, [leg({ type: 'Call' })]);
  assert.equal(call.limits.maxLoss, null);
  near(call.limits.maxProfit, 50);
  near(call.limits.breakevens[0], 105);
});
test('hedged put spread caps loss independently of plotted price range', () => {
  const result = analyze(
    screen,
    market,
    [leg(), leg({ position: 'Long', strike: 90 }, 2)],
    'Spread',
    ['2026-04-01'],
    [-5, 0, 5],
  );
  near(result.limits.maxLoss, 70);
  near(result.limits.maxProfit, 30);
  near(result.limits.breakevens[0], 97);
  assert.ok(result.limits.maxLoss > -Math.min(...result.rows.map(r => r.cells[0].pnl)));
});
test('unequal quantities preserve the remaining naked call tail', () => {
  const result = analyze(screen, market, [
    leg({ type: 'Call', contractSize: 10 }),
    leg({ type: 'Call', position: 'Long', strike: 110, contractSize: 5 }, 2),
  ]);
  assert.equal(result.limits.maxLoss, null);
});
test('matched opposite trade offsets future market risk without rewriting historical premium', () => {
  const result = analyze(
    screen,
    market,
    [leg({}, 7), leg({ position: 'Long' }, 4)],
    'Ters işlem',
    ['2026-01-01', '2026-04-01'],
    [-10, 0, 10],
  );
  result.rows.forEach(r => r.cells.forEach(c => near(c.pnl, 30)));
  near(result.delta, 0);
  near(result.gamma, 0);
  near(result.entryCashflow, 30);
  near(result.modelCashflow, 0);
});
test('fully offset zero-payoff position reports a zero range rather than invented unique breakeven', () => {
  const result = analyze(screen, market, [leg(), leg({ position: 'Long' })]);
  assert.equal(result.limits.breakevens.length, 0);
  assert.equal(result.limits.flatZeroRanges.length, 1);
  assert.equal(result.limits.flatZeroRanges[0].from, 0);
  assert.equal(result.limits.flatZeroRanges[0].to, null);
});
test('before expiry the model value contains time value and equals the shared pricing engine', () => {
  const result = analyze(screen, market, [leg({ type: 'Call', position: 'Long' }, 0)], 'Call', ['2026-01-01'], [0]);
  const expected = calculatePricing(result.quotes[0].inputs, surface);
  near(result.rows[0].cells[0].pnl, expected.result.call * 10);
  assert.ok(result.rows[0].cells[0].pnl > 0);
});
test('manual screens and manual market overrides fail; curve rates replace screen assumptions', () => {
  assert.throws(() => analyze({ ...screen, manualVol: true }, market, [leg()]), /tutarlılığını bozar/);
  assert.throws(() => analyze({ ...screen, manualSpot: true }, market, [leg()]), /tutarlılığını bozar/);
  assert.throws(() => analyze(screen, market, [leg({ rate: 99 })]), /tutarlılığını bozar/);
  const r = analyze(screen, market, [leg()]);
  near(r.quotes[0].inputs.rate, 4);
  near(r.quotes[0].inputs.lease, 1);
  assert.equal(r.quotes[0].inputs.manualVol, false);
});
test('future scenario never mutates the market surface or input trades', () => {
  const legs = [leg()];
  const before = JSON.stringify({ screen, market, legs });
  analyze(screen, market, legs, 'Future', ['2026-01-01', '2026-03-01', '2026-04-01']);
  assert.equal(JSON.stringify({ screen, market, legs }), before);
});
test('unsupported smile cells remain absent rather than falling back to manual IV', () => {
  const result = analyze(screen, market, [leg()], 'Missing', ['2026-01-01', '2026-04-01'], [-90, 0]);
  assert.equal(result.rows[0].cells[0].pnl, null);
  assert.ok(result.rows[0].cells[0].reason);
  assert.equal(result.missingCells, 1);
  assert.ok(Number.isFinite(result.rows[0].cells[1].pnl));
});
test('different expiries cannot be evaluated after the first settlement or labelled common-expiry limits', () => {
  const legs = [leg(), leg({ position: 'Long', expiryDate: '2026-07-01' }, 4)];
  assert.throws(() => analyze(screen, market, legs, 'Mixed', ['2026-04-02']), /ilk vade arasında/);
  const result = analyze(screen, market, legs, 'Mixed', ['2026-01-01', '2026-04-01']);
  assert.equal(result.limits, null);
  assert.equal(result.allSameExpiry, false);
  assert.throws(() => expiryPayoffLimits(result.quotes, [5, 4]), /ortak vadede/);
});
test('bad quantities, historical premiums, barrier paths and foreign products fail clearly', () => {
  for (const quantity of [0, -1, Infinity, NaN])
    assert.throws(() => analyze(screen, market, [leg({ contractSize: quantity })]), /pozitif miktar/);
  assert.throws(() => analyze(screen, market, [leg({}, -1)]), /Geçmiş işlem primi/);
  assert.throws(() => analyze(screen, market, [leg({ product: 'XAG' })]), /aynı dayanak/);
  assert.throws(
    () => analyze(screen, market, [leg({ barrier: { variant: 'do', level: 80 } })]),
    /yalnız Avrupa tipi vanilya/,
  );
});
test('percentage denominator stays the reference nominal when protection legs are added', () => {
  const result = analyze(
    screen,
    market,
    [leg(), leg({ position: 'Long', strike: 90 }, 2)],
    'Spread',
    ['2026-04-01'],
    [0],
    10,
  );
  near(result.nominal, 1000);
  near(result.rows[0].cells[0].pnlPct, 3);
});
test('automatic dates are distinct for short maturities', () => {
  const dates = analysisDates('2026-01-01', '2026-01-02');
  assert.equal(dates.join(','), '2026-01-01,2026-01-02');
});
test('assistant emits the same deterministic analysis card with no model or research calls', async () => {
  const artifacts = [];
  let reads = 0;
  const tool = createToolExecutor(screen, '10 ons müşteri put satışının haritasını göster', {
    market: async () => {
      reads++;
      return market;
    },
    artifact: x => artifacts.push(x),
    research: async () => {
      throw new Error('Research not allowed');
    },
    signal: new AbortController().signal,
  });
  const result = await tool('analyze_position', { legs: [leg()], scenarioDate: '2026-03-01' });
  assert.equal(result.chartDelivered, true);
  assert.equal(artifacts[0].kind, 'position_analysis');
  assert.equal(reads, 1);
  const repeated = await tool('analyze_position', { scenarioDate: '2026-03-01', legs: [leg()] });
  assert.equal(repeated.chartDelivered, true);
  assert.equal(reads, 1);
  assert.equal(artifacts.length, 1);
});

test('model breakevens match the analytic expiry level and zero the P&L on every scenario date', () => {
  const result = analyze(screen, market, [leg()], 'Short put');
  const expiry = result.breakevens.at(-1);
  assert.equal(expiry.date, '2026-04-01');
  assert.equal(expiry.levels.length, 1);
  near(expiry.levels[0], 95, 1e-6); // strike 100 − entry premium 5
  near(expiry.levels[0], result.limits.breakevens[0], 1e-6);
  for (const { date, levels } of result.breakevens.slice(0, -1)) {
    assert.equal(levels.length, 1, date);
    const check = analyze(screen, market, [leg()], 'check', [date], [((levels[0] - 100) / 100) * 100]);
    near(check.rows[0].cells[0].pnl, 0, 1e-6);
  }
});
