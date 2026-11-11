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
const { validateExtraction, validateExtractions, documentMime } = loadTs('src/features/invoices/extraction.ts');
const { readDocumentQr } = loadTs('src/features/invoices/read-qr.ts');

async function readUploadFixture(payload, qrCodes = [], finishReason = 'STOP', pdfPages) {
  const calls = [];
  let reservations = 0;
  const existing = { id: 'existing', number: 'QA2026000000123' };
  const db = {
    companies: async () => companies,
    duplicatesMany: async numbers =>
      new Map(numbers.map(number => [number, number === existing.number ? [existing] : []])),
    signReading: result => (result.document.qrStatus === 'matched' ? 'fixture-proof' : null),
  };
  const mock = {
    '@google/genai': {
      Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', BOOLEAN: 'BOOLEAN' },
      GoogleGenAI: class {
        models = {
          generateContent: async request => {
            calls.push(request);
            return {
              text: JSON.stringify(typeof payload === 'function' ? payload(calls.length) : payload),
              candidates: [{ finishReason }],
            };
          },
        };
      },
    },
    '@/features/invoices/server': {
      authenticated: async () => ({ db, account: { id: 'fixture-account', role: 'member' } }),
      sameOrigin: () => {},
      json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
      errorResponse: error => new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 }),
    },
    '@/features/invoices/model': loadTs('src/features/invoices/model.ts'),
    '@/features/invoices/extraction': loadTs('src/features/invoices/extraction.ts'),
    '@/features/invoices/qr-evidence': loadTs('src/features/invoices/qr-evidence.ts'),
    '@/features/invoices/pdf-review': loadTs('src/features/invoices/pdf-review.ts'),
    '@/features/invoices/document-reader': loadTs('src/features/invoices/document-reader.ts'),
    '@/lib/assistant/limits': {
      // Per-account read cap; counted separately from the shared provider budget.
      reserveInvoiceRead: async () => {},
      reserveModelCall: async () => {
        reservations++;
      },
      reserveRequest: async () => {
        reservations++;
      },
      readModelBlocks: async () => ({}),
      blockModel: async () => {},
    },
    '@/lib/assistant/models': {
      availableModels: models => models,
      modelChain: () => ['fixture-1', 'fixture-2'],
      thinkingFor: () => ({}),
    },
  };
  const filename = path.resolve('src/app/api/fatura/mesnet/route.ts');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const normal = mod.require.bind(mod);
  mod.require = id => mock[id] || normal(id);
  mod._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename,
  );
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fixture-only-never-sent';
  try {
    const form = new FormData();
    form.set('file', new Blob(['%PDF-synthetic'], { type: 'application/pdf' }), 'batch.pdf');
    form.set('qrCodes', JSON.stringify(qrCodes));
    if (pdfPages) form.set('pdfPages', JSON.stringify(pdfPages));
    const response = await mod.exports.POST(
      new Request('http://localhost/api/fatura/mesnet', { method: 'POST', body: form }),
    );
    return { status: response.status, body: await response.json(), calls, reservations };
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
}

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
  assert.equal(s.balances[0].amountCents, 100101);
  assert.equal(s.balances[0].usedCents, 20001);
  assert.equal(s.balances[0].openCount, 2);
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
  assert.equal(snapshot.balances[0].openCount, 0);
  await assert.rejects(
    () => store.update(owner, { ...before, amountCents: 99999 }),
    e => e.status === 409,
  );
  const current = (await store.history(id)).invoice;
  await assert.rejects(
    () => store.update(owner, { ...current, amountCents: 1 }),
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
  assert.equal(foreign.amountCents, 10000);
  assert.equal(foreign.currency, 'USD');
  assert.equal(foreign.companyId, null);
  assert.equal(foreign.date, null);
  assert(foreign.warnings.length >= 3);
  assert.equal(documentMime(Buffer.from('%PDF-1.7')), 'application/pdf');
  assert.throws(() => documentMime(Buffer.from('<script>')));
});

