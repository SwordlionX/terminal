/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');

function load(file, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(output, { module: loadedModule, exports: loadedModule.exports, require(id) {
    if (Object.hasOwn(imports, id)) return imports[id];
    throw new Error(`Unmocked dependency: ${id}`);
  } });
  return loadedModule.exports;
}

const ssvi = load('src/lib/vol/ssvi.ts');
const gkMath = load('src/lib/math/gk.ts');
const surface = load('src/lib/vol/surface.ts', { './ssvi': ssvi,
});
const slice = (days, points) => ({ days, date: '2026-04-01', points });
const market = (...expiries) => ({ symbol: 'TEST', spot: 100, fetchedISO: '2026-01-01T18:00:00Z', expiries });
const modelPoints = (days, theta, rho = -0.35, phi = 2.4) =>
  [0.78, 0.83, 0.88, 0.94, 1, 1.06, 1.12, 1.18, 1.24].map(m => ({ m,
    iv: Math.sqrt(ssvi.ssviTotalVariance({ theta, rho, phi }, Math.log(m)) / (days / 365)),
  }));

test('constrained SSVI fits synthetic quotes and joins wings continuously', () => {
  const days = 90, points = modelPoints(days, 0.2 ** 2 * days / 365);
  const surfaceData = market(slice(days, points));
  const fit = ssvi.fitSsvi(points, days);
  assert.ok(fit);
  assert.equal(ssvi.ssviButterflySafe(fit), true);
  assert.equal(ssvi.ssviSafeAtDays(fit, 1), true);
  assert.ok(fit.rmseVol < 1e-4);
  assert.ok(fit.maxErrorVol < 2e-4);
  assert.equal(surface.surfaceVolEstimate(surfaceData, 1, days).mode, 'model');
  const edge = points[points.length - 1].m;
  const justInside = surface.surfaceVolEstimate(surfaceData, edge - 1e-7, days);
  const justOutside = surface.surfaceVolEstimate(surfaceData, edge + 1e-7, days);
  assert.equal(justOutside.mode, 'extrapolated');
  assert.ok(Math.abs(justInside.vol - justOutside.vol) < 1e-5);
  assert.equal(surface.surfaceVolEstimate(surfaceData, 1.4, days).mode, 'extrapolated');
  assert.equal(surface.surfaceVolEstimate(surfaceData, 1.4, 1, '2026-03-31').mode, 'extrapolated');
  assert.equal(surface.surfaceVolEstimate(surfaceData, 2.2, days).mode, 'unavailable');
});

test('accepted SSVI smile produces finite decreasing convex call prices across its wing', () => {
  const days = 90;
  const s = market(slice(days, modelPoints(days, 0.2 ** 2 * days / 365)));
  const norm = x => {
    const z = Math.abs(x);
    const t = 1 / (1 + 0.2316419 * z);
    const d = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
    const tail = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x >= 0 ? 1 - tail : tail;
  };
  const prices = [];
  for (let i = 0; i <= 120; i++) {
    const strike = 0.64 + i * 0.006;
    const e = surface.surfaceVolEstimate(s, strike, days);
    assert.ok(e.vol && e.vol > 0);
    const st = e.vol * Math.sqrt(days / 365);
    const d1 = (-Math.log(strike) + st * st / 2) / st;
    const d2 = d1 - st;
    const call = norm(d1) - strike * norm(d2);
    assert.ok(Number.isFinite(call) && call >= 0);
    prices.push(call);
  }
  for (let i = 1; i < prices.length - 1; i++) {
    assert.ok(prices[i] <= prices[i - 1] + 1e-8);
    assert.ok(prices[i - 1] - 2 * prices[i] + prices[i + 1] >= -2e-6);
  }
});

