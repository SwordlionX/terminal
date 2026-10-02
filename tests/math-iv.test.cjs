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
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test('European zero volatility uses the discounted forward payoff; expiry uses spot payoff', () => {
  const p = european.gk(100, 90, 1, 0.05, 0.02, 0);
  near(p.call, Math.max(100 * Math.exp(-0.02) - 90 * Math.exp(-0.05), 0));
  near(p.put, 0);
  near(p.call - p.put, 100 * p.dfQ - 90 * p.dfR);
  near(european.gk(100, 90, 0, 0.05, 0.02, 0).call, 10);
});

test('American put agrees with a standard benchmark and respects exercise and European bounds', () => {
  const put = american.americanPrice(100, 100, 1, 0.05, 0, 0.2, 'put');
  near(put, 6.0896, 0.04);
  assert.ok(put >= european.gk(100, 100, 1, 0.05, 0, 0.2).put);
  const deep = american.americanPrice(70, 100, 1, 0.05, 0, 0.2, 'put');
  assert.ok(deep >= 30);
});

test('Non-dividend American call matches European, including low volatility', () => {
  for (const vol of [0.0001, 0.1, 0.4]) {
    const a = american.americanPrice(100, 110, 1, 0.05, 0, vol, 'call');
    const e = european.gk(100, 110, 1, 0.05, 0, vol).call;
    near(a, e, 0.001);
  }
});

test('Low-volatility high-carry tree remains American and monotone', () => {
  const params = [100, 100, 1, 0.01, 0.4];
  const prices = [0, 0.0001, 0.01, 0.2].map(v => american.americanPrice(...params, v, 'put'));
  for (const price of prices) assert.ok(Number.isFinite(price));
  for (let i = 1; i < prices.length; i++) assert.ok(prices[i] + 1e-6 >= prices[i - 1]);
  assert.ok(prices[1] >= european.gk(...params, 0.0001).put);
  const earlyCall = american.americanPrice(120, 100, 1, 0.01, 0.4, 0.0001, 'call');
  near(earlyCall, 20, 1e-5);
  assert.ok(earlyCall > european.gk(120, 100, 1, 0.01, 0.4, 0.0001).call + 10);
});

test('Zero-volatility American value includes deterministic early exercise', () => {
  const S = 100, K = 90, T = 20, r = 0.1, q = 0.05;
  const time = Math.log(r * K / (q * S)) / (r - q);
  const expected = Math.max(0, S * Math.exp(-q * time) - K * Math.exp(-r * time));
  near(american.americanPrice(S, K, T, r, q, 0, 'call'), expected);
  const put = american.americanPrice(100, 100, 1, -0.05, 0, 0, 'put');
  near(put, 100 * Math.exp(0.05) - 100);
});

test('Both solvers round-trip model prices and report repricing residuals', () => {
  const cases = [
    [100, 95, 0.4, 0.05, 0.01, 0.25, 'call'],
    [100, 105, 1.5, -0.02, 0.03, 0.35, 'put'],
  ];
  for (const [S, K, T, r, q, vol, type] of cases) {
    const price = european.gk(S, K, T, r, q, vol)[type];
    const result = solver.impliedVol(S, K, T, r, q, price, type);
    assert.equal(result.ok, true, `${type} ${vol}: ${JSON.stringify(result)}`);
    near(result.vol, vol, 1e-6);
    near(european.gk(S, K, T, r, q, result.vol)[type], price, 1e-8);
  }
  for (const [S, K, T, r, q, vol, type] of [
    [100, 100, 1, 0.05, 0, 0.25, 'put'],
    [100, 100, 1, -0.03, 0, 0.3, 'call'],
    [100, 100, 1, 0.01, 0.3, 0.4, 'put'],
  ]) {
    const price = american.americanPrice(S, K, T, r, q, vol, type);
    const result = american.impliedVolAmerican(S, K, T, r, q, price, type);
    assert.equal(result.ok, true, `${type} ${vol}: ${JSON.stringify(result)} price=${price}`);
    near(american.americanPrice(S, K, T, r, q, result.vol, type), price, 1e-6);
  }
});

test('Negative-rate calls take the American IV route', () => {
  const S = 100, K = 70, T = 1, r = -0.05, q = 0, vol = 0.3;
  const price = american.americanPrice(S, K, T, r, q, vol, 'call');
  assert.ok(price > european.gk(S, K, T, r, q, vol).call);
  near(american.deAmericanizedIV(S, K, T, r, q, price, 'call'), vol, 1e-4);
});

test('Invalid inputs and impossible prices never report a successful IV', () => {
  for (const bad of [NaN, Infinity]) {
    assert.equal(solver.impliedVol(100, 100, 1, 0.05, 0, bad, 'call').ok, false);
    assert.equal(american.impliedVolAmerican(100, 100, 1, 0.05, 0, bad, 'call').ok, false);
  }
  assert.equal(solver.impliedVol(100, 100, 1, 0.05, 0, 101, 'call').ok, false);
  assert.equal(american.impliedVolAmerican(100, 100, 1, 0.05, 0, 101, 'put').ok, false);
  const flatPrice = american.americanPrice(100, 100, 1, 0.01, 0.3, 0.04, 'put');
  assert.equal(american.impliedVolAmerican(100, 100, 1, 0.01, 0.3, flatPrice, 'put').ok, false);
  assert.equal(solver.impliedVol(0, 100, 1, 0.05, 0, 5, 'call').ok, false);
  assert.equal(american.impliedVolAmerican(100, 100, 1, 0.05, 0, 5, 'put', 0).ok, false);
  assert.ok(Number.isNaN(american.americanPrice(100, 100, 1, 0.05, 0, NaN, 'put')));
});
