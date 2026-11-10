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

async function readUploadFixture(payload, qrCodes = [], finishReason = 'STOP') {
  const calls = [];
  const existing = { id: 'existing', number: 'QA2026000000123' };
  const db = {
    snapshot: async () => ({ companies }),
    duplicates: async number => (number === existing.number ? [existing] : []),
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
      authenticated: async () => ({ db }),
      sameOrigin: () => {},
      json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
      errorResponse: error => new Response(JSON.stringify({ error: error.message }), { status: error.status || 500 }),
    },
    '@/features/invoices/model': loadTs('src/features/invoices/model.ts'),
    '@/features/invoices/extraction': loadTs('src/features/invoices/extraction.ts'),
    '@/features/invoices/qr-evidence': loadTs('src/features/invoices/qr-evidence.ts'),
    '@/features/invoices/document-reader': loadTs('src/features/invoices/document-reader.ts'),
    '@/lib/assistant/limits': {
      reserveModelCall: async () => {},
      reserveRequest: async () => {},
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
    const response = await mod.exports.POST(
      new Request('http://localhost/api/fatura/mesnet', { method: 'POST', body: form }),
    );
    return { status: response.status, body: await response.json(), calls };
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
  await assert.rejects(() => store.update({ ...h.invoice, currency: 'TRY' }), /para birimi/);
  await store.reverse(owner, { eventId: h.events[0].id, note: 'Reverse synthetic use' });
  h = await store.history(fx.id);
  await assert.rejects(() => store.update({ ...h.invoice, currency: 'USD' }), /para birimi/);
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
  issuerName: 'Örnek Döviz AŞ',
  counterpartyName: 'Elve Ticaret Limited Şirketi',
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
test('FX documents track customer and FX quantity, independently cross-checked with QR', () => {
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
  assert.equal(arithmetic.amountCents, null);
  assert.equal(arithmetic.number, null);
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
    counterpartyName: 'Albayrak',
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
