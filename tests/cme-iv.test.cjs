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

const european = load('src/lib/math/gk.ts');
const solver = load('src/lib/math/solver.ts', { './gk': european });
const american = load('src/lib/math/american.ts', { './gk': european, './solver': solver });
const { buildCmeSurface, filterForwardVolOutliers } = load('src/lib/vol/cme.ts', { '../math/american': american, '../market/factors': load('src/lib/market/factors.ts') });

test('CME surface inverts American futures settlements before producing Black-76 IVs', () => {
  const F = 70, r = 0.05, vol = 0.25, days = 90, T = days / 365;
  const evalSec = Date.UTC(2026, 0, 1) / 1000;
  const expSec = evalSec + days * 86400;
  const options = new Map(), optSettle = new Map();
  const strikes = [58, 62, 66, 68, 70, 72, 74, 78, 82];
  const quotes = new Map();
  for (const K of strikes) {
    const type = K >= F ? 'call' : 'put';
    const id = `live-${K}`;
    const quote = american.americanPrice(F, K, T, r, r, vol, type, 800);
    assert.ok(Number.isFinite(quote) && quote > 0);
    options.set(id, { cls: type === 'call' ? 'C' : 'P', expSec, strike: K, und: 'future-1' });
    optSettle.set(id, quote);
    quotes.set(K, { quote, type });
  }
  options.set('missing-settle', { cls: 'C', expSec, strike: 76, und: 'future-1' });
  options.set('expired', { cls: 'C', expSec: evalSec - 86400, strike: 70, und: 'future-1' });
  optSettle.set('expired', 1);

  const result = buildCmeSurface({
    options, optSettle, futSettle: new Map([['future-1', F]]),
    evalSec, fetchedISO: '2026-01-01T00:00:00.000Z',
  }, 'XAG', r);

  assert.equal(result.spot, F);
  assert.equal(result.builtWithR, r);
  assert.equal(result.expiries.length, 1); // expired contract is ignored
  const smile = result.expiries[0];
  assert.equal(smile.days, days);
  assert.equal(smile.f, F);
  assert.equal(smile.points.length, strikes.length); // missing settlement is ignored
  assert.deepEqual(Array.from(smile.points, p => p.m), strikes.map(K => K / F));

  let largestEarlyExercisePremium = 0;
  let largestBlindEuropeanIvBias = 0;
  let largestAmericanVsEuropeanIvGap = 0;
  for (const point of smile.points) {
    const K = point.m * F;
    const { quote, type } = quotes.get(Math.round(K));
    assert.ok(Number.isFinite(point.iv), `non-finite IV at strike ${K}`);
    assert.ok(Math.abs(point.iv - vol) < 0.003, `IV ${point.iv} at strike ${K}`);
    const repriced = american.americanPrice(F, K, T, r, r, point.iv, type, 72);
    assert.ok(Math.abs(repriced - quote) <= 1e-6, `American quote mismatch at strike ${K}`);

    const europeanAtTrueVol = european.gk(F, K, T, r, r, vol)[type];
    const earlyExercisePremium = quote - europeanAtTrueVol;
    assert.ok(earlyExercisePremium >= -1e-7);
    largestEarlyExercisePremium = Math.max(largestEarlyExercisePremium, earlyExercisePremium);
    const blind = solver.impliedVol(F, K, T, r, r, quote, type);
    if (blind.ok) {
      largestBlindEuropeanIvBias = Math.max(largestBlindEuropeanIvBias, blind.vol - vol);
      largestAmericanVsEuropeanIvGap = Math.max(largestAmericanVsEuropeanIvGap, blind.vol - point.iv);
    }
  }
  assert.ok(largestEarlyExercisePremium > 0.001, 'synthetic quotes must include early exercise value');
  assert.ok(largestBlindEuropeanIvBias > 0.0003,
    `European inversion would overstate IV; observed bias ${largestBlindEuropeanIvBias}`);
  assert.ok(largestAmericanVsEuropeanIvGap > 0.0003,
    `CME IV must differ from blind European inversion; observed gap ${largestAmericanVsEuropeanIvGap}`);
});

test('term-structure jumps from illiquid settlement marks are dropped, ordinary slices are kept', () => {
  const slice = (date, days, atm) => ({ date, days, points: [{ m: 0.9, iv: atm + 0.02 }, { m: 1, iv: atm }, { m: 1.1, iv: atm + 0.01 }] });
  // Shape of the 1 October 2026 silver surface: 329d at 37.6%, then 42.7% at 361d (≈78% forward vol).
  const { kept, dropped } = filterForwardVolOutliers([slice('2027-07-27', 299, 0.372), slice('2027-08-26', 329, 0.376),
    slice('2027-09-27', 361, 0.427), slice('2027-10-26', 390, 0.428)]);
  assert.equal(JSON.stringify(kept.map(e => e.date)), JSON.stringify(['2027-07-27', '2027-08-26']));
  assert.equal(JSON.stringify(dropped), JSON.stringify(['2027-09-27', '2027-10-26']));
  const ordinary = filterForwardVolOutliers([slice('a', 26, 0.198), slice('b', 54, 0.2145), slice('c', 88, 0.2125)]);
  assert.equal(ordinary.dropped.length, 0);
});
