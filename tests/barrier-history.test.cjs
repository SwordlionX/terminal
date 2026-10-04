/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');

function load(file, imports = {}, globals = {}) {
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
    URL,
    Date,
    AbortSignal,
    ...globals,
    require(id) {
      if (Object.hasOwn(imports, id)) return imports[id];
      throw new Error(`Unmocked dependency: ${id}`);
    },
  });
  return loadedModule.exports;
}

const scanner = load('src/lib/barrier-history.ts');
const baseRows = [
  { date: '2026-01-01T00:00:00Z', ticker: 'xauusd', high: 105, low: 95 },
  { date: '2026-01-02T00:00:00Z', ticker: 'xauusd', high: 111, low: 90 },
  { date: '2026-01-03T00:00:00Z', ticker: 'xauusd', high: 101, low: 89 },
];
const scan = (rows, barrierType, level, start = '2026-01-01', end = '2026-01-03') =>
  scanner.scanBarrierHistory(rows, 'xauusd', barrierType, level, start, end, '2026-02-01T00:00:00.000Z');

test('daily highs/lows use inclusive thresholds for all up/down knock in/out barriers', () => {
  for (const barrierType of ['Knock Out Up', 'Knock In Up']) {
    const report = scan([{ date: '2026-01-02', high: 110, low: 100 }], barrierType, 110);
    assert.equal(report.status, 'touch_observed');
    assert.equal(report.touchDate, '2026-01-02');
    assert.equal(report.observedExtreme, 110);
  }
  for (const barrierType of ['Knock Out Down', 'Knock In Down']) {
    const report = scan([{ date: '2026-01-02', high: 110, low: 90 }], barrierType, 90);
    assert.equal(report.status, 'touch_observed');
    assert.equal(report.touchDate, '2026-01-02');
    assert.equal(report.observedExtreme, 90);
  }
});

test('scanner ignores wrong ticker, malformed bars, and bars outside inclusive date range', () => {
  const rows = [
    { date: '2025-12-31', ticker: 'xauusd', high: 200, low: 1 },
    { date: '2026-01-01', ticker: 'xagusd', high: 200, low: 1 },
    { date: '2026-01-02', ticker: 'xauusd', high: 100, low: 90 },
    { date: '2026-01-03', ticker: 'xauusd', high: 200, low: 1 },
    { date: '2026-01-02', ticker: 'xauusd', high: Infinity, low: 1 },
    { date: 'not-a-date', ticker: 'xauusd', high: 200, low: 1 },
  ];
  const report = scan(rows, 'Knock Out Up', 150, '2026-01-01', '2026-01-02');
  assert.equal(report.status, 'no_touch_observed');
  assert.equal(report.bars, 1);
  assert.equal(report.firstDate, '2026-01-02');
  assert.match(report.note, /3 geçersiz bar atlandı/);
});

test('empty or wholly invalid history is unavailable; no-touch is explicitly not confirmation', () => {
  assert.equal(scan([], 'Knock Out Up', 110).status, 'unavailable');
  assert.equal(scan(null, 'Knock Out Up', 110).status, 'unavailable');
  assert.equal(scan([{ date: 'bad', high: 1, low: 1 }], 'Knock Out Up', 110).status, 'unavailable');
  const result = scan(baseRows.slice(0, 1), 'Knock Out Up', 106);
  assert.equal(result.status, 'no_touch_observed');
  assert.match(result.note, /kesin 'değmedi' onayı değildir/);
  assert.match(result.note, /İşlem durumu, teminat ve K\/Z değiştirilmedi/);
});

test('Tiingo service bounds observations by trade dates, current date, and expiry', async () => {
  const rows = [
    { date: '2026-01-09', high: 200, low: 1 },
    { date: '2026-01-10', high: 100, low: 90 },
    { date: '2026-01-12', high: 200, low: 1 },
    { date: '2026-01-13', high: 200, low: 1 },
  ];
  const calls = [];
  const service = load(
    'src/services/barrier-history.service.ts',
    {
      '@/services/market.service': { TIINGO_KEY: 'TEST_SECRET_TOKEN' },
      '@/lib/barrier-history': scanner,
    },
    {
      fetch: async url => {
        calls.push(new URL(url));
        return { ok: true, json: async () => rows };
      },
    },
  );
  const trade = validTrade({ barrierStartDate: '2026-01-10', barrierEndDate: '2026-01-12', expiryDate: '2026-01-12' });
  const report = await service.checkTradeBarrierHistory(trade, new Date('2026-01-11T12:00:00Z'));
  assert.equal(report.startDate, '2026-01-10');
  assert.equal(report.endDate, '2026-01-11');
  assert.equal(report.bars, 1);
  assert.equal(report.status, 'no_touch_observed');
  assert.equal(calls[0].searchParams.get('startDate'), '2026-01-10');
  assert.equal(calls[0].searchParams.get('resampleFreq'), '1day');
  assert.equal(calls[0].searchParams.get('token'), 'TEST_SECRET_TOKEN');

  const pastCalls = [];
  const pastService = load(
    'src/services/barrier-history.service.ts',
    {
      '@/services/market.service': { TIINGO_KEY: 'TEST_SECRET_TOKEN' },
      '@/lib/barrier-history': scanner,
    },
    {
      fetch: async url => {
        pastCalls.push(url);
        return { ok: true, json: async () => rows };
      },
    },
  );
  const past = await pastService.checkTradeBarrierHistory(
    validTrade({
      barrierStartDate: '2026-01-10',
      barrierEndDate: '2026-01-12',
      expiryDate: '2026-01-12',
    }),
    new Date('2026-01-20T12:00:00Z'),
  );
  assert.equal(past.endDate, '2026-01-12');
  assert.equal(past.status, 'touch_observed');
  assert.equal(past.touchDate, '2026-01-12');
  assert.equal(pastCalls.length, 1);
});

