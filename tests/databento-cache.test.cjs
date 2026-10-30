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
async function client(t, fetch, extraEnv = {}, globals = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-databento-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const mod = { exports: {} };
  const env = { DATABENTO_CACHE_DIR: dir, DATABENTO_API_KEY: 'test-fixture', ...extraEnv };
  const compiled = ts.transpileModule(await fs.readFile('scripts/lib/databento-cache.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: mod,
    exports: mod.exports,
    require,
    process: { env },
    Buffer,
    URL,
    URLSearchParams,
    AbortSignal,
    Error,
    fetch,
    Date,
    setTimeout: fn => fn(), // retry backoff runs instantly in tests
    ...globals,
  });
  return { make: cacheOnly => new mod.exports.DatabentoCache(cacheOnly), dir, env };
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

test('dataset coverage metadata retries transient failures once without any paid request or budget entry', async t => {
  const end = '2026-10-13T04:00:00Z';
  for (const first of [503, 504, 429, 'timeout']) {
    let calls = 0;
    const c = await client(t, async url => {
      assert.equal(url.pathname, '/v0/metadata.get_dataset_range');
      calls++;
      if (calls === 1) {
        if (first === 'timeout') throw new DOMException('fixture-key must not leak', 'TimeoutError');
        return new Response('fixture-provider-body', { status: first });
      }
      return new Response(JSON.stringify({ schema: { statistics: { end } } }));
    });
    const cache = c.make(false);
    assert.equal(await cache.availableEnd(), end);
    assert.equal(calls, 2);
    assert.equal(cache.downloads, 0);
    assert.equal(cache.newReserveUsd, 0);
    assert.deepEqual(await fs.readdir(c.dir), []);
  }
});

test('metadata retries are bounded; auth and invalid responses stop immediately with safe endpoint diagnostics', async t => {
  for (const status of [401, 403, 503, 200, 'timeout']) {
    let calls = 0;
    const c = await client(t, async () => {
      calls++;
      if (status === 'timeout') throw new DOMException('fixture-secret', 'TimeoutError');
      return new Response('"fixture-secret"', { status });
    });
    await assert.rejects(
      c.make(false).availableEnd(),
      error => /metadata.get_dataset_range/.test(error.message) && !/fixture-secret|test-fixture/.test(error.message),
    );
    assert.equal(calls, status === 503 || status === 'timeout' ? 2 : 1);
    assert.deepEqual(await fs.readdir(c.dir), []);
  }
});

test('restored legacy lock cannot block an isolated runner or cause a second paid download', async t => {
  let calls = 0;
  const c = await client(
    t,
    async url => {
      calls++;
      return new Response(url.pathname.endsWith('get_cost') ? '0.001' : 'id,price\n1,2\n');
    },
    { GITHUB_ACTIONS: 'true' },
  );
  c.env.RUNNER_TEMP = path.join(c.dir, 'runner-one');
  const legacy = path.join(c.dir, 'budget.lock');
  await fs.writeFile(legacy, 'restored legacy lock');
  const first = await c.make(false).download(args);
  const before = await fs.readFile(path.join(c.dir, 'budget.json'), 'utf8');
  const lockDir = path.join(c.env.RUNNER_TEMP, 'terminal-x-databento-locks');
  assert.deepEqual(await fs.readdir(lockDir), []);
  // Simulate an abruptly killed former job: its runtime lock exists, but is never part of the cache.
  const hash = require('node:crypto').createHash('sha256').update(path.resolve(c.dir)).digest('hex');
  await fs.writeFile(path.join(lockDir, hash + '.lock'), 'orphaned old job');
  c.env.RUNNER_TEMP = path.join(c.dir, 'runner-two');
  const resumed = await c.make(true).download(args);
  assert.equal(resumed.cached, true);
  assert.equal(resumed.sha256, first.sha256);
  assert.equal(calls, 2);
  assert.equal(await fs.readFile(path.join(c.dir, 'budget.json'), 'utf8'), before);
  assert.equal(await fs.readFile(legacy, 'utf8'), 'restored legacy lock');
});

test('same-run concurrent readers cannot race a paid request and the owner releases its lock', async t => {
  let started,
    release,
    calls = 0;
  const entered = new Promise(resolve => {
    started = resolve;
  });
  const held = new Promise(resolve => {
    release = resolve;
  });
  const c = await client(
    t,
    async url => {
      calls++;
      if (url.pathname.endsWith('get_cost')) {
        started();
        await held;
        return new Response('0.001');
      }
      return new Response('id,price\n1,2\n');
    },
    { GITHUB_ACTIONS: 'true' },
  );
  c.env.RUNNER_TEMP = path.join(c.dir, 'runner');
  const first = c.make(false).download(args);
  await entered;
  await assert.rejects(c.make(false).download(args), /bütçe kilidi.*paralel indirme/);
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal((await c.make(true).download(args)).cached, true);
  assert.equal(calls, 2);
});

test('Actions requires an absolute runner temp path; local legacy locks still fail closed', async t => {
  const c = await client(
    t,
    () => {
      throw new Error('No network');
    },
    { GITHUB_ACTIONS: 'true' },
  );
  await assert.rejects(c.make(false).download(args), /geçici çalışma klasörü eksik/);
  c.env.RUNNER_TEMP = 'relative';
  await assert.rejects(c.make(false).download(args), /geçici çalışma klasörü eksik/);
  delete c.env.GITHUB_ACTIONS;
  await fs.writeFile(path.join(c.dir, 'budget.lock'), 'local active lock');
  await assert.rejects(c.make(false).download(args), /bütçe kilidi/);
  assert.equal(await fs.readFile(path.join(c.dir, 'budget.lock'), 'utf8'), 'local active lock');
});

test('body timeout aborts the stream, preserves failed cost reservations, and permits later recovery', async t => {
  const abort = new AbortController();
  let fail = true,
    ranges = 0;
  const c = await client(
    t,
    async url => {
      if (url.pathname.endsWith('get_cost')) return new Response('0.001');
      ranges++;
      if (!fail) return new Response('id,price\n1,2\n');
      // The mock ignores fetch's signal: pipeline itself must cancel this never-ending body.
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('partial'));
        },
      });
      setTimeout(() => abort.abort(), 15);
      return new Response(body);
    },
    {},
    { AbortSignal: { timeout: ms => (ms === 180000 && fail ? abort.signal : AbortSignal.timeout(ms)) } },
  );
  await assert.rejects(c.make(false).download(args), /aborted/i);
  const interrupted = JSON.parse(await fs.readFile(path.join(c.dir, 'budget.json'), 'utf8'));
  assert.equal(interrupted.requests.length, 2);
  assert.ok(interrupted.requests.every(r => r.status === 'failed' && r.reserveUsd > 0));
  await assert.rejects(fs.access(path.join(c.dir, 'budget.lock')), { code: 'ENOENT' });
  fail = false;
  assert.equal((await c.make(false).download(args)).cached, false);
  const resumed = JSON.parse(await fs.readFile(path.join(c.dir, 'budget.json'), 'utf8'));
  assert.equal(resumed.requests.length, 3);
  assert.equal(resumed.requests[2].status, 'complete');
  assert.equal(ranges, 3);
});

