/* eslint-disable @typescript-eslint/no-require-imports -- Isolated SQLite integration tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const cache = new Map();
function loadTs(file) {
  const filename = path.resolve(__dirname, '..', file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, m);
  const normal = m.require.bind(m);
  m.require = id =>
    id.startsWith('.')
      ? loadTs(path.relative(path.resolve(__dirname, '..'), path.resolve(path.dirname(filename), id + '.ts')))
      : normal(id);
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );
  return m.exports;
}
const { createSqliteClient } = require('./support/sqlite-client.cjs');
const { InvoiceStore } = loadTs('src/features/invoices/store.ts');
const { parseMoney, date, pin, INITIAL_COMPANIES, csvCell } = loadTs('src/features/invoices/model.ts');
const { validateExtraction, documentMime } = loadTs('src/features/invoices/extraction.ts');

async function fixture(t) {
  const db = createSqliteClient();
  t.after(() => db.close());
  const store = new InvoiceStore(db, 'test-secret-for-isolated-database-only-123456789');
  const owner = await store.setup('0123', 'Test owner', 'local-setup', 'local-setup');
  return { db, store, owner: owner.account, token: owner.token };
}
test('four digit accounts preserve leading zeros, persist, and revoke across sessions', async t => {
  const { db, store, owner, token } = await fixture(t);
  assert.equal((await store.session(token)).name, 'Test owner');
  assert.equal((await store.login('0123', 'test-ip')).account.id, 'owner');
  await assert.rejects(
    () => store.setup('9999', 'Other', 'local-setup', 'local-setup'),
    e => e.status === 409,
  );
  await store.addAccount(owner, { name: 'Colleague', code: '0042' });
  const member = await store.login('0042', 'member-ip');
  assert.equal(member.maxAge, 90 * 86400);
  await assert.rejects(
    () => store.accounts(member.account),
    e => e.status === 403,
  );
  await assert.rejects(
    () => store.addAccount(owner, { name: 'Duplicate', code: '0042' }),
    e => e.status === 409,
  );
  await store.disableAccount(owner, member.account.id);
  assert.equal(await store.session(member.token), null);
  await assert.rejects(
    () => store.login('0042', 'member-ip'),
    e => e.status === 401,
  );
  await store.changeCode(owner, { id: member.account.id, code: '0055' });
  assert.equal((await store.login('0055', 'member-ip')).account.active, true);
  const dump = (await db.execute('SELECT code_digest FROM invoice_accounts')).rows;
  assert(dump.every(r => r.code_digest.length === 64 && !r.code_digest.includes('0123')));
  assert.equal(await store.session('forged-cookie'), null);
});
test('login rate limits share their state across instances and do not roll back failed attempts', async t => {
  const { db, store } = await fixture(t);
  for (let n = 0; n < 5; n++)
    await assert.rejects(
      () => store.login('1111', 'attacker-ip'),
      e => e.status === 401,
    );
  const another = new InvoiceStore(db, 'test-secret-for-isolated-database-only-123456789');
  await assert.rejects(
    () => another.login('0123', 'attacker-ip'),
    e => e.status === 429,
  );
  assert.equal((await another.login('0123', 'different-ip')).account.id, 'owner');
});
test('firm order, duplicate numbers, opening usage and exact cents reconcile', async t => {
  const { store, owner } = await fixture(t);
  assert.deepEqual(
    (await store.snapshot({})).companies.map(c => c.name),
    INITIAL_COMPANIES.map(c => c[1]),
  );
  const { id } = await store.create(owner, {
    companyId: 'albayrak',
    number: 'AB 001',
    date: '2026-11-05',
    amountCents: 100001,
    usedCents: 20001,
  });
  await assert.rejects(
    () => store.create(owner, { companyId: 'albayrak', number: 'ab001', date: '2026-11-05', amountCents: 100 }),
    e => e.status === 409,
  );
  await store.create(owner, { companyId: 'cizgi', number: 'ab001', date: '2026-11-05', amountCents: 100 });
  const s = await store.snapshot({ companyId: 'albayrak', search: 'ab001' });
  assert.equal(s.total, 1);
  assert.equal(s.invoices[0].remainingCents, 80000);
  assert.equal(s.invoices[0].status, 'partial');
  const h = await store.history(id);
  assert.equal(h.events[0].deltaCents, 20001);
  assert.equal(h.events[0].accountName, 'Test owner');
  assert.equal(s.totals.amountCents, 100101);
  assert.equal(s.totals.usedCents, 20001);
  assert.equal(s.totals.openCount, 2);
});
test('concurrent usage cannot overspend and retry of the same operation cannot double charge', async t => {
  const { store, owner } = await fixture(t);
  const { id } = await store.create(owner, {
    companyId: 'celebi',
    number: 'CX-1',
    date: '2026-11-05',
    amountCents: 10000,
  });
  const use = { id, amountCents: 7000, date: '2026-11-05', note: 'Trade reference' };
  const attempts = await Promise.allSettled([
    store.usage(owner, { ...use, requestId: 'first' }),
    store.usage(owner, { ...use, requestId: 'second' }),
  ]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
  const key = attempts[0].status === 'fulfilled' ? 'first' : 'second';
  await store.usage(owner, { ...use, requestId: key });
  let history = await store.history(id);
  assert.equal(history.invoice.usedCents, 7000);
  assert.equal(history.events.length, 1);
  await store.reverse(owner, { eventId: history.events[0].id, note: 'Incorrect trade, reversed' });
  await assert.rejects(
    () => store.reverse(owner, { eventId: history.events[0].id, note: 'Again' }),
    e => e.status === 409,
  );
  history = await store.history(id);
  assert.equal(history.invoice.usedCents, 0);
  assert.equal(history.invoice.status, 'unused');
  assert.equal(history.events.length, 2);
  assert.equal(
    history.events.reduce((n, e) => n + e.deltaCents, 0),
    history.invoice.usedCents,
  );
});
test('closed invoices, stale edits and invoice reductions below used balance', async t => {
  const { store, owner } = await fixture(t);
  const { id } = await store.create(owner, {
    companyId: 'cakmakci',
    number: '00001',
    date: '2026-11-05',
    amountCents: 12345,
  });
  const before = (await store.history(id)).invoice;
  await store.usage(owner, { id, amountCents: 12345, date: '2026-11-05', note: 'Complete use', requestId: 'all' });
  const snapshot = await store.snapshot({ status: 'closed' });
  assert.equal(snapshot.invoices[0].remainingCents, 0);
  assert.equal(snapshot.totals.openCount, 0);
  await assert.rejects(
    () => store.update({ ...before, amountCents: 99999 }),
    e => e.status === 409,
  );
  const current = (await store.history(id)).invoice;
  await assert.rejects(
    () => store.update({ ...current, amountCents: 1 }),
    e => e.status === 400,
  );
});
test('Turkish amounts, invalid dates, four digit codes and CSV formula safety', () => {
  for (const [s, n] of [
    ['1.250,50', 125050],
    ['1250,50', 125050],
    ['1.000', 100000],
    ['0,01', 1],
    ['1250.5', 125050],
  ])
    assert.equal(parseMoney(s), n);
  for (const s of ['1,234.50', 'NaN', '-1', '1,2,3', '']) assert.throws(() => parseMoney(s));
  for (const s of ['2026-02-30', '2026-99-99', 'wrong']) assert.throws(() => date(s));
  assert.equal(pin('0000'), '0000');
  for (const s of ['123', '12345', 1234, '1a34']) assert.throws(() => pin(s));
  assert.equal(csvCell('=SUM(1;2)'), `"'=SUM(1;2)"`);
});
test('document extraction refuses invented currency conversion and ambiguous company matches', () => {
  const companies = INITIAL_COMPANIES.map(([id, name]) => ({ id, name }));
  const result = validateExtraction(
    { companyName: 'Çizgi Tekstil A.Ş.', number: 'FT-001', date: '2026-11-05', amountCents: 125050, currency: 'TRY' },
    companies,
  );
  assert.equal(result.companyId, 'cizgi');
  assert.equal(result.amountCents, 125050);
  const foreign = validateExtraction(
    { companyName: 'Unknown', number: null, date: '2026-02-30', amountCents: 10000, currency: 'USD' },
    companies,
  );
  assert.equal(foreign.amountCents, null);
  assert.equal(foreign.companyId, null);
  assert.equal(foreign.date, null);
  assert(foreign.warnings.length >= 3);
  assert.equal(documentMime(Buffer.from('%PDF-1.7')), 'application/pdf');
  assert.throws(() => documentMime(Buffer.from('<script>')));
});