function validTrade(changes = {}) {
  return {
    id: 't1',
    customerId: 'c1',
    underlying: 'XAU',
    type: 'Call',
    position: 'Long',
    tradeDate: '2026-01-10',
    expiryDate: '2026-01-12',
    spot: 100,
    strike: 100,
    volatility: 0.2,
    contractSize: 1,
    premium: 2,
    currentPremium: null,
    mtm: null,
    pnl: null,
    delta: null,
    gamma: null,
    vega: null,
    theta: null,
    status: 'Open',
    barrierType: 'Knock Out Up',
    barrierLevel: 110,
    barrierStyle: 'Amerikan',
    ...changes,
  };
}

test('unsupported products, European style, invalid inputs, and over-366-day ranges do not fetch', async () => {
  let fetches = 0;
  const service = load(
    'src/services/barrier-history.service.ts',
    {
      '@/services/market.service': { TIINGO_KEY: 'TEST_SECRET_TOKEN' },
      '@/lib/barrier-history': scanner,
    },
    {
      fetch: async () => {
        fetches++;
        throw new Error('fetch should not run');
      },
    },
  );
  const now = new Date('2026-01-20T12:00:00Z');
  for (const trade of [
    validTrade({ underlying: 'BTC' }),
    validTrade({ underlying: 'XAG', barrierStyle: 'Avrupa' }),
    validTrade({ barrierLevel: 0 }),
    validTrade({ barrierStartDate: '2026-01-30' }),
    validTrade({ barrierStartDate: '2024-12-01' }),
  ])
    assert.equal((await service.checkTradeBarrierHistory(trade, now)).status, 'unavailable');
  assert.equal(fetches, 0);
});

test('HTTP 401/429 and network failures return sanitized unavailable reports', async () => {
  for (const status of [401, 429]) {
    const service = load(
      'src/services/barrier-history.service.ts',
      {
        '@/services/market.service': { TIINGO_KEY: 'TEST_SECRET_TOKEN' },
        '@/lib/barrier-history': scanner,
      },
      { fetch: async () => ({ ok: false, status, text: async () => 'leaked provider response TEST_SECRET_TOKEN' }) },
    );
    const report = await service.checkTradeBarrierHistory(validTrade(), new Date('2026-01-11T12:00:00Z'));
    assert.equal(report.status, 'unavailable');
    assert.match(report.note, new RegExp(`HTTP ${status}`));
    assert.ok(!JSON.stringify(report).includes('TEST_SECRET_TOKEN'));
    assert.ok(!JSON.stringify(report).includes('leaked provider response'));
  }
  const failing = load(
    'src/services/barrier-history.service.ts',
    {
      '@/services/market.service': { TIINGO_KEY: 'TEST_SECRET_TOKEN' },
      '@/lib/barrier-history': scanner,
    },
    {
      fetch: async () => {
        throw new Error('TEST_SECRET_TOKEN network details');
      },
    },
  );
  const report = await failing.checkTradeBarrierHistory(validTrade(), new Date('2026-01-11T12:00:00Z'));
  assert.equal(report.status, 'unavailable');
  assert.ok(!JSON.stringify(report).includes('TEST_SECRET_TOKEN'));
});

test('cache preserves original check timestamp and avoids duplicate fetches for five minutes', async () => {
  let fetches = 0;
  const service = load(
    'src/services/barrier-history.service.ts',
    {
      '@/services/market.service': { TIINGO_KEY: 'TEST_SECRET_TOKEN' },
      '@/lib/barrier-history': scanner,
    },
    {
      fetch: async () => {
        fetches++;
        return { ok: true, json: async () => [{ date: '2026-01-10', high: 100, low: 90 }] };
      },
    },
  );
  const trade = validTrade();
  const first = await service.checkTradeBarrierHistory(trade, new Date('2026-01-11T12:00:00Z'));
  const within = await service.checkTradeBarrierHistory(trade, new Date('2026-01-11T12:04:59Z'));
  assert.equal(fetches, 1);
  assert.equal(first.checkedAt, '2026-01-11T12:00:00.000Z');
  assert.equal(within.checkedAt, first.checkedAt);
  await service.checkTradeBarrierHistory(trade, new Date('2026-01-11T12:05:00Z'));
  assert.equal(fetches, 2);
});

test('customer action checks ownership before scanning and performs no database writes', async () => {
  const trade = validTrade();
  const calls = [];
  const result = { status: 'no_touch_observed' };
  const action = load('src/app/customers/[id]/barrier-history-actions.ts', {
    '@/services/mockDb': {
      db: {
        trades: {
          findByCustomerId: async customerId => {
            calls.push(['read', customerId]);
            return customerId === 'c1' ? [trade] : [];
          },
          update: async () => calls.push(['write']),
          create: async () => calls.push(['write']),
        },
      },
    },
    '@/lib/trade-validation': {
      validateId(id) {
        if (!id) throw new Error('invalid id');
      },
    },
    '@/services/barrier-history.service': {
      checkTradeBarrierHistory: async item => {
        calls.push(['scan', item.id]);
        return result;
      },
    },
  }).checkBarrierHistoryAction;
  assert.equal(await action('c1', 't1'), result);
  assert.deepEqual(
    calls.map(call => call.join(':')),
    ['read:c1', 'scan:t1'],
  );
  calls.length = 0;
  await assert.rejects(action('other-customer', 't1'), /Bu müşteriye ait işlem bulunamadı/);
  assert.deepEqual(
    calls.map(call => call.join(':')),
    ['read:other-customer'],
  );
  await assert.rejects(action('', 't1'), /invalid id/);
  assert.equal(calls.length, 1);
});
