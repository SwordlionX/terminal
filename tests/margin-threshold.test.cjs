/* eslint-disable @typescript-eslint/no-require-imports -- Isolated offline fixtures. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '..');
function modules(overrides = {}, env = {}) {
  const cache = new Map();
  function load(file) {
    const full = path.resolve(root, file);
    if (cache.has(full)) return cache.get(full).exports;
    const mod = { exports: {} };
    cache.set(full, mod);
    const output = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    vm.runInNewContext(
      output,
      {
        module: mod,
        exports: mod.exports,
        Buffer,
        URL,
        AbortController,
        Error,
        setTimeout,
        clearTimeout,
        console,
        process: { env },
        require(id) {
          if (Object.hasOwn(overrides, id)) return overrides[id];
          if (id.startsWith('node:')) return require(id);
          if (id.startsWith('.') || id.startsWith('@/')) {
            let target = id.startsWith('@/')
              ? path.join(root, 'src', id.slice(2))
              : path.resolve(path.dirname(full), id);
            if (!fs.existsSync(target) || fs.statSync(target).isDirectory())
              target += fs.existsSync(target + '.ts') ? '.ts' : fs.existsSync(target + '.tsx') ? '.tsx' : '/index.ts';
            return load(target);
          }
          if (id.startsWith('react')) return require(id);
          throw new Error(`Unmocked dependency: ${id}`);
        },
      },
      { filename: full },
    );
    return mod.exports;
  }
  return load;
}
const load = modules();
const { marginThreshold } = load('src/lib/margin/threshold.ts');
const { requestsMarginAnalysis, marginScenarioInputs } = load('src/lib/assistant/margin-intent.ts');
const { marginAnswer } = load('src/lib/assistant/margin-answer.ts');
const clone = x => JSON.parse(JSON.stringify(x));
const near = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const sample = {
  observedAt: '2026-10-23T10:00:00Z',
  valuationDate: '2026-10-23',
  warnings: [],
  spots: [
    {
      product: 'XAG',
      price: 54.118,
      quoteAt: Date.parse('2026-10-23T09:59:00Z'),
      source: 'offline fixture',
      stale: false,
    },
  ],
  positions: [
    {
      id: 'fixture-1',
      product: 'XAG',
      type: 'Put',
      position: 'Short',
      strike: 78,
      quantity: 1256.41,
      premium: 10000,
      expiryDate: '2026-11-30',
      barrier: false,
      currentSpot: 54.118,
    },
    {
      id: 'fixture-2',
      product: 'XAG',
      type: 'Put',
      position: 'Short',
      strike: 81,
      quantity: 2037.04,
      premium: 18150,
      expiryDate: '2026-11-18',
      barrier: false,
      currentSpot: 54.118,
    },
  ],
  collaterals: [{ currency: 'USD', quantity: 200730, valueUsd: 200730, haircut: 0 }],
};

test('reported two-put example: one spot, gross loss, exact denominator, no writes', () => {
  const before = JSON.stringify(sample);
  const r = marginThreshold(sample, { targetRatioPct: 55 });
  near(r.currentLossUsd, 84765.2929);
  near(r.currentRatioPct, 42.228512379813665);
  near(r.levels[0].spot, 46.33400233797385);
  near(r.levels[0].lossUsd, 110401.5);
  assert.equal(r.validBefore, '2026-11-18');
  assert.equal(r.status, 'solved');
  const other = marginThreshold(sample, { targetRatioPct: 55, collateralOverrideUsd: 200000 });
  near(other.levels[0].spot, 46.45591097481364);
  near(other.currentRatioPct, 42.38264645);
  assert.equal(other.recordedCollateralUsd, 200730);
  assert.equal(other.usedCollateralUsd, 200000);
  assert.equal(JSON.stringify(sample), before);
  assert.match(marginAnswer(other), /46,4559/);
  assert.match(marginAnswer(other), /200\.730,00/);
});

test('piecewise solver handles calls, both wings, zero boundary and unreachable put loss', () => {
  const s = clone(sample);
  s.positions = [{ ...s.positions[0], quantity: 1, strike: 100 }];
  s.collaterals = [{ currency: 'USD', quantity: 100, valueUsd: 100, haircut: 0 }];
  near(marginThreshold(s, { targetRatioPct: 100 }).levels[0].spot, 0);
  assert.equal(marginThreshold(s, { targetRatioPct: 101 }).status, 'unreachable');
  s.positions[0].type = 'Call';
  near(marginThreshold(s, { targetRatioPct: 55 }).levels[0].spot, 155);
  s.positions.push({ ...s.positions[0], id: 'put', type: 'Put' });
  const both = marginThreshold(s, { targetRatioPct: 55 });
  assert.equal(both.levels.length, 2);
  near(both.levels[0].spot, 45);
  near(both.levels[1].spot, 155);
});

test('metal collateral moves with scenario spot; override replaces the whole denominator including long premium', () => {
  const s = clone(sample);
  s.positions = [{ ...s.positions[0], quantity: 10, strike: 100 }];
  s.collaterals = [{ currency: 'XAG', quantity: 10, valueUsd: 541.18, haircut: 0.1 }];
  const r = marginThreshold(s, { targetRatioPct: 50 });
  near(r.levels[0].spot, 1000 / 14.5);
  near(r.levels[0].collateralUsd, r.levels[0].spot * 9);
  s.positions.push({ ...s.positions[0], id: 'long', position: 'Long', premium: 100 });
  const o = marginThreshold(s, { targetRatioPct: 50, collateralOverrideUsd: 200 });
  assert.equal(o.usedCollateralUsd, 200);
  near(o.recordedCollateralUsd, 587.062);
  near(o.levels[0].spot, 90);
});

test('zero collateral is not 100%; flat ratios and multi-product ambiguity are explicit', () => {
  const s = clone(sample);
  s.collaterals = [];
  const r = marginThreshold(s, { targetRatioPct: 55 });
  assert.equal(r.currentRatioPct, null);
  assert.equal(r.status, 'unreachable');
  s.spots.push({ ...s.spots[0], product: 'XAU', price: 50 });
  s.positions.push({ ...s.positions[0], id: 'gold', product: 'XAU', currentSpot: 50 });
  assert.throws(() => marginThreshold(s, { targetRatioPct: 55 }), /Hangi metal/);
  assert.equal(
    marginThreshold(s, { product: 'XAG', targetRatioPct: 55, collateralOverrideUsd: 200000 }).product,
    'XAG',
  );
  const flat = clone(sample);
  flat.positions = [
    { ...flat.positions[0], quantity: 1, strike: 100 },
    { ...flat.positions[1], quantity: 1, strike: 50, type: 'Call' },
  ];
  flat.collaterals = [{ currency: 'USD', quantity: 100, valueUsd: 100, haircut: 0 }];
  assert.equal(marginThreshold(flat, { targetRatioPct: 50 }).status, 'non_unique');
});

test('barriers, expired trades, inconsistent quotes and invalid data fail closed; stale provenance stays visible', () => {
  for (const mutate of [
    s => (s.positions[0].barrier = true),
    s => (s.positions[0].expiryDate = s.valuationDate),
    s => (s.spots = []),
    s => s.positions[0].currentSpot++,
    s => (s.positions[0].quantity = NaN),
    s => (s.collaterals[0].haircut = 2),
    s => s.positions.push(s.positions[0]),
  ]) {
    const s = clone(sample);
    mutate(s);
    assert.throws(() => marginThreshold(s, { targetRatioPct: 55 }));
  }
  for (const opts of [
    { targetRatioPct: -1 },
    { targetRatioPct: NaN },
    { collateralOverrideUsd: 0 },
    { collateralOverrideUsd: Infinity },
  ])
    assert.throws(() => marginThreshold(sample, opts));
  const stale = clone(sample);
  stale.warnings = ['Eski spot'];
  stale.spots[0].stale = true;
  assert.match(marginAnswer(marginThreshold(stale, {})), /Eski spot/);
  assert.equal(marginThreshold(sample, {}).targetRatioPct, null);
});

test('every returned root satisfies independently recomputed portfolio loss over collateral', () => {
  for (let i = 1; i <= 100; i++) {
    const s = clone(sample);
    s.positions[0].strike = 20 + i;
    s.positions[0].quantity = i * 3;
    s.positions[1].strike = 40 + i;
    s.positions[1].quantity = 101 - i;
    s.positions[1].type = i % 2 ? 'Call' : 'Put';
    s.collaterals = [
      { currency: 'USD', quantity: 500, valueUsd: 500, haircut: 0 },
      { currency: 'XAG', quantity: 2, valueUsd: 2 * 54.118, haircut: 0.2 },
    ];
    const r = marginThreshold(s, { targetRatioPct: 55 });
    for (const level of r.levels) {
      const loss = s.positions.reduce(
        (v, p) => v + Math.max(0, p.type === 'Put' ? p.strike - level.spot : level.spot - p.strike) * p.quantity,
        0,
      );
      near(loss / (500 + 1.6 * level.spot), 0.55);
    }
  }
});

test('user collateral and target survive the follow-up; omitted override cannot silently use records', () => {
  const first =
    'kanka bu iki işlemin zararlarını beraber düşün toplam teminatı bizde 200 bin dolar teminatı var ne zaman zarar teminat oranı yüzde 55 e gelir sence ve şuan o oran kaç';
  const follow = 'bu zarar tutarına kaç gümüş ons seviyesinde gelir';
  assert.equal(requestsMarginAnalysis(first), true);
  assert.equal(requestsMarginAnalysis(follow, [first]), true);
  const r = marginScenarioInputs(first, [], {});
  assert.equal(r.collateralOverrideUsd, 200000);
  assert.equal(r.targetRatioPct, 55);
  const next = marginScenarioInputs(follow, [first], {});
  assert.equal(next.collateralOverrideUsd, 200000);
  assert.equal(next.targetRatioPct, 55);
  assert.throws(() => marginScenarioInputs(first, [], { collateralOverrideUsd: 200730 }));
  assert.throws(() => marginScenarioInputs(first, [], { targetRatioPct: 80 }));
  assert.equal(
    marginScenarioInputs('kayıtlı teminat ile mevcut oran kaç', [first], {}).collateralOverrideUsd,
    undefined,
  );
  assert.equal(requestsMarginAnalysis('yeni put fiyatla', [first]), false);
  assert.equal(requestsMarginAnalysis('Sevil teminatına 200 dolar ekle'), false);
});

test('service shares the same quote across trades and metal collateral; next request reads again', async () => {
  let reads = 0;
  const trades = sample.positions.map(p => ({
    id: p.id,
    customerId: 'fixture',
    underlying: 'XAG/USD',
    type: p.type,
    position: p.position,
    strike: p.strike,
    contractSize: p.quantity,
    premium: p.premium,
    expiryDate: '2099-11-30',
    spot: 99,
    status: 'Open',
  }));
  const service = modules({
    '@/services/mockDb': { db: { trades: { findByCustomerId: async () => trades } } },
    '@/repositories/collateral.repository': {
      collateralRepository: {
        findByCustomerId: async () => [
          { id: 'collateral', assetCode: 'Nakit-XAG', currency: 'XAG', nominalQuantity: 100, marketValueUsd: 9999 },
        ],
      },
    },
    '@/services/market.service': {
      getUsdTryRate: async () => 50,
      getSpot: async () => ({
        price: 50 + ++reads,
        source: 'fixture',
        at: Date.now(),
        quoteAt: Date.now(),
      }),
    },
  })('src/services/margin.service.ts').marginService;
  const value = await service.evaluateCustomerSnapshot('fixture');
  assert.equal(reads, 1);
  assert.equal(value.snapshot.spots[0].price, 51);
  assert.ok(value.snapshot.positions.every(p => p.currentSpot === 51));
  assert.equal(value.collaterals[0].marketValueUsd, 5100);
  near(marginThreshold(value.snapshot, {}).currentLossUsd, value.margin.totalMtmLoss);
  near(marginThreshold(value.snapshot, {}).usedCollateralUsd, value.margin.totalCollateralValue);
  await service.evaluateCustomerSnapshot('fixture');
  assert.equal(reads, 2);
});

const context = {
  product: 'XAG',
  spot: 99,
  strike: 100,
  rate: 5,
  lease: 1,
  vol: 20,
  manualSpot: false,
  manualVol: false,
  contractSize: 1,
  basis: 365,
  tradeDate: '2026-10-23',
  expiryDate: '2026-11-30',
};
function workspace() {
  return {
    area: 'customers',
    observedAt: sample.observedAt,
    customer: { id: 'fixture', name: 'Örnek müşteri' },
    trades: [],
    totalTrades: 2,
    truncated: false,
    marginSnapshot: clone(sample),
  };
}
test('assistant tool never prices options for margin, uses full snapshot and makes no writes', async () => {
  const artifacts = [];
  let quotes = 0,
    writes = 0;
  const execute = load('src/lib/assistant/tools.ts').createToolExecutor(
    context,
    'Örnek müşterinin teminat zarar oranı yüzde 55 ne zaman olur, teminat 200 bin dolar',
    {
      customerFile: async () => ({ snapshot: workspace(), matches: [], truncated: false }),
      market: async () => {
        quotes++;
        throw new Error('must not price');
      },
      addCollateral: async () => {
        writes++;
      },
      artifact: a => artifacts.push(a),
      research: async () => {
        throw new Error('no research');
      },
      signal: new AbortController().signal,
    },
  );
  const blocked = await execute('price_option', {});
  assert.equal(blocked.clarificationRequired, true);
  const r = await execute('analyze_margin_threshold', { query: 'Örnek müşteri', targetRatioPct: 55 });
  assert.equal(r.usedCollateralUsd, 200000);
  near(r.levels[0].spot, 46.45591097481364);
  assert.equal(r.tradeIds.length, 2);
  assert.equal(quotes, 0);
  assert.equal(writes, 0);
  assert.ok(artifacts.some(a => a.kind === 'margin_threshold'));
  assert.ok(!artifacts.some(a => a.kind === 'quote'));
});

test('runner returns deterministic result after one model tool call, no provider arithmetic', async () => {
  const events = [],
    requests = [];
  class GoogleGenAI {
    models = {
      generateContent: async params => {
        requests.push(params);
        assert.equal(requests.length, 1);
        const call = { name: 'analyze_margin_threshold', args: { query: 'Örnek müşteri', targetRatioPct: 55 } };
        return {
          candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: call }] } }],
          functionCalls: [call],
        };
      },
    };
  }
  const runner = modules(
    {
      '@google/genai': { GoogleGenAI, FunctionCallingConfigMode: { ANY: 'ANY', NONE: 'NONE', VALIDATED: 'VALIDATED' } },
      './market': {
        terminalMarket: async () => {
          throw new Error('no IV needed');
        },
      },
      './limits': { readModelBlocks: async () => ({}), reserveModelCall: async () => {}, blockModel: async () => {} },
      './customer-file': { readCustomerFile: async () => ({ snapshot: workspace(), matches: [], truncated: false }) },
    },
    { GEMINI_API_KEY: 'offline-test' },
  )('src/lib/assistant/runner.ts');
  const result = await runner.runAssistant({
    message: 'Örnek müşteri teminat 200 bin dolar zarar oranı yüzde 55 ne zaman olur',
    context,
    contents: [],
    signal: new AbortController().signal,
    emit: e => events.push(e),
  });
  assert.equal(result.modelCalls, 1);
  assert.equal(requests[0].config.toolConfig.functionCallingConfig.mode, 'ANY');
  assert.match(events.find(e => e.type === 'text').text, /46,4559/);
});

test('parallel named customer thresholds cannot mix customer snapshots', async () => {
  const execute = load('src/lib/assistant/tools.ts').createToolExecutor(
    context,
    'Alpha ve Beta teminat zarar oranı yüzde 55',
    {
      customerFile: async query => {
        const w = workspace();
        w.customer = { id: query, name: query };
        if (query === 'Beta')
          w.marginSnapshot.collaterals[0] = { currency: 'USD', quantity: 100000, valueUsd: 100000, haircut: 0 };
        return { snapshot: w, matches: [], truncated: false };
      },
      market: async () => {
        throw new Error('no prices');
      },
      artifact: () => {},
      research: async () => {},
      signal: new AbortController().signal,
    },
  );
  const [a, b] = await Promise.all(
    ['Alpha', 'Beta'].map(query => execute('analyze_margin_threshold', { query, targetRatioPct: 55 })),
  );
  assert.equal(a.customer.id, 'Alpha');
  assert.equal(a.usedCollateralUsd, 200730);
  assert.equal(b.customer.id, 'Beta');
  assert.equal(b.usedCollateralUsd, 100000);
});

test('recorded-collateral reset persists through a follow-up and new customer does not inherit old override', async () => {
  const old = 'teminat 200 bin dolar yüzde 55 zarar oranı';
  const reset = 'kayıtlı teminatla oranı hesapla';
  assert.equal(marginScenarioInputs('kaç ons seviyesinde', [old, reset], {}).collateralOverrideUsd, undefined);
  const execute = load('src/lib/assistant/tools.ts').createToolExecutor(
    context,
    'Örnek müşteri teminat zarar oranı yüzde 55',
    {
      priorUserMessages: [old],
      customerFile: async () => ({ snapshot: workspace(), matches: [], truncated: false }),
      market: async () => {},
      artifact: () => {},
      research: async () => {},
      signal: new AbortController().signal,
    },
  );
  assert.equal((await execute('analyze_margin_threshold', { query: 'Örnek müşteri' })).usedCollateralUsd, 200730);
});

test('UI renders shared numbers, provenance, labelled controls and explicit unsupported cases', () => {
  const React = require('react'),
    { renderToStaticMarkup } = require('react-dom/server');
  const ui = modules({
    '@/components/ui/number-input': {
      NumberInput: props =>
        React.createElement('input', { 'aria-label': props['aria-label'], value: props.value, readOnly: true }),
    },
  })('src/features/margin/margin-threshold-calculator.tsx');
  const html = renderToStaticMarkup(React.createElement(ui.MarginThresholdCalculator, { snapshot: sample }));
  assert.match(html, /46,3340/);
  assert.match(html, /84\.765,29/);
  assert.match(html, /42,23/);
  assert.match(html, /Hedef zarar teminat yüzdesi/);
  assert.match(html, /Senaryo metali/);
  assert.match(html, /18\.11\.2026/);
  assert.match(html, /offline fixture/);
  const bad = clone(sample);
  bad.positions[0].barrier = true;
  assert.match(
    renderToStaticMarkup(React.createElement(ui.MarginThresholdCalculator, { snapshot: bad })),
    /Bariyerli işlemlerde/,
  );
});

test('runner drops unverified free-text arithmetic instead of showing or storing it', async () => {
  const events = [];
  class GoogleGenAI {
    models = {
      generateContent: async () => ({
        text: 'UNVERIFIED 999 USD',
        candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'UNVERIFIED 999 USD' }] } }],
      }),
    };
  }
  const runner = modules(
    {
      '@google/genai': { GoogleGenAI, FunctionCallingConfigMode: { ANY: 'ANY', NONE: 'NONE', VALIDATED: 'VALIDATED' } },
      './market': { terminalMarket: async () => {} },
      './limits': { readModelBlocks: async () => ({}), reserveModelCall: async () => {}, blockModel: async () => {} },
    },
    { GEMINI_API_KEY: 'offline-test' },
  )('src/lib/assistant/runner.ts');
  const r = await runner.runAssistant({
    message: 'teminat zarar oranı yüzde 55 ne zaman olur',
    context,
    contents: [],
    signal: new AbortController().signal,
    emit: e => events.push(e),
  });
  assert.ok(!JSON.stringify([r.contents, events]).includes('UNVERIFIED'));
  assert.match(events.find(e => e.type === 'text').text, /tamamlanamadı/);
});

test('additional cash keeps loss fixed, rounds up to cents, and distinguishes total from extra', () => {
  const s = clone(sample);
  const spot = (78 * 1256.41 + 81 * 2037.04 - 95272.96) / 3293.45;
  s.spots[0].price = spot;
  s.positions.forEach(p => (p.currentSpot = spot));
  const r = marginThreshold(s, { calculation: 'additional_collateral', targetRatioPct: 35 });
  near(r.currentLossUsd, 95272.96);
  near(r.requiredTotalCollateralUsd, 272208.45714285714);
  assert.equal(r.additionalCollateralUsd, 71478.46);
  assert.ok(r.ratioAfterDepositPct <= 35);
  assert.equal(r.levels.length, 0);
  assert.equal(r.status, 'collateral_calculated');
  const answer = marginAnswer(r);
  assert.match(answer, /71\.478,46.*ek USD nakit/);
  assert.match(answer, /272\.208,46/);
  assert.ok(!answer.includes('için spot:'));
  const enough = marginThreshold(s, { calculation: 'additional_collateral', targetRatioPct: 60 });
  assert.equal(enough.additionalCollateralUsd, 0);
  assert.match(marginAnswer(enough), /ek teminat gerekmiyor/);
  const empty = clone(s);
  empty.collaterals = [];
  const uncollateralized = marginThreshold(empty, { calculation: 'additional_collateral', targetRatioPct: 35 });
  assert.equal(uncollateralized.currentRatioPct, null);
  assert.equal(uncollateralized.additionalCollateralUsd, 272208.46);
});

test('both reported phrasings select cash and recognize a bare 35 without inventing amounts', () => {
  for (const message of [
    'sevilin işlemlerinde risk oranının 35 e düşmesi için ek ne kadar teminat almamız gerkiyor',
    'sevil parfümeri aktif zarar teminat oranını yüzde 35 e çekebilmek için ek ne kadar teminat istememiz gerkiyor',
    'sevilin zarar teminat oranını 35’e indirmek için ne kadar ek teminat gerekir',
    'sevilin risk oranı 35% olsun ne kadar teminat istemeliyiz',
  ]) {
    assert.equal(requestsMarginAnalysis(message), true);
    const r = marginScenarioInputs(message, [], { targetRatioPct: 35, calculation: 'spot_threshold' });
    assert.equal(r.targetRatioPct, 35);
    assert.equal(r.calculation, 'additional_collateral');
    assert.equal(r.collateralOverrideUsd, undefined);
    assert.equal(r.targetIsProcedureDefault, false);
    assert.throws(() => marginScenarioInputs(message, [], { targetRatioPct: 55 }));
  }
  assert.throws(() => marginScenarioInputs('sevilin 35 işlemi var teminat durumu nasıl', [], { targetRatioPct: 35 }));
  const d = marginScenarioInputs('sevilin zarar oranını düşürmek için ek ne kadar teminat gerekir', [], {});
  assert.equal(requestsMarginAnalysis('sevilin ne kadar ek teminat vermesi gerekiyor'), true);
  assert.equal(d.targetRatioPct, 35);
  assert.equal(d.targetIsProcedureDefault, true);
  assert.equal(
    marginScenarioInputs('sevilin zarar oranı yüzde 35 için hangi spotta olur', [], {}).calculation,
    'spot_threshold',
  );
});

test('cash intent wins over model spot arguments and cannot authorize adding collateral', async () => {
  let writes = 0;
  const artifacts = [];
  const message = 'sevilin işlemlerinde risk oranının 35 e düşmesi için ek ne kadar teminat almamız gerkiyor';
  const execute = load('src/lib/assistant/tools.ts').createToolExecutor(context, message, {
    customerFile: async () => ({ snapshot: workspace(), matches: [], truncated: false }),
    market: async () => {
      throw new Error('no IV');
    },
    artifact: a => artifacts.push(a),
    addCollateral: async () => {
      writes++;
    },
    research: async () => {},
    signal: new AbortController().signal,
  });
  const r = await execute('analyze_margin_threshold', {
    query: 'sevil',
    targetRatioPct: 35,
    calculation: 'spot_threshold',
  });
  assert.equal(r.calculation, 'additional_collateral');
  assert.ok(r.additionalCollateralUsd > 0);
  assert.equal(r.levels.length, 0);
  const blocked = await execute('add_collateral', { customer: 'sevil', asset: 'USD', amount: 35 });
  assert.equal(blocked.clarificationRequired, true);
  assert.equal(writes, 0);
  assert.equal(artifacts[0].result.calculation, 'additional_collateral');
});

test('additional collateral supports a combined gold and silver portfolio without choosing a price to shock', () => {
  const s = clone(sample);
  s.spots.push({ ...s.spots[0], product: 'XAU', price: 50 });
  s.positions.push({ ...s.positions[0], id: 'gold', product: 'XAU', currentSpot: 50 });
  const r = marginThreshold(s, { calculation: 'additional_collateral', targetRatioPct: 35 });
  near(r.currentLossUsd, 84765.2929 + 28 * 1256.41);
  assert.equal(r.tradeIds.length, 3);
  assert.ok(r.additionalCollateralUsd > 0);
  assert.equal(r.levels.length, 0);
});

test('cash answer card shows the deposit amount without a target price and retains the input selector', () => {
  const React = require('react'),
    { renderToStaticMarkup } = require('react-dom/server');
  const ui = modules({ '@/components/ui/number-input': { NumberInput: () => null } })(
    'src/features/margin/margin-threshold-calculator.tsx',
  );
  const r = marginThreshold(sample, { calculation: 'additional_collateral', targetRatioPct: 35 });
  const html = renderToStaticMarkup(React.createElement(ui.MarginThresholdView, { result: r }));
  assert.match(html, /Müşteriden istenecek ek USD nakit teminat/);
  assert.ok(!html.includes('Spot değişimi'));
  const editor = renderToStaticMarkup(React.createElement(ui.MarginThresholdCalculator, { snapshot: sample }));
  assert.match(editor, /Teminat hesap türü/);
  assert.match(editor, /Hedef oran için ek teminat/);
});

test('reported cash question reaches a deterministic deposit answer after reading the customer file', async () => {
  const events = [],
    requests = [];
  class GoogleGenAI {
    models = {
      generateContent: async params => {
        requests.push(params);
        assert.ok(requests.length <= 2);
        const call =
          requests.length === 1
            ? { name: 'get_customer_file', args: { query: 'sevil' } }
            : {
                name: 'analyze_margin_threshold',
                args: { query: 'sevil', targetRatioPct: 35, calculation: 'spot_threshold' },
              };
        return {
          candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ functionCall: call }] } }],
          functionCalls: [call],
        };
      },
    };
  }
  const runner = modules(
    {
      '@google/genai': { GoogleGenAI, FunctionCallingConfigMode: { ANY: 'ANY', NONE: 'NONE', VALIDATED: 'VALIDATED' } },
      './market': {
        terminalMarket: async () => {
          throw new Error('no pricing');
        },
      },
      './limits': { readModelBlocks: async () => ({}), reserveModelCall: async () => {}, blockModel: async () => {} },
      './customer-file': { readCustomerFile: async () => ({ snapshot: workspace(), matches: [], truncated: false }) },
    },
    { GEMINI_API_KEY: 'offline-test' },
  )('src/lib/assistant/runner.ts');
  const r = await runner.runAssistant({
    message: 'sevilin işlemlerinde risk oranının 35 e düşmesi için ek ne kadar teminat almamız gerkiyor',
    context,
    contents: [],
    signal: new AbortController().signal,
    emit: e => events.push(e),
  });
  assert.equal(r.modelCalls, 2);
  assert.ok(requests.every(q => q.config.toolConfig.functionCallingConfig.mode === 'ANY'));
  const text = events.find(e => e.type === 'text').text;
  assert.match(text, /ek USD nakit teminat/);
  assert.ok(!text.includes('için spot:'));
  assert.equal(
    events.find(e => e.type === 'artifact' && e.artifact.kind === 'margin_threshold').artifact.result.calculation,
    'additional_collateral',
  );
});