test('currency balances stay separate and usage history prevents changing units', async t => {
  const { store, owner } = await fixture(t);
  const base = { companyId: 'elve', date: '2026-11-05' };
  const fx = await store.create(owner, { ...base, number: 'QA-FX-001', amountCents: 250000, currency: 'GBP' });
  await store.create(owner, { ...base, number: 'QA-TL-001', amountCents: 11250000, currency: 'TRY' });
  await store.create(owner, { ...base, number: 'QA-US-001', amountCents: 80000, currency: 'USD' });
  await store.usage(owner, {
    id: fx.id,
    amountCents: 10000,
    date: base.date,
    note: 'Synthetic use',
    requestId: 'fx-use',
  });
  const s = await store.snapshot({ companyId: 'elve' });
  assert.deepEqual(
    s.balances.map(b => [b.currency, b.amountCents, b.remainingCents]),
    [
      ['GBP', 250000, 240000],
      ['TRY', 11250000, 11250000],
      ['USD', 80000, 80000],
    ],
  );
  assert.equal(s.companies.find(c => c.id === 'elve').balances.length, 3);
  const filtered = await store.snapshot({ companyId: 'elve', currency: 'GBP' });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.invoices[0].currency, 'GBP');
  let h = await store.history(fx.id);
  await assert.rejects(() => store.update(owner, { ...h.invoice, currency: 'TRY' }), /para birimi/);
  await store.reverse(owner, { eventId: h.events[0].id, note: 'Reverse synthetic use' });
  h = await store.history(fx.id);
  await assert.rejects(() => store.update(owner, { ...h.invoice, currency: 'USD' }), /para birimi/);
});
test('document import requires explicit confirmation and stores only selected metadata', async t => {
  const { store, owner } = await fixture(t);
  const doc = {
    issuerName: 'Örnek Döviz',
    counterpartyName: 'Elve Ticaret',
    documentType: 'foreign_exchange',
    foreignAmountCents: 250000,
    foreignCurrency: 'GBP',
    exchangeRate: '45',
    tlAmountCents: 11250000,
    qrStatus: 'matched',
    privateQr: 'never store',
  };
  const body = {
    companyId: 'elve',
    number: 'QA-DOC-001',
    date: '2026-11-05',
    amountCents: 250000,
    currency: 'GBP',
    source: 'document',
    document: doc,
  };
  await assert.rejects(() => store.create(owner, body), /onaylanmalı/);
  assert.equal((await store.snapshot({})).total, 0);
  const { id } = await store.create(owner, { ...body, confirmed: true });
  const saved = (await store.history(id)).invoice;
  assert.equal(saved.document.foreignCurrency, 'GBP');
  assert.equal(saved.document.privateQr, undefined);
  assert.equal(saved.amountCents, 250000);
});
test('legacy database migration keeps TRY invoices, history and existing sessions', async t => {
  const { db, store, owner, token } = await fixture(t);
  const { id } = await store.create(owner, {
    companyId: 'tempo',
    number: 'QA-LEGACY',
    date: '2026-11-05',
    amountCents: 50000,
    usedCents: 12000,
  });
  await db.execute('ALTER TABLE invoice_records DROP COLUMN currency');
  await db.execute('ALTER TABLE invoice_records DROP COLUMN document_data');
  // A legacy database predates the schema marker.
  await db.execute('DROP TABLE invoice_meta');
  const upgraded = new InvoiceStore(db, 'test-secret-for-isolated-database-only-123456789');
  assert.equal((await upgraded.session(token)).id, owner.id);
  const h = await upgraded.history(id);
  assert.equal(h.invoice.currency, 'TRY');
  assert.equal(h.invoice.remainingCents, 38000);
  assert.equal(h.events.length, 1);
  await new InvoiceStore(db, 'test-secret-for-isolated-database-only-123456789').init();
  assert.equal((await upgraded.snapshot({})).total, 1);
});
const companies = INITIAL_COMPANIES.map(([id, name]) => ({ id, name }));
const fxRead = {
  documentType: 'foreign_exchange',
  issuerName: 'Elve Ticaret Limited Şirketi',
  counterpartyName: 'Örnek Döviz AŞ',
  number: 'QA2026000000123',
  date: '2026-11-05',
  foreignAmountCents: 250000,
  foreignCurrency: 'GBP',
  amountCents: 11250000,
  currency: 'TRY',
  tlAmountCents: 11250000,
  exchangeRate: '45',
};
const fxQr = {
  senaryo: 'EDOVIZBELGE',
  no: 'QA2026000000123',
  tarih: '2026-11-05',
  'miktari(GBP)': '2.500,00',
  uygulanankur: '45,000000',
  'odenecek(TRY)': '112.500,00',
};
test('FX source documents track issuer and FX quantity, independently cross-checked with QR', () => {
  const result = validateExtraction(fxRead, companies, [JSON.stringify(fxQr)]);
  assert.equal(result.companyId, 'elve');
  assert.equal(result.amountCents, 250000);
  assert.equal(result.currency, 'GBP');
  assert.equal(result.numberLabel, 'Belge No');
  assert.equal(result.document.qrStatus, 'matched');
  assert.equal(result.document.tlAmountCents, 11250000);
  const link = validateExtraction(fxRead, companies, ['https://example.invalid/document']);
  assert.equal(link.document.qrStatus, 'not_read');
  assert(link.warnings.some(w => w.includes('bağlantısı')));
  const partial = validateExtraction({ ...fxRead, number: null, foreignAmountCents: null }, companies, [
    JSON.stringify(fxQr),
  ]);
  assert.equal(partial.document.qrStatus, 'partial');
  assert.equal(partial.amountCents, 250000);
});
test('QR conflicts do not silently replace number, amount or date', () => {
  const result = validateExtraction(
    { ...fxRead, number: 'WRONG', foreignAmountCents: 250001, date: '2026-11-04' },
    companies,
    [JSON.stringify(fxQr)],
  );
  assert.equal(result.number, null);
  assert.equal(result.amountCents, null);
  assert.equal(result.date, null);
  assert.equal(result.document.qrStatus, 'conflict');
  const arithmetic = validateExtraction(fxRead, companies, [JSON.stringify({ ...fxQr, uygulanankur: '44' })]);
  assert.equal(arithmetic.amountCents, fxRead.foreignAmountCents);
  assert.equal(arithmetic.number, fxRead.number);
  assert.equal(arithmetic.document.qrStatus, 'partial');
  assert(arithmetic.warnings.some(w => w.includes('QR kuru')));
  const multi = validateExtraction(fxRead, companies, [JSON.stringify(fxQr), JSON.stringify({ ...fxQr, no: 'OTHER' })]);
  assert.equal(multi.document.qrStatus, 'conflict');
  assert.throws(
    () => validateExtraction({ ...fxRead, multipleDocuments: true }, companies, [JSON.stringify(fxQr)]),
    /tek bir belge/,
  );
  assert.throws(() => validateExtraction(fxRead, companies, [1]), /QR/);
});

