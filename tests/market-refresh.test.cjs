/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');

function load(file, globals = {}, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(output, { module: loadedModule, exports: loadedModule.exports, require(id) {
    if (Object.hasOwn(imports, id)) return imports[id];
    if (id === 'node:crypto') return { randomUUID: () => 'a8e3b7d4-7a12-4c90-8d31-eeb243039dcc' };
    throw new Error(`Unmocked dependency: ${id}`);
  }, AbortController, DOMException, setTimeout, clearTimeout, ...globals });
  return loadedModule.exports;
}

function response(body, ok = true) { return { ok, json: async () => body }; }

test('CME helper polls one request until completed and reports intermediate run states', async () => {
  const { refreshCme } = load('src/lib/market-refresh.ts');
  const seen = [];
  const statuses = [];
  let polls = 0;
  const fetcher = async (url, init) => {
    seen.push([url, init]);
    if (init?.method === 'POST') return response({ ok: true, request_id: 'request-1' });
    polls += 1;
    if (polls === 1) return response({ ok: true, status: 'notfound' });
    if (polls === 2) return response({ ok: true, status: 'queued' });
    if (polls === 3) return response({ ok: true, status: 'running' });
    return response({ ok: true, status: 'completed' });
  };
  const result = await refreshCme('XAU', { fetcher, wait: async ms => seen.push(ms), onStatus: status => statuses.push(status) });
  assert.equal(result, 'completed');
  assert.match(seen[0][0], /product=XAU/);
  assert.match(seen[1][0], /status\?product=XAU&request_id=request-1/);
  assert.deepEqual(statuses, ['notfound', 'queued', 'running', 'completed']);
});

test('CME helper treats persistent notfound as pending until the overall timeout', async () => {
  const { refreshCme } = load('src/lib/market-refresh.ts');
  const waiting = async (_url, init) => init?.method === 'POST'
    ? response({ ok: true, request_id: 'request-2' }) : response({ ok: true, status: 'notfound' });
  let clock = 0;
  assert.equal(await refreshCme('XAU', {
    fetcher: waiting, timeoutMs: 36, pollMs: 12, now: () => clock,
    wait: async ms => { clock += ms; },
  }), 'timeout');
});

test('CME helper reports failure and per-request timeout remains bounded', async () => {
  const { refreshCme } = load('src/lib/market-refresh.ts');
  const failed = async (_url, init) => init?.method === 'POST'
    ? response({ ok: true, request_id: 'request-3' }) : response({ ok: true, status: 'failed' });
  assert.equal(await refreshCme('XAG', { fetcher: failed }), 'failed');
  const hanging = async () => new Promise(() => {});
  await assert.rejects(refreshCme('XAG', { fetcher: hanging, requestTimeoutMs: 5 }), /zaman aşımına uğradı/);
});

test('CME helper preserves external abort during polling delay and an unresponsive fetch', async () => {
  const { refreshCme } = load('src/lib/market-refresh.ts');
  const controller = new AbortController();
  let beginWait;
  const waitStarted = new Promise(resolve => { beginWait = resolve; });
  const delayed = async (_url, init) => init?.method === 'POST'
    ? response({ ok: true, request_id: 'request-abort-delay' }) : response({ ok: true, status: 'running' });
  const waitingTask = refreshCme('XAU', {
    fetcher: delayed, signal: controller.signal,
    wait: () => { beginWait(); return new Promise(() => {}); },
  });
  await waitStarted;
  controller.abort();
  await assert.rejects(waitingTask, error => error.name === 'AbortError');

  const hangingController = new AbortController();
  let beginFetch;
  const fetchStarted = new Promise(resolve => { beginFetch = resolve; });
  const unresponsive = async (_url, init) => {
    if (init?.method === 'POST') return response({ ok: true, request_id: 'request-abort-fetch' });
    beginFetch();
    return new Promise(() => {});
  };
  const fetchTask = refreshCme('XAG', { fetcher: unresponsive, signal: hangingController.signal });
  await fetchStarted;
  hangingController.abort();
  await assert.rejects(fetchTask, error => error.name === 'AbortError');
});

test('CME helper rejects invalid product before dispatch', async () => {
  const { refreshCme } = load('src/lib/market-refresh.ts');
  let called = false;
  await assert.rejects(refreshCme('BTC', { fetcher: async () => { called = true; } }), /XAU veya XAG/);
  assert.equal(called, false);
});

