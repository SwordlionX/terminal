/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createClient } = require('@libsql/client');
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
    if (id === 'node:crypto') return require(id);
    throw new Error(`Unmocked dependency: ${id}`);
  } });
  return loadedModule.exports;
}

const tradeFields = ['id', 'customerId', 'tradeDate', 'expiryDate', 'underlying', 'type', 'position',
  'spot', 'strike', 'volatility', 'contractSize', 'premium', 'currentPremium', 'mtm', 'pnl',
  'delta', 'gamma', 'vega', 'theta', 'marginRate', 'status', 'barrierType', 'barrierLevel',
  'barrierStyle', 'barrierStartDate', 'barrierEndDate'];
const numericTradeFields = new Set(['spot', 'strike', 'volatility', 'contractSize', 'premium',
  'currentPremium', 'mtm', 'pnl', 'delta', 'gamma', 'vega', 'theta', 'marginRate', 'barrierLevel']);

async function fixture() {
  // Deliberately bypass production dbc/init. Shared in-memory SQLite keeps libsql's
  // transaction connection on the same isolated database as the fixture client.
  const client = createClient({ url: 'file::memory:?cache=shared' });
  // This libsql memory URI is process-shared, so reset its tables before each fixture.
  await client.batch([
    'DROP TRIGGER IF EXISTS fail_collateral',
    'DROP TRIGGER IF EXISTS fail_settlement_metadata',
    'DROP TABLE IF EXISTS trades',
    'DROP TABLE IF EXISTS collaterals',
    'DROP TABLE IF EXISTS activity_log',
    'DROP TABLE IF EXISTS kv',
    'DROP TABLE IF EXISTS customers',
  ]);
  await client.batch([
    'CREATE TABLE customers (id TEXT PRIMARY KEY, companyName TEXT)',
    `CREATE TABLE trades (${tradeFields.map((field, index) => `${field} ${index === 0 ? 'TEXT PRIMARY KEY' : numericTradeFields.has(field) ? 'REAL' : 'TEXT'}`).join(', ')})`,
    'CREATE TABLE collaterals (id TEXT PRIMARY KEY, customerId TEXT, assetCode TEXT, currency TEXT, nominalQuantity REAL, marketValueUsd REAL, haircut REAL, addedAt TEXT)',
    'CREATE TABLE activity_log (id TEXT PRIMARY KEY, customerId TEXT, date TEXT, type TEXT, description TEXT)',
    'CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT)',
  ]);
  await client.batch([
    { sql: 'INSERT INTO customers(id, companyName) VALUES (?, ?)', args: ['c1', 'Customer One'] },
    { sql: 'INSERT INTO customers(id, companyName) VALUES (?, ?)', args: ['c2', 'Customer Two'] },
  ]);
  const mockDb = load('src/services/mockDb.ts', {
    react: { cache: fn => fn },
    '@/lib/db': { dbc: async () => client },
  });
  const validation = load('src/lib/trade-validation.ts');
  const repository = load('src/repositories/trade-lifecycle.repository.ts', {
    'node:crypto': require('node:crypto'),
    '@/lib/db': { dbc: async () => client },
    '@/services/mockDb': mockDb,
    '@/lib/trade-validation': validation,
  });
  return { client, repository };
}

function trade(overrides = {}) {
  return {
    customerId: 'c1', tradeDate: '2026-10-02', expiryDate: '2026-12-31', underlying: 'XAU',
    type: 'Call', position: 'Long', spot: 4000, strike: 4100, volatility: 0.15,
    contractSize: 10, premium: 1000, currentPremium: 100, mtm: 0, pnl: 0,
    delta: 0, gamma: 0, vega: 0, theta: 0, marginRate: 0.1, status: 'Open',
    ...overrides,
  };
}

async function rows(client, sql, args = []) {
  return (await client.execute({ sql, args })).rows;
}

test('books trade, collateral, and activity history in one transaction', async t => {
  const { client, repository } = await fixture();
  t.after(() => client.close());
  const id = await repository.bookTrade(trade(), {
    customerId: 'c1', assetCode: 'Nakit-USD', currency: 'USD', nominalQuantity: 500,
    marketValueUsd: 500, haircut: 0,
  });
  assert.match(id, /^t-/);
  assert.equal((await rows(client, 'SELECT id FROM trades')).length, 1);
  assert.equal((await rows(client, 'SELECT id FROM collaterals')).length, 1);
  assert.deepEqual((await rows(client, 'SELECT type FROM activity_log ORDER BY type')).map(row => row.type), ['Margin Updated', 'Trade Added']);
});