test('one file returns independent mesnets with QR values matched only by document number', () => {
  const other = {
    ...fxRead,
    number: 'SECOND',
    issuerName: 'Albayrak',
    foreignAmountCents: 50000,
    foreignCurrency: 'USD',
  };
  const secondQr = { senaryo: 'EDOVIZBELGE', no: 'SECOND', tarih: '2026-11-05', 'miktari(USD)': '500,00' };
  const result = validateExtractions({ documents: [fxRead, other], hasMoreDocuments: false }, companies, [
    JSON.stringify(secondQr),
    JSON.stringify(fxQr),
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].amountCents, 250000);
  assert.equal(result[0].currency, 'GBP');
  assert.equal(result[0].companyId, 'elve');
  assert.equal(result[1].amountCents, 50000);
  assert.equal(result[1].currency, 'USD');
  assert.equal(result[1].companyId, 'albayrak');
  assert(result.every(row => row.document.qrStatus === 'matched'));
});

test('an unreadable mesnet stays in review and cannot inherit a neighboring QR', () => {
  const rows = validateExtractions({ documents: [fxRead, { number: null }], hasMoreDocuments: false }, companies, [
    JSON.stringify(fxQr),
  ]);
  assert.equal(rows[1].number, null);
  assert.equal(rows[1].amountCents, null);
  assert.equal(rows[1].companyId, null);
  assert.notEqual(rows[1].document.qrStatus, 'matched');
  assert.throws(() => validateExtractions({ documents: [fxRead], hasMoreDocuments: true }, companies), /tamamı/);
  assert.throws(() => validateExtractions({ documents: [], hasMoreDocuments: false }, companies), /1–10/);
  assert.throws(
    () => validateExtractions({ documents: Array(11).fill(fxRead), hasMoreDocuments: false }, companies),
    /1–10/,
  );
  assert.throws(
    () =>
      validateExtractions({ documents: [fxRead], hasMoreDocuments: false }, companies, [
        JSON.stringify(fxQr),
        JSON.stringify({ ...fxQr, no: 'MISSING' }),
      ]),
    /tümü/,
  );
});

test('upload reads the entire file even when its first QR already exists, preserving new receipts', async () => {
  const other = { ...fxRead, number: 'NEW', counterpartyName: 'Albayrak' };
  const result = await readUploadFixture({ documents: [fxRead, other], hasMoreDocuments: false }, [
    JSON.stringify(fxQr),
  ]);
  assert.equal(result.status, 200);
  assert.equal(result.calls.length, 1);
  assert.equal(result.body.documents.length, 2);
  assert.equal(result.body.documents[0].duplicates.length, 1);
  assert.equal(result.body.documents[1].duplicates.length, 0);
  assert.equal(result.body.documents[1].number, 'NEW');
  assert(result.calls[0].config.responseSchema.properties.documents.items);
});

test('single uploads keep their original response shape; truncated batches never become one QR-only invoice', async () => {
  const single = await readUploadFixture({ documents: [{ ...fxRead, number: 'NEW' }], hasMoreDocuments: false });
  assert.equal(single.status, 200);
  assert.equal(single.body.number, 'NEW');
  assert.equal('duplicates' in single.body, false);
  const incomplete = await readUploadFixture({ documents: [fxRead], hasMoreDocuments: true }, [JSON.stringify(fxQr)]);
  assert.equal(incomplete.status, 422);
  assert.equal(incomplete.body.number, undefined);
  const truncated = await readUploadFixture(
    { documents: [fxRead, { ...fxRead, number: 'NEW' }], hasMoreDocuments: false },
    [],
    'MAX_TOKENS',
  );
  assert.equal(truncated.status, 422);
  assert.equal(truncated.body.documents, undefined);
});

test('a retry cannot silently shrink a detected batch to a single receipt', async () => {
  const result = await readUploadFixture(
    attempt =>
      attempt === 1
        ? { documents: [fxRead, { ...fxRead, number: 'SECOND' }], hasMoreDocuments: true }
        : { documents: [fxRead], hasMoreDocuments: false },
    [JSON.stringify(fxQr)],
  );
  assert.equal(result.status, 422);
  assert.equal(result.body.number, undefined);
  assert.equal(result.body.documents, undefined);
});

