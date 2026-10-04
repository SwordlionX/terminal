/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
const root = path.join(__dirname, '..');

function modules(overrides = {}, env = {}) {
  const cache = new Map();
  function load(file) {
    const full = path.resolve(root, file);
    if (cache.has(full)) return cache.get(full).exports;
    const fixtureModule = { exports: {} };
    cache.set(full, fixtureModule);
    const output = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInNewContext(
      output,
      {
        module: fixtureModule,
        exports: fixtureModule.exports,
        Buffer,
        URL,
        Request,
        Response,
        AbortController,
        AbortSignal,
        ReadableStream,
        TextEncoder,
        TextDecoder,
        setTimeout,
        clearTimeout,
        process: { env },
        console,
        require(id) {
          if (Object.hasOwn(overrides, id)) return overrides[id];
          if (id.startsWith('node:')) return require(id);
          if (id.startsWith('.') || id.startsWith('@/')) {
            let target = id.startsWith('@/')
              ? path.join(root, 'src', id.slice(2))
              : path.resolve(path.dirname(full), id);
            if (!fs.existsSync(target) || fs.statSync(target).isDirectory())
              target += fs.existsSync(target + '.ts') ? '.ts' : '/index.ts';
            return load(target);
          }
          throw new Error(`Unexpected dependency: ${id}`);
        },
      },
      { filename: full },
    );
    return fixtureModule.exports;
  }
  return load;
}

// Offline policy evaluation: real local engine with synthetic terminal fixtures.
// No Google SDK, network or .env file is loaded. These are not linguistic evals.
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'docs/ASSISTANT_EVAL_CASES.json'), 'utf8'));
const load = modules();
const { quoteOption } = load('src/lib/assistant/pricing.ts');
const { validateOption } = load('src/lib/assistant/validation.ts');
const { createToolExecutor } = load('src/lib/assistant/tools.ts');
const screen = dataset.fixture.screen;
const market = dataset.fixture.market;
const option = {
  product: screen.product,
  strike: screen.strike,
  expiryDate: screen.expiryDate,
  tradeDate: screen.tradeDate,
  basis: screen.basis,
  type: 'Put',
  position: 'Short',
  contractSize: 10,
};
function executor(screenPatch = {}, marketPatch = {}) {
  const artifacts = [];
  let researchCalls = 0;
  const execute = createToolExecutor({ ...screen, ...screenPatch }, 'Müşteri put satışını fiyatla', {
    market: async () => ({ ...market, ...marketPatch }),
    artifact: a => artifacts.push(a),
    research: async () => {
      researchCalls++;
      throw new Error('External research forbidden in this fixture');
    },
    signal: new AbortController().signal,
  });
  return { execute, artifacts, researchCalls: () => researchCalls };
}
test('evaluation set contains 24 unique cases with measurable conditions and multi-turn coverage', () => {
  assert.equal(dataset.cases.length, 24);
  assert.equal(new Set(dataset.cases.map(c => c.id)).size, 24);
  assert.ok(dataset.cases.filter(c => c.turns.length > 1).length >= 4);
  assert.ok(dataset.cases.every(c => c.expected && c.pass.length >= 2));
});
test('E01/E02: allowed trade terms use terminal surface and correct customer cashflow', () => {
  const q = quoteOption({ ...option, strike: 110, contractSize: 20 }, screen, market);
  assert.equal(q.inputs.spot, 105);
  assert.equal(q.inputs.strike, 110);
  assert.equal(q.inputs.contractSize, 20);
  assert.equal(q.inputs.manualVol, false);
  assert.notEqual(q.volMode, 'manual');
  assert.equal(q.premiumTotal, q.premiumPerUnit * 20);
  assert.ok(q.cashflow > 0);
  const long = quoteOption({ ...option, position: 'Long' }, screen, market);
  assert.ok(long.cashflow < 0);
});
test('E12/E13/E15: each manual assumption is rejected independently, even manualVol=false', () => {
  for (const override of [
    { spot: 120 },
    { vol: 30 },
    { rate: 1 },
    { lease: 0 },
    { manualVol: true },
    { manualVol: false },
  ]) {
    assert.throws(() => validateOption({ ...option, ...override }));
    assert.throws(() => quoteOption({ ...option, ...override }, screen, market));
  }
});
test('E14: independent chat pricing always uses terminal data despite manual screen modes', async () => {
  for (const patch of [{ manualSpot: true }, { manualVol: true }]) {
    const f = executor(patch);
    const result = await f.execute('price_option', option);
    assert.ok(result.quote);
    assert.equal(result.quote.inputs.manualVol, false);
    assert.equal(result.quote.inputs.spot, market.spot);
  }
});

test('E15: tool injection fails without quote artifact', async () => {
  const f = executor();
  const probe = dataset.cases.find(c => c.id === 'E15').tool_probes[0];
  assert.ok((await f.execute(probe.name, probe.args)).error);
  assert.equal(f.artifacts.length, 0);
});
test('E18/E19: missing spot, surface, or curve metadata blocks quotes and target searches', async () => {
  for (const patch of [
    { spot: null },
    { surface: null },
    { surface: { ...market.surface, builtWithR: undefined } },
    { surface: { ...market.surface, impliedLeaseRate: undefined } },
  ]) {
    const f = executor({}, patch);
    assert.ok((await f.execute('price_option', option)).error);
    assert.ok((await f.execute('find_options', { option, target: 2, unit: 'pct_spot' })).error);
    assert.equal(f.artifacts.length, 0);
    assert.equal(f.researchCalls(), 0);
  }
});
test('E05: unreachable target is not promoted to success', async () => {
  const f = executor();
  const result = await f.execute('find_options', {
    option,
    target: 100000,
    unit: 'total_usd',
    minStrike: 95,
    maxStrike: 110,
  });
  assert.equal(result.reached, false);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.nearest);
  assert.ok(Math.abs(result.nearest.error) > result.tolerance);
});
test('E17: normal pricing request cannot invoke web diagnostic', async () => {
  const f = executor();
  assert.ok((await f.execute('research_diagnostic', { topic: 'european_model' })).error);
  assert.equal(f.researchCalls(), 0);
});