test('collateral insert failure rolls trade and activity history back', async t => {
  const { client, repository } = await fixture();
  t.after(() => client.close());
  await client.execute("CREATE TRIGGER fail_collateral BEFORE INSERT ON collaterals BEGIN SELECT RAISE(ABORT, 'injected collateral failure'); END");
  await assert.rejects(repository.bookTrade(trade(), {
    customerId: 'c1', assetCode: 'Nakit-USD', currency: 'USD', nominalQuantity: 500,
    marketValueUsd: 500, haircut: 0,
  }), /injected collateral failure/);
  assert.equal((await rows(client, 'SELECT id FROM trades')).length, 0);
  assert.equal((await rows(client, 'SELECT id FROM collaterals')).length, 0);
  assert.equal((await rows(client, 'SELECT id FROM activity_log')).length, 0);
});

test('bookTrade validates customer inside the transaction before writing', async t => {
  const { client, repository } = await fixture();
  t.after(() => client.close());
  await assert.rejects(repository.bookTrade(trade({ customerId: 'missing' })), /Müşteri/);
  assert.equal((await rows(client, 'SELECT id FROM trades')).length, 0);
  assert.equal((await rows(client, 'SELECT id FROM activity_log')).length, 0);
});

test('settlement calculates and stores intrinsic-at-expiry PnL for call/put long/short', async t => {
  const { client, repository } = await fixture();
  t.after(() => client.close());
  const cases = [
    { type: 'Call', position: 'Long', spot: 4400, expected: 2000 },
    { type: 'Put', position: 'Long', spot: 3900, expected: 1000 },
    { type: 'Call', position: 'Short', spot: 4400, expected: -2000 },
    { type: 'Put', position: 'Short', spot: 4200, expected: 1000 },
  ];
  for (const sample of cases) {
    const id = await repository.bookTrade(trade({ ...sample, strike: 4100, contractSize: 10, premium: 1000 }));
    await repository.settleTradeOwned('c1', id, sample.spot);
    const [saved] = await rows(client, 'SELECT status,pnl,mtm,currentPremium FROM trades WHERE id = ?', [id]);
    assert.equal(saved.status, 'Closed');
    assert.equal(saved.pnl, sample.expected, `${sample.type} ${sample.position}`);
    assert.equal(saved.mtm, 0);
    assert.equal(saved.currentPremium, 0);
    const [metadata] = await rows(client, 'SELECT v FROM kv WHERE k = ?', [`trade_settlement:${id}`]);
    assert.equal(JSON.parse(metadata.v).expirySpot, sample.spot);
    assert.ok(Date.parse(JSON.parse(metadata.v).closedAt));
  }
});

test('settlement is single-shot and does not duplicate closure metadata or logs', async t => {
  const { client, repository } = await fixture();
  t.after(() => client.close());
  const id = await repository.bookTrade(trade());
  await repository.settleTradeOwned('c1', id, 4400);
  const [saved] = await rows(client, 'SELECT pnl FROM trades WHERE id = ?', [id]);
  const [metadata] = await rows(client, 'SELECT v FROM kv WHERE k = ?', [`trade_settlement:${id}`]);
  const activitiesBefore = (await rows(client, "SELECT id FROM activity_log WHERE type = 'Trade Closed'")).length;
  await assert.rejects(repository.settleTradeOwned('c1', id, 5000), /zaten kapatılmış/);
  const [after] = await rows(client, 'SELECT pnl FROM trades WHERE id = ?', [id]);
  const [metadataAfter] = await rows(client, 'SELECT v FROM kv WHERE k = ?', [`trade_settlement:${id}`]);
  assert.equal(after.pnl, saved.pnl);
  assert.equal(metadataAfter.v, metadata.v);
  assert.equal((await rows(client, "SELECT id FROM activity_log WHERE type = 'Trade Closed'")).length, activitiesBefore);
});

test('metadata insertion failure rolls settlement and close activity back', async t => {
  const { client, repository } = await fixture();
  t.after(() => client.close());
  const id = await repository.bookTrade(trade());
  await client.execute("CREATE TRIGGER fail_settlement_metadata BEFORE INSERT ON kv WHEN NEW.k LIKE 'trade_settlement:%' BEGIN SELECT RAISE(ABORT, 'injected metadata failure'); END");
  await assert.rejects(repository.settleTradeOwned('c1', id, 4400), /injected metadata failure/);
  const [saved] = await rows(client, 'SELECT status,pnl FROM trades WHERE id = ?', [id]);
  assert.equal(saved.status, 'Open');
  assert.equal(saved.pnl, 0);
  assert.equal((await rows(client, "SELECT id FROM activity_log WHERE type = 'Trade Closed'")).length, 0);
  assert.equal((await rows(client, 'SELECT k FROM kv WHERE k LIKE ?', [`trade_settlement:${id}`])).length, 0);
});