test('sparse, duplicated, and inconsistent quotes refuse modeled wings', () => {
  const sparse = market(slice(90, [{ m: 0.8, iv: 0.2 }, { m: 1, iv: 0.21 }, { m: 1.2, iv: 0.22 }]));
  assert.equal(surface.surfaceVolEstimate(sparse, 1, 90).mode, 'observed');
  assert.equal(surface.surfaceVolEstimate(sparse, 1.3, 90).mode, 'unavailable');
  const duplicated = market(slice(90, [{ m: 0.8, iv: 0.2 }, { m: 0.9, iv: 0.2 },
    { m: 1, iv: 0.2 }, { m: 1, iv: 0.21 }, { m: 1.1, iv: 0.2 }, { m: 1.2, iv: 0.2 }]));
  assert.match(surface.surfaceVolEstimate(duplicated, 1.05, 90).reason, /yinelenmiş/);
  const jagged = market(slice(90, [{ m: 0.8, iv: 0.13 }, { m: 0.9, iv: 0.5 },
    { m: 1, iv: 0.13 }, { m: 1.1, iv: 0.5 }, { m: 1.2, iv: 0.13 }]));
  assert.equal(surface.surfaceVolEstimate(jagged, 1.3, 90).mode, 'unavailable');
});

test('exact tenor, variance time interpolation, calendar guard, and expiry age', () => {
  const broad = [{ m: 0.8, iv: 0.2 }, { m: 1, iv: 0.25 }, { m: 1.2, iv: 0.3 }];
  const higher = broad.map(p => ({ m: p.m, iv: p.iv + 0.1 }));
  const s = market(slice(30.5, broad), slice(60.5, higher));
  assert.equal(surface.surfaceVolEstimate(s, 1, 30.5).vol, 0.25);
  assert.equal(surface.surfaceVolEstimate(s, 1, 29.5, '2026-01-02').vol, 0.25);
  assert.equal(surface.surfaceVolEstimate(s, 1, 30.5, '2026-01-02').mode, 'interpolated');
  assert.equal(surface.surfaceVolEstimate(s, 1, 45.5, '2026-01-02').mode, 'interpolated');
  assert.equal(surface.surfaceVolEstimate(s, 1, 60.5, '2026-01-02').mode, 'unavailable');
  assert.equal(surface.surfaceVolEstimate(s, 1, 1, '2026-03-05').mode, 'unavailable');
  const inverted = market(slice(30, broad.map(p => ({ ...p, iv: 0.6 }))), slice(60, broad));
  assert.match(surface.surfaceVolEstimate(inverted, 1, 45).reason, /takvim arbitrajı/);
});

test('manual pricing is blocked even without a source curve or with invalid inputs', () => {
  let md = { product: 'XAU', spot: 100, strike: 100, rate: 5, lease: 1,
    vol: 20, manualVol: true, manualSpot: true, contractSize: 100, basis: 365,
    tradeDate: '2026-01-01', expiryDate: '2026-04-01', applyLiveSpot() {}, setField() {} };
  const hook = load('src/features/pricing/use-pricing-model.ts', {
    react: { useMemo: fn => fn(), useEffect() {} },
    '@/store/marketData': { useMarketData: () => md },
    '@/hooks/use-market-feed': { useMarketFeed: () => ({ surface: null, spot: null }) },
    '@/lib/vol/surface': surface,
    '@/lib/pricing/engine': load('src/lib/pricing/engine.ts', {
      '../math': { gk: gkMath.gk, greeks: () => ({}) }, '../vol/surface': surface,
      '../market/factors': load('src/lib/market/factors.ts'),
    }),
  }).usePricingModel;
  assert.equal(hook().priceable, false);
  assert.match(hook().unpriceableReason, /Manuel/);
  md = { ...md, manualVol: false, manualSpot: false };
  md = { ...md, expiryDate: '2025-12-31' };
  assert.equal(hook().priceable, false);
  md = { ...md, expiryDate: '2026-04-01', contractSize: 0 };
  assert.equal(hook().priceable, false);
  assert.match(hook().unpriceableReason, /kontrat büyüklüğü/);
  md = { ...md, contractSize: 100, vol: NaN };
  assert.equal(hook().priceable, false);
  md = { ...md, vol: 20, manualVol: false };
  assert.equal(hook().priceable, false);
  md = { ...md, manualVol: true, rate: -1e9, lease: -1e9 };
  const overflow = hook();
  assert.equal(overflow.priceable, false);
  assert.match(overflow.unpriceableReason, /Manuel/);
});
