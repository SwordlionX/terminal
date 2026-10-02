/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
/* No database, network, Next server, or production environment is loaded. */
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
const validation = load('src/lib/trade-validation.ts');
const valid = { underlying: 'XAU', type: 'Call', position: 'Long', tradeDate: '2026-10-02',
  expiryDate: '2026-12-31', spot: 4000, strike: 4100, contractSize: 100, premium: 20000 };

function fixture({ customer = true, price = 4000 } = {}) {
  const writes = [];
  const db = { customers: { findById: async () => customer ? { id: 'c1' } : null },
    trades: { create: async data => writes.push(['trade', data]),
      findByCustomerId: async () => [{ ...valid, id: 't1' }],
      update: async (id, data) => writes.push(['update', id, data]) },
    activity: { log: async (...data) => writes.push(['log', ...data]) } };
  const lifecycle = {
    bookTrade: async (trade, collateral) => {
      writes.push(['trade', trade]);
      if (collateral) writes.push(['collateral', collateral]);
    },
    settleTradeOwned: async (...args) => writes.push(['settle', ...args]),
    deleteOpenTradeOwned: async (...args) => writes.push(['delete', ...args]),
    addCollateralAtomically: async data => writes.push(['collateral', data]),
    removeCollateralOwned: async (...args) => writes.push(['removeCollateral', ...args]),
  };
  const imports = { '@/services/mockDb': { db },
    '@/repositories/trade-lifecycle.repository': lifecycle,
    '@/services/market.service': { getSpot: async () => price == null ? null : { price } },
    '@/lib/margin/engine': { MarginEngine: { getBaseMarginRate: () => 0.1 } },
    '@/lib/trade-validation': validation, 'next/cache': { revalidatePath() {} } };
  return { writes, ...load('src/app/customers/[id]/actions.ts', imports),
    ...load('src/app/customers/[id]/margin/collateral-actions.ts', imports) };
}

test('malformed trade values are rejected before any write', async () => {
  const invalid = [null, {}, { type: 'Typo' }, { position: 'Typo' }, { underlying: '' },
    { spot: NaN }, { spot: Infinity }, { spot: '' }, { spot: null }, { spot: true }, { spot: '4junk' },
    { spot: '0x10' }, { spot: -1 }, { strike: 0 }, { contractSize: 0 }, { premium: -1 },
    { volatility: -1 }, { volatility: 'NaN' }, { manualMarginRate: -0.1 }, { manualMarginRate: 1.01 },
    { manualMarginRate: null }, { initialCollateral: -1 }, { initialCollateral: Infinity },
    { initialCollateral: 100, collateralAssetCode: 'random' },
    { tradeDate: '2026-02-30' }, { expiryDate: 'wrong' }, { expiryDate: '2026-09-01' },
    { contractSize: 1e308 }, { contractSize: 1e-320 }, { isBarrier: 'true' },
    { isBarrier: true, barrierType: 'bad', barrierLevel: 4500, barrierStyle: 'Amerikan' },
    { isBarrier: true, barrierType: 'Knock Out Up', barrierLevel: 0, barrierStyle: 'Amerikan' },
    { isBarrier: true, barrierType: 'Knock Out Up', barrierLevel: 4500, barrierStyle: 'bad' },
    { isBarrier: true, barrierType: 'Knock Out Up', barrierLevel: 4500, barrierStyle: 'Amerikan', barrierEndDate: '2027-01-01' }];
  for (const change of invalid) {
    const f = fixture();
    const input = change === null ? null : Object.keys(change).length === 0 ? {} : { ...valid, ...change };
    await assert.rejects(f.addManualTradeAction('c1', input), undefined, JSON.stringify(change));
    assert.equal(f.writes.length, 0);
  }
});

test('customer existence and id are checked before any write', async () => {
  const f = fixture({ customer: false });
  await assert.rejects(f.addManualTradeAction('c1', valid), /Müşteri/);
  await assert.rejects(f.addManualTradeAction('', valid), /Müşteri/);
  await assert.rejects(f.addCustomerCollateral('c1', { assetCode: 'Nakit-USD', currency: 'USD', nominalQuantity: 5 }), /Müşteri/);
  assert.equal(f.writes.length, 0);
});