test('cold QR library loading does not consume scan time or require animation frames', async t => {
  let clock = 0,
    reads = 0;
  const original = new Map(
    ['document', 'window', 'createImageBitmap', 'requestAnimationFrame'].map(k => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  t.after(() => {
    for (const [key, value] of original) {
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
    }
  });
  t.mock.method(performance, 'now', () => clock);
  const context = {
    drawImage() {},
    getImageData() {
      return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
    },
  };
  globalThis.document = {
    createElement(tag) {
      return tag === 'canvas' ? { width: 0, height: 0, getContext: () => context } : { remove() {} };
    },
    head: {
      append(script) {
        clock += 20000;
        queueMicrotask(() => script.onload());
      },
    },
  };
  globalThis.window = {
    ZXingWASM: {
      prepareZXingModule: async () => ({}),
      readBarcodes: async () => {
        reads++;
        return [{ text: 'synthetic-qr', isValid: true }];
      },
    },
  };
  globalThis.createImageBitmap = async () => ({ width: 100, height: 100, close() {} });
  globalThis.requestAnimationFrame = () => {
    throw new Error('Background tabs do not deliver animation frames');
  };
  const result = await readDocumentQr({ type: 'image/png', name: 'synthetic.png' });
  assert.equal(result.state, 'read');
  assert.deepEqual(result.codes, ['synthetic-qr']);
  assert(reads > 1);
});
test('a stalled QR dependency releases the document upload after a bounded wait', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window'),
    originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let preparing = false;
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else delete globalThis.window;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  });
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, remove() {} }),
    head: {
      append(script) {
        queueMicrotask(() => script.onload());
      },
    },
  };
  globalThis.window = {
    ZXingWASM: {
      prepareZXingModule: () => {
        preparing = true;
        return new Promise(() => {});
      },
    },
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = readDocumentQr({ type: 'image/png', name: 'synthetic.png' });
  await new Promise(setImmediate);
  assert(preparing);
  t.mock.timers.tick(30000);
  assert.deepEqual(await result, { codes: [], state: 'unavailable' });
});

const { readDocumentWithFallback, DocumentOutputError, readFailure } = loadTs(
  'src/features/invoices/document-reader.ts',
);
function readerFixture(call) {
  const calls = [],
    events = [],
    blocked = [];
  let reservations = 0;
  return {
    calls,
    events,
    blocked,
    get reservations() {
      return reservations;
    },
    options: {
      models: ['gemini-test-a', 'gemini-test-b', 'gemini-test-c'],
      signal: new AbortController().signal,
      call: async (model, signal) => {
        calls.push(model);
        return call(model, signal);
      },
      reserve: async () => {
        reservations++;
      },
      block: async (model, until) => {
        blocked.push({ model, until });
      },
      report: event => events.push(event),
    },
  };
}
test('document reads use a second model after transient failure and count each real attempt', async () => {
  const f = readerFixture(async model => {
    if (model.endsWith('-a')) throw Object.assign(new Error('private payload must not be logged'), { status: 503 });
    return { ready: true };
  });
  assert.deepEqual(await readDocumentWithFallback(f.options), { ready: true });
  assert.deepEqual(f.calls, ['gemini-test-a', 'gemini-test-b']);
  assert.equal(f.reservations, 2);
  assert.equal(f.events[0].outcome, 'unavailable');
  assert.equal(f.events[1].outcome, 'success');
  assert.equal(f.blocked.length, 1);
  assert(!JSON.stringify(f.events).includes('private payload'));
});
test('document provider failures stop after two attempts and preserve quota error type', async () => {
  const f = readerFixture(async () => {
    throw Object.assign(new Error('PerDay limit'), { status: 429 });
  });
  await assert.rejects(
    () => readDocumentWithFallback(f.options),
    e => e.status === 429 && e.message.includes('kullanım sınırına'),
  );
  assert.equal(f.calls.length, 2);
  assert.equal(f.reservations, 2);
  assert.equal(f.blocked.length, 2);
});
test('invalid keys and malformed document requests are not blindly retried', async () => {
  for (const status of [400, 401, 403]) {
    const f = readerFixture(async () => {
      throw Object.assign(new Error('provider error'), { status });
    });
    await assert.rejects(() => readDocumentWithFallback(f.options));
    assert.equal(f.calls.length, 1);
    assert.equal(f.blocked.length, 0);
  }
});
test('timeouts and invalid structured output can recover without retrying forever', async () => {
  for (const failure of [
    Object.assign(new Error('Timed out'), { name: 'TimeoutError' }),
    new DocumentOutputError('Truncated response'),
  ]) {
    const f = readerFixture(async model => {
      if (model.endsWith('-a')) throw failure;
      return 'ready';
    });
    assert.equal(await readDocumentWithFallback(f.options), 'ready');
    assert.equal(f.reservations, 2);
  }
  assert.equal(readFailure(Object.assign(new Error('fetch failed'), { status: 503 })).kind, 'unavailable');
});
test('cancelled reads and exhausted local budgets never issue another paid request', async () => {
  const f = readerFixture(async () => {
    throw new Error('Should never call');
  });
  const controller = new AbortController();
  controller.abort();
  f.options.signal = controller.signal;
  await assert.rejects(() => readDocumentWithFallback(f.options));
  assert.equal(f.reservations, 0);
  assert.equal(f.calls.length, 0);
  const b = readerFixture(async () => true);
  b.options.reserve = async () => {
    throw new Error('Daily budget exhausted');
  };
  await assert.rejects(() => readDocumentWithFallback(b.options), /Daily budget/);
  assert.equal(b.calls.length, 0);
});
test('QR-only recovery keeps company unselected and never claims independent agreement', () => {
  const { qrReviewAfterFailure } = loadTs('src/features/invoices/extraction.ts');
  const review = qrReviewAfterFailure(companies, [JSON.stringify(fxQr)]);
  assert.equal(review.companyId, null);
  assert.equal(review.companyName, null);
  assert.equal(review.number, fxQr.no);
  assert.equal(review.amountCents, 250000);
  assert.equal(review.currency, 'GBP');
  assert.equal(review.document.qrStatus, 'partial');
  assert(review.warnings.some(w => w.includes('firmayı belgeye bakarak seç')));
  assert.equal(qrReviewAfterFailure(companies, []), null);
  assert.equal(qrReviewAfterFailure(companies, [JSON.stringify({ ...fxQr, uygulanankur: '44' })]), null);
  assert.equal(qrReviewAfterFailure(companies, ['https://example.invalid/doc']), null);
});