test('CME dispatch blocks preview and missing PAT responses never reveal credentials', async () => {
  const NextResponse = { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) };
  const routeFile = 'src/app/api/market/refresh/cme/route.ts';
  let env = { VERCEL_ENV: 'preview', GITHUB_PAT: 'secret-pat-value' };
  let dispatchCount = 0;
  const route = load(routeFile, { process: { env }, fetch: async () => { dispatchCount += 1; return { ok: true }; }, URL }, {
    'next/server': { NextRequest: class {}, NextResponse }, '@/services/cme.service': { getDataSource: async () => 'cme' },
  });
  const req = { url: 'https://app.test/api/market/refresh/cme?product=XAU' };
  const preview = await route.POST(req);
  assert.equal(preview.status, 409);
  assert.equal(dispatchCount, 0);
  assert.doesNotMatch(JSON.stringify(preview), /secret-pat-value/);

  env = {};
  const missingTokenRoute = load(routeFile, { fetch: async () => { dispatchCount += 1; return { ok: true }; }, process: { env }, URL }, {
    'next/server': { NextRequest: class {}, NextResponse }, '@/services/cme.service': { getDataSource: async () => 'cme' },
  });
  const missingToken = await missingTokenRoute.POST(req);
  assert.equal(missingToken.status, 503);
  assert.doesNotMatch(JSON.stringify(missingToken), /PAT|secret/i);
  assert.equal(dispatchCount, 0);
});

test('CME dispatch validates products before any GitHub request', async () => {
  const NextResponse = { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) };
  let dispatchCount = 0;
  const { POST } = load('src/app/api/market/refresh/cme/route.ts', {
    fetch: async () => { dispatchCount += 1; return { ok: true }; },
    process: { env: { GITHUB_PAT: 'test', VERCEL_ENV: 'production' } },
    URL,
  }, { 'next/server': { NextRequest: class {}, NextResponse }, '@/services/cme.service': { getDataSource: async () => 'cme' } });
  const invalid = await POST({ url: 'https://app.test/api/market/refresh/cme?product=BTC' });
  assert.equal(invalid.status, 400);
  assert.equal(dispatchCount, 0);
});

test('production CME POST dispatches the exact workflow ref and product, returning queued only', async () => {
  const NextResponse = { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) };
  const timeoutSignal = { marker: 'timeout-signal' };
  const timeoutValues = [];
  class TestAbortSignal { static timeout(ms) { timeoutValues.push(ms); return timeoutSignal; } }
  let captured;
  const { POST } = load('src/app/api/market/refresh/cme/route.ts', {
    URL,
    AbortSignal: TestAbortSignal,
    process: { env: { GITHUB_PAT: 'private-token', VERCEL_ENV: 'production', CME_REFRESH_REF: 'main' } },
    fetch: async (url, options) => { captured = { url, options }; return { ok: true }; },
  }, { 'next/server': { NextRequest: class {}, NextResponse }, '@/services/cme.service': { getDataSource: async () => 'cme' } });
  const result = await POST({ url: 'https://app.test/api/market/refresh/cme?product=XAG' });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'queued');
  assert.equal(result.body.request_id, 'a8e3b7d4-7a12-4c90-8d31-eeb243039dcc');
  assert.equal(captured.url, 'https://api.github.com/repos/SwordlionX/terminal/actions/workflows/cme-refresh.yml/dispatches');
  assert.deepEqual(JSON.parse(captured.options.body), {
    ref: 'main', inputs: { product: 'XAG', request_id: 'a8e3b7d4-7a12-4c90-8d31-eeb243039dcc' },
  });
  assert.equal(captured.options.signal, timeoutSignal);
  assert.deepEqual(timeoutValues, [10_000]);
  assert.doesNotMatch(JSON.stringify(result), /private-token/);
});

test('CME POST sanitizes GitHub rejection and network errors', async () => {
  const NextResponse = { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) };
  const makePost = fetch => load('src/app/api/market/refresh/cme/route.ts', {
    URL, AbortSignal,
    process: { env: { GITHUB_PAT: 'private-token', VERCEL_ENV: 'production' } }, fetch,
  }, { 'next/server': { NextRequest: class {}, NextResponse }, '@/services/cme.service': { getDataSource: async () => 'cme' } }).POST;
  const req = { url: 'https://app.test/api/market/refresh/cme?product=XAU' };
  const rejected = await makePost(async () => ({ ok: false, statusText: 'private-token leaked by GitHub' }))(req);
  assert.equal(rejected.status, 502);
  assert.doesNotMatch(JSON.stringify(rejected), /private-token|statusText|leaked by GitHub/);
  const networkError = await makePost(async () => { throw new Error('private-token transport detail'); })(req);
  assert.equal(networkError.status, 502);
  assert.doesNotMatch(JSON.stringify(networkError), /private-token|transport detail/);
});

