/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');

function load(file, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(output, { module: loadedModule, exports: loadedModule.exports, require(id) {
    if (Object.hasOwn(imports, id)) return imports[id];
    throw new Error(`Unmocked dependency: ${id}`);
  } });
  return loadedModule.exports;
}

function mockNext() {
  return { NextResponse: { json(body, init = {}) { return { body, status: init.status ?? 200 }; } } };
}

function request(body, malformed = false) {
  return { json: async () => {
    if (malformed) throw new SyntaxError('bad json');
    return body;
  } };
}

function marketFixture() {
  const writes = [];
  const imports = { 'next/server': mockNext(), '@/services/market.service': {
    getUsdTryRate: async () => 32, setUsdTryRate: async value => writes.push(['usdtry', value]),
    getInterestRate: async () => 0.05, setInterestRate: async value => writes.push(['rate', value]),
  }, '@/lib/settings-validation': load('src/lib/settings-validation.ts') };
  return { writes, usdtry: load('src/app/api/settings/usdtry/route.ts', imports),
    rate: load('src/app/api/settings/rate/route.ts', imports) };
}

test('rate endpoints reject malformed bodies and invalid numeric values without writes', async () => {
  for (const [routeName, field] of [['usdtry', 'usdtry'], ['rate', 'rate']]) {
    for (const bad of [null, [], 'x', 3, {}, { [field]: null }, { [field]: true },
      { [field]: '' }, { [field]: '   ' }, { [field]: 'nope' }, { [field]: '0x10' }, { [field]: '0b10' }, { [field]: Infinity },
      { [field]: NaN }, ...(routeName === 'usdtry' ? [{ [field]: 0 }, { [field]: -1 }] : [{ [field]: -1 }])]) {
      const f = marketFixture();
      const result = await f[routeName].POST(request(bad));
      assert.equal(result.status, 400, `${routeName}: ${String(bad)}`);
      assert.equal(f.writes.length, 0);
    }
    const f = marketFixture();
    const result = await f[routeName].POST(request(undefined, true));
    assert.equal(result.status, 400);
    assert.equal(f.writes.length, 0);
  }
});

test('rate endpoints keep accepted numeric strings and zero interest', async () => {
  const f = marketFixture();
  assert.equal(JSON.stringify((await f.rate.POST(request({ rate: '0' }))).body), JSON.stringify({ ok: true, rate: 0 }));
  assert.equal(JSON.stringify((await f.usdtry.POST(request({ usdtry: '32.5' }))).body), JSON.stringify({ ok: true, usdtry: 32.5 }));
  assert.equal(JSON.stringify(f.writes), JSON.stringify([['rate', 0], ['usdtry', 32.5]]));
});

test('datasource rejects invalid bodies, fields, and source values without writes', async () => {
  const writes = [];
  const imports = { 'next/server': mockNext(), '@/services/cme.service': {
    getDataSource: async () => 'yahoo', setDataSource: async (...args) => writes.push(args),
    cmeSupported: () => true, loadCmeSurface: async () => null,
  }, '@/services/market.service': { loadSnapshot: async () => null },
  '@/lib/vol/surface': { PRODUCT_SURFACE_MAP: { XAU: 'GLD', XAG: 'SLV' } },
  '@/lib/settings-validation': load('src/lib/settings-validation.ts') };
  const route = load('src/app/api/settings/datasource/route.ts', imports);
  for (const bad of [null, [], 'x', 3, {}, { product: 'XAU' }, { source: 'yahoo' },
    { product: null, source: 'yahoo' }, { product: true, source: 'yahoo' },
    { product: 'XAU', source: null }, { product: 'XAU', source: true },
    { product: 'XAU', source: 'other' }, { product: 'OTHER', source: 'yahoo' }]) {
    const result = await route.POST(request(bad));
    assert.equal(result.status, 400, `${String(bad)}`);
    assert.equal(writes.length, 0);
  }
  assert.equal((await route.POST(request(undefined, true))).status, 400);
  assert.equal(writes.length, 0);
});

test('datasource preserves supported source values and uppercases product', async () => {
  const writes = [];
  const route = load('src/app/api/settings/datasource/route.ts', {
    'next/server': mockNext(), '@/services/cme.service': {
      getDataSource: async () => 'yahoo', setDataSource: async (...args) => writes.push(args),
      cmeSupported: () => true, loadCmeSurface: async () => null,
    }, '@/services/market.service': { loadSnapshot: async () => null },
    '@/lib/vol/surface': { PRODUCT_SURFACE_MAP: { XAU: 'GLD', XAG: 'SLV' } },
    '@/lib/settings-validation': load('src/lib/settings-validation.ts'),
  });
  const result = await route.POST(request({ product: 'xau', source: 'cme' }));
  assert.equal(JSON.stringify(result.body), JSON.stringify({ ok: true, product: 'XAU', source: 'cme' }));
  assert.equal(JSON.stringify(writes), JSON.stringify([['XAU', 'cme']]));
});