test('printed document amounts convert exactly without model arithmetic and still cross-check QR', () => {
  for (const printed of ['2.500,00', '2,500.00', '2500.00', '2500,00', '2 500,00']) {
    const result = validateExtraction(
      { ...fxRead, foreignAmountCents: 2500, foreignAmountText: printed, tlAmountText: '112.500,00' },
      companies,
      [JSON.stringify(fxQr)],
    );
    assert.equal(result.amountCents, 250000);
    assert.equal(result.currency, 'GBP');
    assert.equal(result.document.qrStatus, 'matched');
  }
  const invoice = validateExtraction(
    { companyName: 'Çizgi Ticaret', number: 'SYNTHETIC', date: '2026-11-05', amountText: '1.250,75', currency: 'TRY' },
    companies,
  );
  assert.equal(invoice.amountCents, 125075);
  const noQr = validateExtraction({ ...fxRead, foreignAmountText: '2.500,75', tlAmountText: '112.533,75' }, companies);
  assert.equal(noQr.amountCents, 250075);
  assert.equal(noQr.document.tlAmountCents, 11253375);
  for (const printed of ['wrong', '-2.500,00', '2,500,00', '']) {
    const result = validateExtraction({ ...fxRead, foreignAmountText: printed }, companies);
    assert.equal(result.amountCents, null);
  }
  const conflict = validateExtraction({ ...fxRead, foreignAmountText: '25.000,00' }, companies, [JSON.stringify(fxQr)]);
  assert.equal(conflict.amountCents, null);
  assert.equal(conflict.document.qrStatus, 'conflict');
});

const sourcePdfText = `DÜZENLEYEN YETKİLİ ALBAYRAK DÖVİZ VE ALTIN YETKİLİ MÜESSESE A.Ş. ÖRNEK ADRES
SATAN KİŞİ/KURULUŞ ALİ YÜCE DÖVİZ A.Ş. ÖRNEK ADRES BELGE BİLGİLERİ
Belge No QA2026000000999 Oluşturma Tarihi 03-11-2026 Senaryo: EDOVIZBELGE Tip: ALIM
Döviz/Kıymetli Maden Miktarı 123.000,00 Döviz/Kıymetli Maden Cinsi EUR
Uygulanan Kur 55,768000 TL Karşılığı 6859464.00 TL NET TUTAR 6.859.464,00 TL`;
const sourceQr = {
  senaryo: 'EDOVIZBELGE',
  no: 'QA2026000000999',
  tarih: '2026-11-03',
  'miktari(EUR)': '123000',
  uygulanankur: '55,77',
  'odenecek(TRY)': '6859464.00',
};

test('rounded QR reference rates preserve issuer, identity and FX quantity with printed precision', () => {
  const { reviewPdfText } = loadTs('src/features/invoices/pdf-review.ts');
  const [result] = reviewPdfText([sourcePdfText], [JSON.stringify(sourceQr)], companies);
  assert.equal(result.companyId, 'albayrak');
  assert.equal(result.number, sourceQr.no);
  assert.equal(result.currency, 'EUR');
  assert.equal(result.amountCents, 12300000);
  assert.equal(result.document.exchangeRate, '55.768000');
  assert.equal(result.document.qrStatus, 'partial');
  assert(result.warnings.some(w => w.includes('yuvarlanmış')));
  const unknown = validateExtraction(
    { ...fxRead, issuerName: 'Bilinmeyen Döviz', counterpartyName: 'Albayrak' },
    companies,
  );
  assert.equal(unknown.companyId, null, 'never silently switches from unknown issuer to known other party');
  const unknownUnit = validateExtraction({ ...fxRead, foreignCurrency: 'TRY' }, companies);
  assert.equal(unknownUnit.currency, null, 'TRY countervalue is never an FX tracking currency');
  assert.equal(unknownUnit.amountCents, null);
});

