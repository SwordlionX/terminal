/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');

function load(file, imports = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(output, { module: loadedModule, exports: loadedModule.exports,
    require(id) {
      if (Object.hasOwn(imports, id)) return imports[id];
      throw new Error(`Unmocked dependency: ${id}`);
    }, ...globals });
  return loadedModule.exports;
}

test('spot cache marks fallback stale and preserves its original receipt time', async () => {
  let now = 1_000_000;
  let fail = false;
  const RealDate = Date;
  class TestDate extends RealDate { static now() { return now; } }
  const fetch = async () => {
    if (fail) throw new Error('provider unavailable');
    return { ok: true, json: async () => ({ price: '2050.25' }) };
  };
  const service = load('src/services/market.service.ts', {
    '@/lib/db': { dbc: async () => { throw new Error('unused'); } },
        './pricing-bundle.service': {}, '../lib/market/factors': load('src/lib/market/factors.ts'), '../lib/margin/config': load('src/lib/margin/config.ts'),
  }, { Date: TestDate, fetch, AbortSignal, console: { warn() {} }, process: { env: {} } });

  const first = await service.getSpot('XAU');
  assert.equal(first.price, 2050.25);
  assert.equal(first.at, 1_000_000);
  assert.equal(first.stale, false);
  now += 3 * 24 * 60 * 60 * 1000; // three-day-old data is retained, never relabelled fresh
  fail = true;
  const fallback = await service.getSpot('XAU');
  assert.equal(fallback.price, first.price);
  assert.equal(fallback.source, first.source);
  assert.equal(fallback.at, first.at);
  assert.equal(fallback.stale, true);
});

test('Tiingo quote time is kept separately from server receipt time', async () => {
  let now = 1_000_000;
  const RealDate = Date;
  class TestDate extends RealDate { static now() { return now; } }
  const fetch = async url => ({ ok: true, json: async () => url.includes('tiingo')
    ? [{ midPrice: 31.5, quoteTimestamp: '2026-10-02T08:30:00Z' }]
    : { price: '31.5' } });
  const service = load('src/services/market.service.ts', {
    '@/lib/db': { dbc: async () => { throw new Error('unused'); } },
        './pricing-bundle.service': {}, '../lib/market/factors': load('src/lib/market/factors.ts'), '../lib/margin/config': load('src/lib/margin/config.ts'),
  }, { Date: TestDate, fetch, AbortSignal, console: { warn() {} }, process: { env: {} } });
  const quote = await service.getSpot('XAG');
  assert.equal(quote.source, 'XAG/USD (Tiingo)');
  assert.equal(quote.at, now);
  assert.equal(quote.quoteAt, Date.parse('2026-10-02T08:30:00Z'));
});

test('market API returns the verified surface independently of a stale spot', async () => {
  const surface = { fetchedISO: '2026-10-01T17:30:00.000Z', curves: { id: 'bundle-123456789' }, expiries: [] };
  const route = load('src/app/api/market/route.ts', {
    'next/server': { NextResponse: { json: body => ({ body }) } },
    '@/services/market.service': {
      getSpot: async () => ({ price: 2000, at: 42, source: 'Tiingo', stale: true }),
      getSurface: async () => surface,
    },
  }, { URL });
  const result = await route.GET({ url: 'http://local/api/market?product=XAU' });
  assert.equal(result.body.surface, surface);
  assert.equal(result.body.surfaceSource, 'cme');
  assert.equal(result.body.snapshotISO, surface.fetchedISO);
  assert.equal(result.body.dataError, null);
  assert.equal(result.body.spot.stale, true);
});

test('feed merge retains stale same-product quotes and only same-source surfaces', () => {
  const { mergeMarketFeed, markMarketFeedUnavailable } = load('src/lib/market-feed-state.ts');
  const previous = { product: 'XAU', spot: { price: 100, at: 7, source: 'Tiingo' },
    surface: { id: 'old' }, surfaceSource: 'yahoo', snapshotISO: 'old time', rateNote: null,
    dataError: null, quoteError: null };
  const partial = mergeMarketFeed(previous, { ...previous, spot: null, surface: null,
    snapshotISO: null, dataError: 'surface read failed' });
  assert.equal(partial.spot.price, 100);
  assert.equal(partial.spot.at, 7);
  assert.equal(partial.spot.stale, true);
  assert.equal(partial.surface.id, 'old');
  assert.equal(partial.snapshotISO, 'old time');

  const switched = mergeMarketFeed(previous, { ...previous, surface: null, surfaceSource: 'cme' });
  assert.equal(switched.surface, null);
  const networkFailure = markMarketFeedUnavailable(previous, 'XAU', 'request failed');
  assert.equal(networkFailure.spot.stale, true);
  assert.equal(networkFailure.quoteError, 'request failed');
  assert.equal(markMarketFeedUnavailable(previous, 'XAG', 'request failed'), null);
});