test('valid trade preserves premiums and explicit zero margin', async () => {
  const f = fixture();
  await f.addManualTradeAction('c1', { ...valid, underlying: ' xau ', spot: '4000', manualMarginRate: 0 });
  const trade = f.writes[0][1];
  assert.equal(trade.underlying, 'XAU');
  assert.equal(trade.premium, 20000);
  assert.equal(trade.currentPremium, 200);
  assert.equal(trade.marginRate, 0);
  assert.equal(trade.volatility, 0.15);
  assert.equal(trade.position, 'Long');
  assert.equal(trade.status, 'Open');
  assert.equal(trade.barrierType, undefined);
  const automatic = fixture();
  await automatic.addManualTradeAction('c1', valid);
  assert.equal(automatic.writes[0][1].marginRate, 0.1);
});

test('barrier metadata is validated and preserved without adding hit tracking', async () => {
  const f = fixture();
  await f.addManualTradeAction('c1', { ...valid, isBarrier: true, barrierType: 'Knock Out Up', barrierLevel: '4500', barrierStyle: 'Amerikan' });
  const trade = f.writes[0][1];
  assert.equal(trade.barrierLevel, 4500);
  assert.equal(trade.barrierStartDate, valid.tradeDate);
  assert.equal(trade.barrierEndDate, valid.expiryDate);
});

test('invalid collateral and missing metal quotes never cause writes', async () => {
  for (const data of [null, { assetCode: 'bad', nominalQuantity: 3 },
    { assetCode: 'Nakit-XAU', currency: 'USD', nominalQuantity: 3 },
    ...[0, -1, NaN, Infinity, null, true, '3junk'].map(nominalQuantity => ({ assetCode: 'Nakit-USD', currency: 'USD', nominalQuantity }))]) {
    const f = fixture();
    await assert.rejects(f.addCustomerCollateral('c1', data));
    assert.equal(f.writes.length, 0);
  }
  for (const price of [null, 0, -1, NaN, Infinity]) {
    const f = fixture({ price });
    await assert.rejects(f.addManualTradeAction('c1', { ...valid, initialCollateral: 2, collateralAssetCode: 'Nakit-XAU' }));
    await assert.rejects(f.addCustomerCollateral('c1', { assetCode: 'Nakit-XAU', currency: 'XAU', nominalQuantity: 2 }));
    assert.equal(f.writes.length, 0);
  }
});

test('USD and metal collateral are valued in correct units', async () => {
  const f = fixture();
  await f.addManualTradeAction('c1', { ...valid, initialCollateral: '2', collateralAssetCode: 'Nakit-XAU' });
  const metal = f.writes.find(([kind]) => kind === 'collateral')[1];
  assert.equal(metal.nominalQuantity, 2);
  assert.equal(metal.marketValueUsd, 8000);
  const usd = fixture({ price: null });
  await usd.addCustomerCollateral('c1', { assetCode: 'Nakit-USD', currency: 'USD', nominalQuantity: 500 });
  assert.equal(usd.writes[0][1].marketValueUsd, 500);
  const overflow = fixture({ price: 1e308 });
  await assert.rejects(overflow.addCustomerCollateral('c1', { assetCode: 'Nakit-XAU', currency: 'XAU', nominalQuantity: 100 }));
  assert.equal(overflow.writes.length, 0);
});

test('settlement rejects invalid spot before delegating and delegates valid close unchanged', async () => {
  for (const spot of [NaN, Infinity, -1, null, '']) {
    const f = fixture();
    await assert.rejects(f.settleTradeAction('c1', 't1', spot));
    assert.equal(f.writes.length, 0);
  }
  const f = fixture();
  await f.settleTradeAction('c1', 't1', 4400);
  assert.deepEqual(f.writes[0], ['settle', 'c1', 't1', 4400]);
});

test('legacy login no longer authenticates or creates a session', async () => {
  const route = load('src/app/api/login/route.ts', { 'next/server': { NextResponse: {
    json(body) { return { body, cookies: { set(name, value, options) {
      assert.equal(name, 'uf_auth'); assert.equal(value, ''); assert.equal(options.maxAge, 0);
    } } }; },
  } } });
  assert.equal((await route.POST()).body.protectionEnabled, false);
  assert.equal((await route.DELETE()).body.ok, true);
  const page = load('src/app/login/page.tsx', { 'next/navigation': { redirect(url) { throw new Error(`redirect:${url}`); } } });
  assert.throws(() => page.default(), /redirect:\//);
  assert.equal(fs.existsSync(path.join(__dirname, '../src/proxy.ts')), false);
});