test('fast PDF path refuses unknown layouts, partial files, additional QRs and conflicting visible amounts', () => {
  const { reviewPdfText } = loadTs('src/features/invoices/pdf-review.ts');
  const codes = [JSON.stringify(sourceQr)];
  for (const pages of [
    [],
    [sourcePdfText, ''],
    [sourcePdfText, 'unrecognized page'],
    [sourcePdfText + ' Belge No OTHER'],
    [sourcePdfText.replace('123.000,00', '124.000,00')],
    [sourcePdfText.replace('Cinsi EUR', 'Cinsi USD')],
    [sourcePdfText.replace('03-11-2026', '04-11-2026')],
  ]) {
    assert.equal(reviewPdfText(pages, codes, companies), null);
  }
  assert.equal(reviewPdfText([sourcePdfText], [], companies), null);
  assert.equal(
    reviewPdfText([sourcePdfText], [...codes, JSON.stringify({ ...sourceQr, no: 'OTHER' })], companies),
    null,
  );
  assert.equal(reviewPdfText([sourcePdfText], [JSON.stringify({ ...sourceQr, uygulanankur: '44' })], companies), null);
  assert.equal(reviewPdfText([sourcePdfText], codes, []), null);
  const nextText = sourcePdfText.replace(sourceQr.no, 'QA2026000000998');
  const nextCode = JSON.stringify({ ...sourceQr, no: 'QA2026000000998' });
  assert.equal(reviewPdfText([sourcePdfText, nextText], [nextCode, ...codes], companies).length, 2);
});

test('verified PDF and QR bypass the model and its quota; uncertain PDFs use the existing reader', async () => {
  const quick = await readUploadFixture(null, [JSON.stringify(sourceQr)], 'STOP', [sourcePdfText]);
  assert.equal(quick.status, 200);
  assert.equal(quick.body.companyId, 'albayrak');
  assert.equal(quick.body.currency, 'EUR');
  assert.equal(quick.calls.length, 0);
  assert.equal(quick.reservations, 0);
  const slow = await readUploadFixture({ documents: [fxRead], hasMoreDocuments: false }, [], 'STOP', [
    'unknown layout',
  ]);
  assert.equal(slow.status, 200);
  assert.equal(slow.calls.length, 1);
  assert.equal(slow.reservations, 2);
});

test('multi-file queue reads sequentially, keeps successes and reports individual failures', async () => {
  const { readUploadQueue } = loadTs('src/features/invoices/upload-queue.ts');
  const files = ['one.pdf', 'bad.pdf', 'three.pdf'].map(name => new File(['%PDF-fixture'], name));
  let active = 0,
    peak = 0;
  const visits = [];
  const queue = await readUploadQueue(
    files,
    async (file, index) => {
      active++;
      peak = Math.max(peak, active);
      visits.push(index);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      if (index === 1) throw new Error('Unreadable');
      return index === 0 ? ['first', 'second'] : ['third'];
    },
    () => false,
  );
  assert.equal(peak, 1);
  assert.deepEqual(visits, [0, 1, 2]);
  assert.deepEqual(
    queue.results.map(r => r.value),
    ['first', 'second', 'third'],
  );
  assert.deepEqual(
    queue.results.map(r => r.fileName),
    ['one.pdf', 'one.pdf', 'three.pdf'],
  );
  assert.deepEqual(queue.failures, ['bad.pdf: Unreadable']);
  const stopped = await readUploadQueue(
    files,
    async (_, index) => {
      if (index === 1) throw new Error('Session expired');
      assert.equal(index, 0);
      return ['kept'];
    },
    () => true,
  );
  assert.equal(stopped.results.length, 1);
  assert.equal(stopped.failures.length, 2);
  await assert.rejects(
    () =>
      readUploadQueue(
        Array(11).fill(files[0]),
        async () => [],
        () => false,
      ),
    /1–10/,
  );
});

test('new confirmed invoices consume the full amount automatically and preserve older balances', async t => {
  const { store, owner } = await fixture(t);
  const older = await store.create(owner, {
    companyId: 'tempo',
    number: 'QA-OLDER-OPEN',
    date: '2025-01-01',
    amountCents: 50000,
    usedCents: 10000,
  });
  const input = {
    companyId: 'elve',
    number: 'QA-FULL-001',
    date: '2025-02-01',
    amountCents: 250000,
    currency: 'GBP',
    source: 'document',
    usedCents: 0,
  };
  await assert.rejects(() => store.createFullyUsed(owner, input), /onaylanmalı/);
  const { id } = await store.createFullyUsed(owner, { ...input, confirmed: true });
  const h = await store.history(id);
  assert.equal(h.invoice.usedCents, 250000);
  assert.equal(h.invoice.remainingCents, 0);
  assert.equal(h.invoice.status, 'closed');
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].deltaCents, 250000);
  assert.equal(h.events[0].accountName, 'Test owner');
  assert(h.events[0].note.includes('tamamı kullanılmış'));
  const { todayInTurkey } = loadTs('src/features/invoices/model.ts');
  assert.equal(h.events[0].date, todayInTurkey());
  assert.equal((await store.history(older.id)).invoice.remainingCents, 40000);
  const manual = await store.createFullyUsed(owner, {
    companyId: 'cizgi',
    number: 'QA-MANUAL-001',
    date: '2026-11-05',
    amountCents: 125050,
    usedCents: 1,
  });
  assert.equal((await store.history(manual.id)).invoice.usedCents, 125050);
});
test('duplicate lookup finds exact normalized document numbers across companies', async t => {
  const { store, owner } = await fixture(t);
  const { id } = await store.createFullyUsed(owner, {
    companyId: 'elve',
    number: 'QA DUP 001',
    date: '2026-11-05',
    amountCents: 250000,
    currency: 'GBP',
  });
  const matches = await store.duplicates('qa dup001');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, id);
  assert.equal(matches[0].companyName, 'Elve');
  assert.equal(matches[0].usedCents, 250000);
  assert.deepEqual(await store.duplicates('QA DUP 00'), []);
  for (const companyId of ['elve', 'tempo'])
    await assert.rejects(
      () => store.createFullyUsed(owner, { companyId, number: 'qadup001', date: '2026-11-05', amountCents: 300000 }),
      e => e.status === 409 && e.message.includes('Elve'),
    );
  assert.equal((await store.snapshot({})).total, 1);
});
test('simultaneous submissions cannot record the same document under two firms', async t => {
  const { store, owner } = await fixture(t);
  const b = { number: 'QA-RACE-DOC', date: '2026-11-05', amountCents: 150000, currency: 'USD' };
  const results = await Promise.allSettled(
    ['elve', 'cizgi'].map(companyId => store.createFullyUsed(owner, { ...b, companyId })),
  );
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1);
  const s = await store.snapshot({});
  assert.equal(s.total, 1);
  assert.equal(s.invoices[0].remainingCents, 0);
  assert.equal((await store.history(s.invoices[0].id)).events.length, 1);
});