test('CME cron keeps authorization checks and only dispatches with the configured secret', async () => {
  const NextResponse = { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) };
  let dispatchCount = 0;
  const { GET } = load('src/app/api/market/refresh/cme/route.ts', {
    URL, AbortSignal,
    process: { env: { CRON_SECRET: 'cron-secret', GITHUB_PAT: 'private-token', VERCEL_ENV: 'production' } },
    fetch: async () => { dispatchCount += 1; return { ok: true }; },
  }, { 'next/server': { NextRequest: class {}, NextResponse }, '@/services/cme.service': { getDataSource: async () => 'cme' } });
  const url = 'https://app.test/api/market/refresh/cme?product=XAU';
  const denied = await GET({ url, headers: new Headers() });
  assert.equal(denied.status, 401);
  assert.equal(dispatchCount, 0);
  const allowed = await GET({ url, headers: new Headers({ authorization: 'Bearer cron-secret' }) });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.dispatched, true);
  assert.equal(dispatchCount, 1);
});

test('CME cron rejects preview dispatches and explicitly invalid products', async () => {
  const NextResponse = { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) };
  let dispatchCount = 0;
  const loadRoute = env => load('src/app/api/market/refresh/cme/route.ts', {
    fetch: async () => { dispatchCount += 1; return { ok: true }; }, process: { env }, URL,
    AbortSignal,
  }, { 'next/server': { NextRequest: class {}, NextResponse }, '@/services/cme.service': { getDataSource: async () => 'cme' } });
  const invalidRoute = loadRoute({ GITHUB_PAT: 'token', VERCEL_ENV: 'production' });
  const invalid = await invalidRoute.GET({ url: 'https://app.test/api/market/refresh/cme?product=BTC', headers: new Headers() });
  assert.equal(invalid.status, 400);
  const previewRoute = loadRoute({ GITHUB_PAT: 'token', VERCEL_ENV: 'preview' });
  const preview = await previewRoute.GET({ url: 'https://app.test/api/market/refresh/cme?product=XAU', headers: new Headers() });
  assert.equal(preview.status, 409);
  assert.equal(dispatchCount, 0);
});

test('status lookup filters workflow dispatches by exact request id and returns minimal state', async () => {
  const NextResponse = { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) };
  let url;
  const { GET } = load('src/app/api/market/refresh/cme/status/route.ts', {
    URL, AbortSignal,
    process: { env: { GITHUB_PAT: 'test-token' } },
    fetch: async (requestedUrl, options) => {
      url = requestedUrl;
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal);
      return { ok: true, json: async () => ({ workflow_runs: [
        { display_title: 'another-request', status: 'completed', conclusion: 'success' },
        { display_title: 'a8e3b7d4-7a12-4c90-8d31-eeb243039dcc', status: 'completed', conclusion: 'failure', run_number: 123 },
      ] }) };
    },
  }, { 'next/server': { NextResponse } });
  const result = await GET({ url: 'https://app.test/api/market/refresh/cme/status?product=XAG&request_id=a8e3b7d4-7a12-4c90-8d31-eeb243039dcc' });
  assert.match(url, /event=workflow_dispatch/);
  assert.equal(JSON.stringify(result.body), JSON.stringify({ ok: true, status: 'failed', request_id: 'a8e3b7d4-7a12-4c90-8d31-eeb243039dcc' }));
});

test('status maps waiting and pending to queued, and canceled/skipped to failed', async () => {
  const NextResponse = { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) };
  const id = 'a8e3b7d4-7a12-4c90-8d31-eeb243039dcc';
  for (const [runStatus, conclusion, expected] of [
    ['waiting', null, 'queued'], ['pending', null, 'queued'],
    ['completed', 'cancelled', 'failed'], ['completed', 'skipped', 'failed'],
  ]) {
    const { GET } = load('src/app/api/market/refresh/cme/status/route.ts', {
      URL, AbortSignal, process: { env: { GITHUB_PAT: 'test-token' } },
      fetch: async () => ({ ok: true, json: async () => ({ workflow_runs: [{ display_title: id, status: runStatus, conclusion }] }) }),
    }, { 'next/server': { NextResponse } });
    const result = await GET({ url: `https://app.test/api/market/refresh/cme/status?product=XAU&request_id=${id}` });
    assert.equal(result.body.status, expected);
  }
});

test('status lookup rejects invalid product or request id without GitHub access', async () => {
  const NextResponse = { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) };
  let called = false;
  const { GET } = load('src/app/api/market/refresh/cme/status/route.ts', {
    URL, process: { env: { GITHUB_PAT: 'test-token' } }, fetch: async () => { called = true; },
  }, { 'next/server': { NextResponse } });
  const result = await GET({ url: 'https://app.test/api/market/refresh/cme/status?product=BTC&request_id=nope' });
  assert.equal(result.status, 400);
  assert.equal(called, false);
});
