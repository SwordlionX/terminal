/* eslint-disable @typescript-eslint/no-require-imports -- Financial input regression tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
function load(file, imports = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: mod, exports: mod.exports, require: name => imports[name] });
  return mod.exports;
}
const carry = load('src/lib/market/cme-carry.ts');
const { parseOptionDefinitions, finalOptionSettlements } = load('src/lib/market/cme-option-inputs.ts', { './cme-carry': carry });
const ns = value => String(BigInt(Date.parse(value)) * 1000000n);
const date = '2026-10-05';
const defHeader = 'instrument_id,instrument_class,expiration,strike_price,underlying_id,security_update_action,ts_recv';
const statHeader = 'instrument_id,stat_type,price,ts_ref,ts_recv,ts_event,stat_flags,update_action';
const def = (id, at, action = 'A', strike = 100) => [id, 'C', ns('2026-12-28T18:30:00Z'), strike * 1e9, 'gc1', action, ns(at)].join(',');
const stat = (id, price = 2, flags = 3, action = 1, ref = date) => [id, 3, price === null ? '9223372036854775807' : price * 1e9, ns(ref + 'T00:00:00Z'), ns('2026-10-05T23:35:00Z'), ns('2026-10-05T23:35:00Z'), flags, action].join(',');
const csv = (header, ...rows) => [header, ...rows].join('\n');

test('an intraday option missing from the midnight snapshot joins its final settlement using the full session', () => {
  const early = def('early', date + 'T00:00:00Z');
  const intraday = def('new-strike', date + 'T12:00:00Z');
  const settlements = csv(statHeader, stat('early'), stat('new-strike', 3));
  assert.throws(() => finalOptionSettlements(settlements, date, parseOptionDefinitions(csv(defHeader, early)), 'XAU'), /adet=1, instrument_id=new-strike/);
  const full = parseOptionDefinitions(csv(defHeader, early, intraday));
  const result = finalOptionSettlements(settlements, date, full, 'XAU');
  assert.equal(result.size, 2);
  assert.equal(result.get('new-strike'), 3);
  const windows = carry.publicationWindows(date);
  assert.equal(windows.optionDefinitions.start, date + 'T00:00:00Z');
  assert.equal(windows.optionDefinitions.end, '2026-10-06T00:00:00Z');
  assert.equal(windows.definitions.end, date + 'T00:15:00Z');
});

test('intraday revisions replace prior terms and deletes cannot resurrect a stale definition', () => {
  const definitions = parseOptionDefinitions(csv(defHeader,
    def('revised', date + 'T00:00:00Z'), def('revised', date + 'T12:00:00Z', 'M', 110),
    def('deleted', date + 'T00:00:00Z'), def('deleted', date + 'T13:00:00Z', 'D')));
  assert.equal(definitions.get('revised').strike, 110);
  assert.equal(definitions.has('deleted'), false);
  assert.throws(() => finalOptionSettlements(csv(statHeader, stat('deleted')), date, definitions, 'XAG'), /XAG 2026-10-05.*instrument_id=deleted/);
});

test('missing IDs are counted with bounded diagnostics instead of silently dropping unmatched settlements', () => {
  const unknown = Array.from({ length: 30 }, (_, i) => stat('missing-' + i));
  assert.throws(() => finalOptionSettlements(csv(statHeader, ...unknown), date, new Map(), 'XAU'), error =>
    /adet=30/.test(error.message) && error.message.includes('missing-11') && !error.message.includes('missing-12'));
});

test('preliminary, deleted, sentinel and empty finals still stop the bundle; another session is excluded', () => {
  const definitions = parseOptionDefinitions(csv(defHeader, def('x', date + 'T00:00:00Z')));
  for (const row of [stat('x', 2, 2), stat('x', 2, 3, 2), stat('x', null)]) {
    assert.throws(() => finalOptionSettlements(csv(statHeader, row), date, definitions, 'XAU'), /final değil veya geçersiz.*instrument_id=x/);
  }
  assert.throws(() => finalOptionSettlements(csv(statHeader), date, definitions, 'XAU'), /settlement yok/);
  assert.equal(finalOptionSettlements(csv(statHeader, stat('unrelated', 3, 3, 1, '2026-10-02'), stat('x')), date, definitions, 'XAU').size, 1);
});
