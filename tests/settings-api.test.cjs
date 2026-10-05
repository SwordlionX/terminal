/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');

function load(file, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(output, {
    module: loadedModule,
    exports: loadedModule.exports,
    require(id) {
      if (Object.hasOwn(imports, id)) return imports[id];
      throw new Error(`Unmocked dependency: ${id}`);
    },
  });
  return loadedModule.exports;
}

function mockNext() {
  return {
    NextResponse: {
      json(body, init = {}) {
        return { body, status: init.status ?? 200 };
      },
    },
  };
}

function request(body, malformed = false) {
  return {
    json: async () => {
      if (malformed) throw new SyntaxError('bad json');
      return body;
    },
  };
}

function marketFixture() {
  const writes = [];
  const imports = {
    'next/server': mockNext(),
    '@/services/market.service': {
      getInterestRate: async () => 0.05,
      setInterestRate: async value => writes.push(['rate', value]),
    },
    '@/lib/settings-validation': load('src/lib/settings-validation.ts'),
  };
  return { writes, rate: load('src/app/api/settings/rate/route.ts', imports) };
}

test('rate endpoints reject malformed bodies and invalid numeric values without writes', async () => {
  for (const [routeName, field] of [['rate', 'rate']]) {
    for (const bad of [
      null,
      [],
      'x',
      3,
      {},
      { [field]: null },
      { [field]: true },
      { [field]: '' },
      { [field]: '   ' },
      { [field]: 'nope' },
      { [field]: '0x10' },
      { [field]: '0b10' },
      { [field]: Infinity },
      { [field]: NaN },
      { [field]: -1 },
    ]) {
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

test('even a valid manual interest rate cannot replace the curve', async () => {
  const f = marketFixture();
  assert.equal((await f.rate.POST(request({ rate: '0' }))).status, 409);
  assert.equal(f.writes.length, 0);
});

test('datasource status reports the active CME/SOFR bundle and the last scheduled check', async () => {
  const surface = {
    fetchedISO: '2026-10-01T17:30:00.000Z',
    expiries: [1, 2],
    curves: { id: 'bundle-1' },
    notes: 'filtered',
  };
  const route = load('src/app/api/settings/datasource/route.ts', {
    'next/server': mockNext(),
    '@/services/pricing-bundle.service': {
      loadPricingBundle: async () => ({
        sessionDate: '2026-10-01',
        surfaces: { XAU: surface, XAG: surface },
        usd: {
          asOfDate: '2026-10-01',
          warnings: ['Endikatif SOFR futures proxy; sabit uyarı.', 'SR1 finali gelmedi; 2026-09-30 kullanıldı.'],
        },
        inputs: { curveRawHash: 'h', sofrSession: '2026-09-30', degraded: true },
      }),
    },
    '@/lib/db': {
      dbc: async () => ({
        execute: async ({ args }) => {
          assert.equal(args[0], 'pricing_refresh_status');
          return { rows: [{ v: JSON.stringify({ at: '2026-10-02T05:20:00Z', result: 'updated', message: 'ok' }) }] };
        },
      }),
    },
  });
  const result = await route.GET();
  assert.equal(result.body.refresh.result, 'updated');
  assert.equal(
    JSON.stringify(result.body.usd),
    JSON.stringify({
      sessionDate: '2026-10-01',
      sofrSession: '2026-09-30',
      degraded: true,
      warnings: ['SR1 finali gelmedi; 2026-09-30 kullanıldı.'],
    }),
  );
  assert.equal(
    JSON.stringify(result.body.items.map(i => [i.product, i.expiries, i.bundleId, i.notes])),
    JSON.stringify([
      ['XAU', 2, 'bundle-1', 'filtered'],
      ['XAG', 2, 'bundle-1', 'filtered'],
    ]),
  );
  assert.equal(route.POST, undefined);
});