test('trusted devices keep logging in while outside failures trigger the global lockout', async t => {
  const { store } = await fixture(t);
  const trusted = await store.login('0123', 'office-ip');
  assert.match(trusted.deviceToken, /^[A-Za-z0-9_-]{43}$/);
  // Twenty failures from rotating addresses lock out unknown browsers everywhere.
  for (let n = 0; n < 20; n++)
    await assert.rejects(
      () => store.login('9999', `attacker-${n}`),
      e => e.status === 401,
    );
  await assert.rejects(
    () => store.login('0123', 'new-browser-ip'),
    e => e.status === 429,
  );
  assert.equal((await store.login('0123', 'office-ip', trusted.deviceToken)).account.id, 'owner');
  // A forged device token gets no exemption.
  await assert.rejects(
    () => store.login('0123', 'office-ip', 'x'.repeat(43)),
    e => e.status === 429,
  );
  // A trusted device still has its own failure limit.
  for (let n = 0; n < 5; n++)
    await assert.rejects(
      () => store.login('9999', 'office-ip', trusted.deviceToken),
      e => e.status === 401,
    );
  await assert.rejects(
    () => store.login('0123', 'office-ip', trusted.deviceToken),
    e => e.status === 429,
  );
});

test('idle sessions expire and active sessions slide forward', async t => {
  const { db, store, token } = await fixture(t);
  const soon = new Date(Date.now() + 3 * 86400000).toISOString();
  await db.execute({ sql: 'UPDATE invoice_sessions SET expires_at=?', args: [soon] });
  assert.equal((await store.session(token)).id, 'owner');
  const slid = String((await db.execute('SELECT expires_at FROM invoice_sessions')).rows[0].expires_at);
  assert(Date.parse(slid) > Date.now() + 13 * 86400000);
  await db.execute({
    sql: 'UPDATE invoice_sessions SET expires_at=?',
    args: [new Date(Date.now() - 1000).toISOString()],
  });
  assert.equal(await store.session(token), null);
});

test('QR agreement survives only with a server-signed reading of the same fields', async t => {
  const { store, owner } = await fixture(t);
  const document = {
    issuerName: 'Elve',
    counterpartyName: null,
    documentType: 'foreign_exchange',
    foreignAmountCents: 250000,
    foreignCurrency: 'GBP',
    exchangeRate: null,
    tlAmountCents: null,
    qrStatus: 'matched',
  };
  const reading = { number: 'QA-SIGNED-1', date: '2026-11-05', amountCents: 250000, currency: 'GBP', document };
  const proof = store.signReading(reading);
  assert.match(proof, /^\d+\./);
  const base = {
    companyId: 'elve',
    date: '2026-11-05',
    currency: 'GBP',
    source: 'document',
    confirmed: true,
    document,
  };
  const signed = await store.createFullyUsed(owner, { ...base, number: 'QA-SIGNED-1', amountCents: 250000, proof });
  assert.equal((await store.history(signed.id)).invoice.document.qrStatus, 'matched');
  const forged = await store.createFullyUsed(owner, { ...base, number: 'QA-FORGED-1', amountCents: 250000 });
  assert.equal((await store.history(forged.id)).invoice.document.qrStatus, 'partial');
  // A valid proof for different figures does not carry over.
  const swapped = await store.createFullyUsed(owner, { ...base, number: 'QA-SIGNED-2', amountCents: 999, proof });
  assert.equal((await store.history(swapped.id)).invoice.document.qrStatus, 'partial');
  assert.equal(store.signReading({ ...reading, document: { ...document, qrStatus: 'partial' } }), null);
});

