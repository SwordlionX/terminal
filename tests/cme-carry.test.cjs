/* eslint-disable @typescript-eslint/no-require-imports -- Financial input regression tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
const mod = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('src/lib/market/cme-carry.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { module: mod, exports: mod.exports },
);
const {
  parseSessionSettlements: parse,
  parseFutureDefinitions,
  publicationWindows,
  buildCarrySnapshot: build,
  interpolateFuturesPrice: interpolate,
} = mod.exports;
const date = '2026-10-01';
const ns = date => String(BigInt(Date.parse(date)) * 1000000n);
const header = 'instrument_id,stat_type,price,ts_ref,ts_recv,ts_event,stat_flags,update_action';
function row({ id = 'gc1', price = 100, ref = date, time = '2026-10-01T23:36:00Z', flags = 3, action = 1 } = {}) {
  return [
    id,
    3,
    price === null ? '9223372036854775807' : price * 1e9,
    ns(ref + 'T00:00:00Z'),
    ns(time),
    ns(time),
    flags,
    action,
  ].join(',');
}
const stats = (...items) => parse([header, ...items].join('\n'), date);
function fixture() {
  const definitions = new Map(),
    settlements = new Map();
  for (const root of ['GC', 'SI', 'SR1', 'SR3']) {
    for (let i = 1; i <= 10; i++) {
      const id = root + i;
      const expiry = new Date(Date.parse(date + 'T17:30:00Z') + i * 30 * 86400000).toISOString();
      definitions.set(id, { instrumentId: id, symbol: id, root, instrumentClass: 'F', lastTradeTime: expiry });
      settlements.set(id, {
        instrumentId: id,
        price: 100,
        referenceDate: date,
        publishedAt: '2026-10-01T23:36:00Z',
        eventAt: '2026-10-01T23:36:00Z',
        flags: 3,
        deleted: false,
      });
    }
  }
  return { definitions, settlements };
}
test('preliminary → final revision wins; an intraday/trading-tick message cannot replace it', () => {
  const result = stats(
    row({ flags: 2, time: '2026-10-01T17:30:00Z', price: 99 }),
    row({ price: 101 }),
    row({ flags: 11, time: '2026-10-02T00:00:00Z', price: 200 }),
    row({ flags: 7, price: 102 }),
  );
  assert.equal(result.get('gc1').price, 101);
  assert.equal(result.get('gc1').flags, 3);
});
test('ts_ref is the seans date even when the final is published on the next UTC day', () => {
  const result = stats(row({ time: '2026-10-02T02:00:00Z' }), row({ ref: '2026-09-30', price: 333 }));
  assert.equal(result.get('gc1').price, 100);
  assert.equal(result.get('gc1').referenceDate, date);
});
test('latest deletion or sentinel remains invalid, without resurrecting an earlier quote', () => {
  assert.equal(stats(row(), row({ action: 2, time: '2026-10-02T01:00:00Z' })).get('gc1').deleted, true);
  assert.equal(stats(row(), row({ price: null, time: '2026-10-02T01:00:00Z' })).get('gc1').price, null);
});
test('out of order publication cannot regress the quote; missing fields and truncated rows fail', () => {
  assert.equal(stats(row({ time: '2026-10-02T01:00:00Z', price: 101 }), row()).get('gc1').price, 101);
  assert.throws(() => parse('instrument_id,price\nx,100', date), /alanları eksik/);
  assert.throws(() => stats('x,3'), /satırı eksik/);
});
test('standard window closes 04:00 UTC next day; the extended window reaches the next business day', () => {
  assert.equal(publicationWindows('2026-10-02').statistics.end, '2026-10-03T04:00:00.000Z');
  assert.equal(publicationWindows('2026-10-02').statisticsExtended.end, '2026-10-05T16:00:00.000Z');
  assert.equal(publicationWindows('2026-12-10').statistics.end, '2026-12-11T04:00:00.000Z');
  assert.equal(publicationWindows('2026-12-10').statisticsExtended.end, '2026-12-11T16:00:00.000Z');
  assert.throws(() => publicationWindows('2026-10-03'), /Hafta sonu/);
  assert.throws(() => publicationWindows('2026-02-30'), /YYYY-MM-DD/);
});
test('actual final is not required: a theoretical final is retained and labelled', () => {
  const f = fixture();
  f.settlements.get('GC1').flags = 1;
  assert.equal(build(date, f.definitions, f.settlements, 'now').products.GC.nodes[0].flags, 1);
});
test('one preliminary or deleted contract rejects the entire snapshot; missing/no-OI is disclosed', () => {
  const f = fixture();
  f.settlements.get('GC1').flags = 2;
  assert.throws(() => build(date, f.definitions, f.settlements, 'now'), /final settlement yok/);
  f.settlements.get('GC1').flags = 3;
  f.settlements.get('GC1').deleted = true;
  assert.throws(() => build(date, f.definitions, f.settlements, 'now'), /final settlement yok/);
  f.settlements.get('GC1').deleted = false;
  f.definitions.set('untraded', { ...f.definitions.get('GC1'), instrumentId: 'untraded', symbol: 'untraded' });
  assert.equal(build(date, f.definitions, f.settlements, 'now').products.GC.missingSettlementIds[0], 'untraded');
});
test('weekly option addition does not change carry; equal-priced futures stay distinct with zero carry', () => {
  const f = fixture(),
    before = build(date, f.definitions, f.settlements, 'now');
  f.definitions.set('weekly', { ...f.definitions.get('GC1'), instrumentId: 'weekly', instrumentClass: 'C' });
  const after = build(date, f.definitions, f.settlements, 'now');
  assert.equal(JSON.stringify(after.products.GC), JSON.stringify(before.products.GC));
  assert.equal(after.products.GC.nodes.length, 10);
  assert.ok(after.products.GC.adjacentNetCarry.every(s => s.rateAct365Continuous === 0));
  assert.equal(after.pricingReady, false);
  assert.equal('impliedLeaseRate' in after, false);
});
test('log futures interpolation reproduces nodes, has no extrapolation and uses the true future expiry', () => {
  const f = fixture();
  f.settlements.get('GC2').price = 121;
  const curve = build(date, f.definitions, f.settlements, 'now').products.GC;
  const a = curve.nodes[0],
    b = curve.nodes[1];
  const mid = new Date((Date.parse(a.lastTradeTime) + Date.parse(b.lastTradeTime)) / 2).toISOString();
  assert.equal(interpolate(curve.nodes, a.lastTradeTime), 100);
  assert.ok(Math.abs(interpolate(curve.nodes, mid) - 110) < 1e-10);
  assert.equal(interpolate(curve.nodes, '2020-01-01'), null);
  assert.ok(Math.abs(curve.adjacentNetCarry[0].rateAct365Continuous - Math.log(1.21) / (30 / 365)) < 1e-10);
});
test('definition identity and exchange expiration come from data, not symbol or price deduplication', () => {
  const text =
    'instrument_id,raw_symbol,asset,instrument_class,expiration,security_update_action\n1,"GC,quoted",GC,F,' +
    ns('2026-12-29T18:30:00Z') +
    ',A';
  const def = parseFutureDefinitions(text).get('1');
  assert.equal(def.symbol, 'GC,quoted');
  assert.equal(def.lastTradeTime, '2026-12-29T18:30:00.000Z');
});
test('a settlement without an instrument definition cannot be silently dropped from the curve', () => {
  const f = fixture();
  f.settlements.set('lateListing', { ...f.settlements.get('GC1'), instrumentId: 'lateListing' });
  assert.throws(() => build(date, f.definitions, f.settlements, 'now'), /kontrat tanımı eksik/);
});

test('missing or preliminary SOFR finals never block the metal snapshot; metal futures still must be final', () => {
  const f = fixture();
  f.settlements.get('SR11').flags = 2;
  const snapshot = build(date, f.definitions, f.settlements, 'now');
  assert.equal(snapshot.products.SR1.nodes.length, 0);
  assert.match(snapshot.products.SR1.unavailable, /final settlement yok/);
  assert.equal(snapshot.products.GC.nodes.length, 10);
  assert.equal(snapshot.products.SR3.nodes.length, 10);
  f.settlements.get('SI1').flags = 2;
  assert.throws(() => build(date, f.definitions, f.settlements, 'now'), /final settlement yok/);
});