test('an interrupted multi-window job resumes completed chunks without paying for them again', async t => {
  const windowModule = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(await fs.readFile('scripts/lib/databento-windows.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { module: windowModule, exports: windowModule.exports, require, Error },
  );
  const { downloadWindowed } = windowModule.exports;
  const ranges = [];
  let interrupted = true;
  const c = await client(t, async url => {
    if (url.pathname.endsWith('get_cost')) return new Response('0.001');
    const start = url.searchParams.get('start');
    ranges.push(start);
    if (start.endsWith('T01:00:00Z') && interrupted) throw new Error('fixture interrupted job');
    return new Response('id,price\n1,2\n');
  });
  const window = { ...args, schema: 'statistics', end: '2026-10-01T02:00:00Z' };
  await assert.rejects(downloadWindowed(c.make(false), window), /fixture interrupted job/);
  interrupted = false;
  const result = await downloadWindowed(c.make(false), window);
  assert.equal(result.text, 'id,price\n1,2\n1,2\n');
  assert.equal(ranges.filter(start => start.endsWith('T00:00:00Z')).length, 1);
  assert.equal(ranges.filter(start => start.endsWith('T01:00:00Z')).length, 2);
  const ledger = JSON.parse(await fs.readFile(path.join(c.dir, 'budget.json'), 'utf8'));
  assert.equal(ledger.requests.length, 3);
  assert.equal(ledger.requests.filter(r => r.status === 'failed').length, 1);
  assert.equal(ledger.requests.filter(r => r.status === 'complete').length, 2);
});

test('recovering a legacy cache never resets the monthly budget or starts an over-budget paid request', async t => {
  const calls = [];
  const c = await client(
    t,
    async url => {
      calls.push(url.pathname);
      return new Response('0.001');
    },
    { GITHUB_ACTIONS: 'true' },
  );
  c.env.RUNNER_TEMP = path.join(c.dir, 'runner');
  const json = JSON.stringify({
    limitUsd: 10,
    requests: [
      {
        id: 'prior-interrupted-request',
        status: 'failed',
        reserveUsd: 10,
        estimateUsd: 1,
        requestedAt: new Date().toISOString(),
      },
    ],
  });
  await fs.writeFile(path.join(c.dir, 'budget.json'), json);
  await fs.writeFile(path.join(c.dir, 'budget.lock'), 'restored legacy lock');
  await assert.rejects(c.make(false).download(args), /bütçeyi aşacak/);
  assert.deepEqual(calls, ['/v0/metadata.get_cost']);
  assert.equal(await fs.readFile(path.join(c.dir, 'budget.json'), 'utf8'), json);
});

test('a fresh reservation restored by the next serialized CI job is retained and retried within budget', async t => {
  const c = await client(
    t,
    async url => new Response(url.pathname.endsWith('get_cost') ? '0.001' : 'id,price\n1,2\n'),
    { GITHUB_ACTIONS: 'true' },
  );
  c.env.RUNNER_TEMP = path.join(c.dir, 'new-runner');
  const id = require('node:crypto').createHash('sha256').update(JSON.stringify(args)).digest('hex');
  await fs.writeFile(
    path.join(c.dir, 'budget.json'),
    JSON.stringify({
      limitUsd: 10,
      requests: [
        {
          id,
          ...args,
          estimateUsd: 0.001,
          reserveUsd: 0.012,
          status: 'reserved',
          requestedAt: new Date().toISOString(),
        },
      ],
    }),
  );
  assert.equal((await c.make(false).download(args)).cached, false);
  const ledger = JSON.parse(await fs.readFile(path.join(c.dir, 'budget.json'), 'utf8'));
  assert.deepEqual(
    ledger.requests.map(r => r.status),
    ['failed', 'complete'],
  );
  assert.equal(ledger.requests[0].reserveUsd, 0.012);
});