test('invoice edits are attributed in an admin-only audit trail', async t => {
  const { store, owner } = await fixture(t);
  await store.addAccount(owner, { name: 'Colleague', code: '0042' });
  const member = (await store.login('0042', 'member-ip')).account;
  const { id } = await store.create(owner, {
    companyId: 'tempo',
    number: 'QA-AUDIT-1',
    date: '2026-11-05',
    amountCents: 50000,
  });
  const before = (await store.history(id)).invoice;
  await store.update(member, { ...before, amountCents: 70000 });
  const trail = await store.auditTrail(owner, id);
  assert.equal(trail.length, 1);
  assert.equal(trail[0].accountName, 'Colleague');
  assert.equal(trail[0].before.amountCents, 50000);
  assert.equal(trail[0].after.amountCents, 70000);
  await assert.rejects(
    () => store.auditTrail(member, id),
    e => e.status === 403,
  );
});

test('members cannot add firms or reverse another account usage', async t => {
  const { store, owner } = await fixture(t);
  await store.addAccount(owner, { name: 'Colleague', code: '0042' });
  const member = (await store.login('0042', 'member-ip')).account;
  await assert.rejects(
    () => store.addCompany(member, { name: 'Yeni Firma' }),
    e => e.status === 403,
  );
  await store.addCompany(owner, { name: 'Yeni Firma' });
  const day = { companyId: 'tempo', date: '2026-11-05', amountCents: 1000 };
  const ownerUse = await store.createFullyUsed(owner, { ...day, number: 'QA-REV-OWNER' });
  const memberUse = await store.createFullyUsed(member, { ...day, number: 'QA-REV-MEMBER' });
  const ownerEvent = (await store.history(ownerUse.id)).events[0].id;
  const memberEvent = (await store.history(memberUse.id)).events[0].id;
  await assert.rejects(
    () => store.reverse(member, { eventId: ownerEvent, note: 'Not mine' }),
    e => e.status === 403,
  );
  await store.reverse(member, { eventId: memberEvent, note: 'My own mistake' });
  await store.reverse(owner, { eventId: ownerEvent, note: 'Admin correction' });
});

test('company list and batched duplicate lookup avoid per-document queries', async t => {
  const { db, store, owner } = await fixture(t);
  assert.deepEqual(
    (await store.companies()).map(c => c.name),
    INITIAL_COMPANIES.map(([, name]) => name),
  );
  await store.createFullyUsed(owner, { companyId: 'elve', number: 'QA DUP 9', date: '2026-11-05', amountCents: 1 });
  const found = await store.duplicatesMany(['qa dup9', 'QA-NONE']);
  assert.equal(found.get('QADUP9').length, 1);
  assert.deepEqual(found.get('QA-NONE'), []);
  assert.equal(String((await db.execute("SELECT v FROM invoice_meta WHERE k='schema'")).rows[0].v), '3');
});

test('the next file is scanned locally while the current file is on the server', async () => {
  const { readUploadQueue } = loadTs('src/features/invoices/upload-queue.ts');
  const files = ['a.pdf', 'b.pdf', 'c.pdf'].map(name => new File(['%PDF-fixture'], name));
  const log = [];
  let reading = 0,
    peak = 0;
  const queue = await readUploadQueue(
    files,
    async (file, index, prepared) => {
      reading++;
      peak = Math.max(peak, reading);
      log.push(`read:${index}:${prepared}`);
      await new Promise(resolve => setTimeout(resolve, 5));
      log.push(`done:${index}`);
      reading--;
      return [file.name];
    },
    () => false,
    async (_, index) => {
      log.push(`prepare:${index}`);
      return `scan-${index}`;
    },
  );
  assert.equal(peak, 1);
  assert.deepEqual(
    queue.results.map(r => r.value),
    ['a.pdf', 'b.pdf', 'c.pdf'],
  );
  // The second file's scan starts while the first file is still being read.
  assert(log.indexOf('prepare:1') < log.indexOf('done:0'));
  assert.deepEqual(
    log.filter(l => l.startsWith('read')),
    ['read:0:scan-0', 'read:1:scan-1', 'read:2:scan-2'],
  );
});

test('a data-bearing QR found at moderate size skips the detailed high-resolution pass', async t => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'),
    originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'),
    originalBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  t.after(() => {
    for (const [key, value] of [
      ['window', originalWindow],
      ['document', originalDocument],
      ['createImageBitmap', originalBitmap],
    ])
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
  });
  const canvasSizes = [];
  let reads = 0;
  const context = {
    drawImage() {},
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  };
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') return { remove() {} };
      const canvas = { height: 0, getContext: () => context };
      let width = 0;
      Object.defineProperty(canvas, 'width', {
        get: () => width,
        set: value => {
          width = value;
          if (value) canvasSizes.push(value);
        },
      });
      return canvas;
    },
    head: { append: script => queueMicrotask(() => script.onload()) },
  };
  globalThis.window = {
    ZXingWASM: {
      prepareZXingModule: async () => ({}),
      readBarcodes: async () => {
        reads++;
        return [{ text: JSON.stringify({ no: 'QA2026000000999', tarih: '2026-11-05' }), isValid: true }];
      },
    },
  };
  globalThis.createImageBitmap = async () => ({ width: 8000, height: 6000, close() {} });
  const result = await readDocumentQr({ type: 'image/png', name: 'photo.png' });
  assert.equal(result.state, 'read');
  // Only the two quick regions are read; the 3200 px detailed draw and its 15 crops never happen.
  assert.equal(reads, 2);
  assert(!canvasSizes.includes(3200));
  assert(canvasSizes.includes(2400));
});
