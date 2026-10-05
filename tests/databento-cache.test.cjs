/* eslint-disable @typescript-eslint/no-require-imports -- Read-only mocked provider/budget tests. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
const args = {
  dataset: 'GLBX.MDP3',
  start: '2026-10-01T00:00:00Z',
  end: '2026-10-01T00:15:00Z',
  stype_in: 'parent',
  symbols: 'GC.FUT,SI.FUT',
  schema: 'definition',
};
async function client(t, fetch) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-databento-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const mod = { exports: {} };
  const compiled = ts.transpileModule(await fs.readFile('scripts/lib/databento-cache.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: mod,
    exports: mod.exports,
    require,
    process: { env: { DATABENTO_CACHE_DIR: dir, DATABENTO_API_KEY: 'test-fixture' } },
    Buffer,
    URL,
    URLSearchParams,
    AbortSignal,
    fetch,
    Date,
    setTimeout: fn => fn(), // retry backoff runs instantly in tests
  });
  return { make: cacheOnly => new mod.exports.DatabentoCache(cacheOnly), dir };
}
test('cache-only cannot contact provider or create a paid reservation', async t => {
  const c = await client(t, () => {
    throw new Error('Unexpected network');
  });
  await assert.rejects(c.make(true).download(args), /ağ indirmesi kapalı/);
});
test('excessive cost estimate stops before the paid endpoint', async t => {
  const calls = [];
  const c = await client(t, async url => {
    calls.push(url.pathname);
    return new Response('1');
  });
  await assert.rejects(c.make(false).download(args), /bütçeyi aşacak/);
  assert.deepEqual(calls, ['/v0/metadata.get_cost']);
});
test('complete downloads are checksum-verified and reused without another request', async t => {
  let calls = 0;
  const c = await client(t, async url => {
    calls++;
    return new Response(url.pathname.endsWith('get_cost') ? '0.001' : 'test,csv\n1,2\n');
  });
  const first = await c.make(false).download(args);
  const second = await c.make(true).download(args);
  assert.equal(second.cached, true);
  assert.equal(second.sha256, first.sha256);
  assert.equal(calls, 2);
  const names = await fs.readdir(c.dir);
  await fs.writeFile(
    path.join(
      c.dir,
      names.find(x => x.endsWith('.csv')),
    ),
    'tampered',
  );
  await assert.rejects(c.make(true).download(args), /Önbellek doğrulanamadı/);
});
test('failed downloads stay counted and retry once; a later run may try again', async t => {
  let calls = 0;
  const c = await client(t, async url => {
    calls++;
    return url.pathname.endsWith('get_cost') ? new Response('0.001') : new Response('error', { status: 503 });
  });
  await assert.rejects(c.make(false).download(args), /HTTP 503/);
  assert.equal(calls, 4); // cost + range, then one in-run retry
  let ledger = JSON.parse(await fs.readFile(path.join(c.dir, 'budget.json'), 'utf8'));
  assert.equal(JSON.stringify(ledger.requests.map(r => r.status)), JSON.stringify(['failed', 'failed']));
  assert.ok(ledger.requests.every(r => r.reserveUsd > 0));
  await assert.rejects(c.make(false).download(args), /HTTP 503/);
  assert.equal(calls, 8);
  ledger = JSON.parse(await fs.readFile(path.join(c.dir, 'budget.json'), 'utf8'));
  assert.equal(ledger.requests.length, 4);
});
test('a fresh reservation from another run blocks; a stale one is retried', async t => {
  let calls = 0;
  const c = await client(t, async url => {
    calls++;
    return new Response(url.pathname.endsWith('get_cost') ? '0.001' : 'test,csv\n1,2\n');
  });
  const id = require('node:crypto').createHash('sha256').update(JSON.stringify(args)).digest('hex');
  const write = requestedAt =>
    fs.writeFile(
      path.join(c.dir, 'budget.json'),
      JSON.stringify({
        limitUsd: 10,
        requests: [{ id, ...args, estimateUsd: 0.001, reserveUsd: 0.012, status: 'reserved', requestedAt }],
      }),
    );
  await write(new Date().toISOString());
  await assert.rejects(c.make(false).download(args), /başka bir çalışmada sürüyor/);
  assert.equal(calls, 0);
  await write(new Date(Date.now() - 3600000).toISOString());
  const result = await c.make(false).download(args);
  assert.equal(result.cached, false);
  const ledger = JSON.parse(await fs.readFile(path.join(c.dir, 'budget.json'), 'utf8'));
  assert.equal(JSON.stringify(ledger.requests.map(r => r.status)), JSON.stringify(['failed', 'complete']));
});
test('provider warning rejects both the new download and its cached copy', async t => {
  const c = await client(t, async url =>
    url.pathname.endsWith('get_cost')
      ? new Response('0')
      : new Response('csv', { headers: { 'x-databento-warning': 'partial symbols' } }),
  );
  await assert.rejects(c.make(false).download(args), /veri uyarısı/);
  await assert.rejects(c.make(true).download(args), /Önbellek doğrulanamadı/);
});