test('ownership guards prevent foreign settlement, deletion, and collateral removal', async t => {
  const { client, repository } = await fixture();
  t.after(() => client.close());
  const id = await repository.bookTrade(trade(), {
    customerId: 'c1', assetCode: 'Nakit-USD', currency: 'USD', nominalQuantity: 500,
    marketValueUsd: 500, haircut: 0,
  });
  const [collateral] = await rows(client, 'SELECT id FROM collaterals');
  await assert.rejects(repository.settleTradeOwned('c2', id, 4400), /bulunamadı/);
  await assert.rejects(repository.deleteOpenTradeOwned('c2', id), /bulunamadı/);
  await assert.rejects(repository.removeCollateralOwned('c2', collateral.id), /bulunamadı/);
  const [saved] = await rows(client, 'SELECT status,pnl FROM trades WHERE id = ?', [id]);
  assert.equal(saved.status, 'Open');
  assert.equal(saved.pnl, 0);
  assert.equal((await rows(client, 'SELECT id FROM collaterals')).length, 1);
  assert.equal((await rows(client, "SELECT id FROM activity_log WHERE type = 'Trade Closed'")).length, 0);
});

test('closed trades cannot be deleted and failed delete/remove actions leave no activity', async t => {
  const { client, repository } = await fixture();
  t.after(() => client.close());
  const id = await repository.bookTrade(trade());
  await repository.settleTradeOwned('c1', id, 4400);
  await assert.rejects(repository.deleteOpenTradeOwned('c1', id), /arşivlenmiş/);
  await assert.rejects(repository.removeCollateralOwned('c1', 'missing'), /bulunamadı/);
  assert.equal((await rows(client, 'SELECT id FROM trades WHERE id = ?', [id])).length, 1);
  assert.equal((await rows(client, "SELECT id FROM activity_log WHERE type = 'Other'")).length, 0);
});

test('archive returns only Closed trades, preserves legacy null metadata, and filters by customer', async t => {
  const { client, repository } = await fixture();
  t.after(() => client.close());
  const id = await repository.bookTrade(trade());
  await repository.settleTradeOwned('c1', id, 4400);
  const legacy = trade({ customerId: 'c2', status: 'Closed', pnl: 123 });
  const legacyArgs = [
    'legacy', legacy.customerId, legacy.tradeDate, legacy.expiryDate, legacy.underlying, legacy.type,
    legacy.position, legacy.spot, legacy.strike, legacy.volatility, legacy.contractSize, legacy.premium,
    legacy.currentPremium, legacy.mtm, legacy.pnl, legacy.delta, legacy.gamma, legacy.vega, legacy.theta,
    legacy.marginRate, legacy.status, null, null, null, null, null,
  ];
  await client.execute({ sql: `INSERT INTO trades (${tradeFields.join(',')}) VALUES (${tradeFields.map(() => '?').join(',')})`, args: legacyArgs });
  await client.execute({ sql: "INSERT INTO trades(id,customerId,status,expiryDate,pnl) VALUES (?,?,?,?,?)", args: ['expired', 'c2', 'Expired', '2026-12-31', 999] });
  const all = await repository.findArchivedTrades();
  assert.equal(all.length, 2);
  assert.deepEqual(all.map(row => row.trade.status), ['Closed', 'Closed']);
  const old = all.find(row => row.trade.id === 'legacy');
  assert.equal(old.customerName, 'Customer Two');
  assert.equal(old.closedAt, null);
  assert.equal(old.expirySpot, null);
  assert.equal(old.trade.pnl, 123);
  const filtered = await repository.findArchivedTrades('c1');
  assert.deepEqual(filtered.map(row => row.trade.id), [id]);
});

test('zero expiry spot is accepted and malformed or negative spots are rejected without writes', async t => {
  const { client, repository } = await fixture();
  t.after(() => client.close());
  const id = await repository.bookTrade(trade());
  for (const spot of [-1, NaN, Infinity, null, '']) {
    await assert.rejects(repository.settleTradeOwned('c1', id, spot));
    const [saved] = await rows(client, 'SELECT status FROM trades WHERE id = ?', [id]);
    assert.equal(saved.status, 'Open');
  }
  await repository.settleTradeOwned('c1', id, 0);
  const archived = await repository.findArchivedTrades('c1');
  assert.equal(archived[0].expirySpot, 0);
});

test('concurrent attempts to close one trade produce at most one settlement and log', async t => {
  const { client, repository } = await fixture();
  t.after(() => client.close());
  const id = await repository.bookTrade(trade());
  const outcomes = await Promise.allSettled([
    repository.settleTradeOwned('c1', id, 4400),
    repository.settleTradeOwned('c1', id, 4500),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const [saved] = await rows(client, 'SELECT status FROM trades WHERE id = ?', [id]);
  assert.equal(saved.status, 'Closed');
  assert.equal((await rows(client, 'SELECT k FROM kv WHERE k = ?', [`trade_settlement:${id}`])).length, 1);
  assert.equal((await rows(client, "SELECT id FROM activity_log WHERE type = 'Trade Closed'")).length, 1);
});
