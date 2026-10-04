/* eslint-disable @typescript-eslint/no-require-imports -- Offline pricing regression tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function modules(overrides = {}) {
  const cache = new Map();
  function load(file) {
    const full = path.resolve(__dirname, '..', file);
    if (cache.has(full)) return cache.get(full).exports;
    const m = { exports: {} }; cache.set(full, m);
    const source = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(source, { module: m, exports: m.exports, Date, require(id) {
      if (Object.hasOwn(overrides, id)) return overrides[id];
      let target = id.startsWith('@/') ? path.resolve(__dirname, '../src', id.slice(2)) : path.resolve(path.dirname(full), id);
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target += fs.existsSync(target + '.ts') ? '.ts' : '/index.ts';
      return load(target);
    } });
    return m.exports;
  }
  return load;
}
const load = modules(), { valueTrade, valuationTotal } = load('src/lib/pricing/trade-valuation.ts');
const date = '2026-01-01';
const trade = { id: 't1', customerId: 'c1', underlying: 'XAU', type: 'Put', position: 'Short', strike: 100,
  contractSize: 10, spot: 80, premium: 70, tradeDate: '2025-12-01', expiryDate: '2026-04-01', status: 'Open', currentPremium: 999, mtm: 999, pnl: 999 };
const market = { product: 'XAU', spot: 100, spotSource: 'Fixture', spotAt: date, surfaceSource: 'cme',
  surface: { symbol: 'GC', spot: 100, fetchedISO: date, builtWithR: .05, impliedLeaseRate: .01,
    expiries: [{ days: 90, date: '2026-04-01', points: [{ m: .65, iv: .2 }, { m: 1.4, iv: .2 }] }] } };

test('active long/short mark-to-market uses current terminal quote and original premium with opposite signs', () => {
  const short = valueTrade(trade, date, market), long = valueTrade({ ...trade, position: 'Long' }, date, market);
  assert.equal(short.state, 'valued'); assert.ok(short.positionValue < 0); assert.equal(short.entryCashflow, 70);
  assert.equal(short.pnl, short.positionValue + 70); assert.equal(long.positionValue, -short.positionValue);
  assert.equal(long.entryCashflow, -70); assert.equal(long.pnl, -short.pnl);
  assert.notEqual(short.pnl, 999); assert.equal(short.surfaceAt, date); assert.equal(trade.premium, 70);
});
test('P&L responds to live spot, not entry spot or persisted stale MTM', () => {
  const a = valueTrade(trade, date, market), b = valueTrade(trade, date, { ...market, spot: 90 });
  assert.equal(b.state, 'valued'); assert.ok(b.pnl < a.pnl); assert.notEqual(a.positionValue, b.positionValue);
  const same = valueTrade({ ...trade, spot: 1, mtm: -123 }, date, market);
  assert.equal(same.pnl, a.pnl);
});
test('no fabricated zero on missing curve, spot, invalid entry premium, unsupported product or barrier history', () => {
  for (const [t, m] of [[trade, undefined], [trade, { ...market, surface: null }], [trade, { ...market, spot: null }],
    [{ ...trade, premium: NaN }, market], [{ ...trade, contractSize: 0 }, market], [{ ...trade, underlying: 'GLD' }, market],
    [{ ...trade, barrierType: 'Knock Out Up' }, market], [{ ...trade, expiryDate: 'invalid' }, market], [{ ...trade, tradeDate: '2027-01-01' }, market], [{ ...trade, tradeDate: 'invalid' }, market]]) {
    const result = valueTrade(t, date, m);
    assert.equal(result.state, 'unavailable'); assert.equal(result.pnl, null); assert.equal(result.positionValue, null); assert.ok(result.reason);
  }
});
test('closed trades preserve settlement P&L; expired trades never use today spot as expiry spot', () => {
  const closed = valueTrade({ ...trade, status: 'Closed', pnl: 25 }, date);
  assert.equal(closed.state, 'settled'); assert.equal(closed.pnl, 25); assert.equal(closed.positionValue, null);
  for (const t of [{ ...trade, status: 'Expired' }, { ...trade, expiryDate: date }]) {
    const result = valueTrade(t, date, market); assert.equal(result.pnl, null); assert.match(result.reason, /Vade sonucu/);
  }
});
test('portfolio totals cannot conceal missing valuations, and exclude realized settlement', () => {
  const closed = { ...trade, id: 'closed', status: 'Closed', pnl: 700 };
  const valid = valueTrade(trade, date, market);
  const complete = valuationTotal([trade, closed], { t1: valid, closed: valueTrade(closed, date) });
  assert.equal(complete.pnl, valid.pnl); assert.equal(complete.count, 1);
  const incomplete = valuationTotal([trade, { ...trade, id: 'missing' }], { t1: valid });
  assert.equal(incomplete.pnl, null); assert.equal(incomplete.valued, 1); assert.equal(incomplete.missing, 1);
});
test('stale surface and stale spot dates/warnings remain attached to each valuation', () => {
  const result = valueTrade(trade, '2026-01-04', { ...market, spotStale: true });
  assert.equal(result.state, 'valued'); assert.equal(result.surfaceAt, date); assert.equal(result.spotAt, date);
  assert.ok(result.warnings.some(w => /Spot yenilenemedi/.test(w))); assert.ok(result.warnings.some(w => /3 gün önce/.test(w)));
});
test('batch valuation reads each metal once and does not request quotes for expired, closed or barrier contracts', async () => {
  const calls = [];
  const { valueTrades } = modules({ '@/lib/assistant/market': { terminalMarket: async p => { calls.push(p); return { ...market, product: p }; } },
    '@/lib/assistant/policy': { valuationToday: () => date } })('src/services/trade-valuation.service.ts');
  const list = [trade, { ...trade, id: 't2' }, { ...trade, id: 'silver', underlying: 'XAG' },
    { ...trade, id: 'closed', status: 'Closed', pnl: 12 }, { ...trade, id: 'expired', expiryDate: date }, { ...trade, id: 'barrier', barrierType: 'Knock Out Up' }];
  const result = await valueTrades(list);
  assert.deepEqual(calls.sort(), ['XAG', 'XAU']); assert.equal(Object.keys(result).length, 6);
  assert.equal(result.t1.state, 'valued'); assert.equal(result.t2.pnl, result.t1.pnl); assert.equal(result.closed.pnl, 12); assert.equal(result.barrier.pnl, null);
  calls.length = 0; await valueTrades(list.slice(3)); assert.equal(calls.length, 0);
});
