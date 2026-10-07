/* eslint-disable @typescript-eslint/no-require-imports -- Mocked provider window/atomicity regression. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
const mod = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync('scripts/lib/databento-windows.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { module: mod, exports: mod.exports, require, Error },
);
const { downloadWindowed } = mod.exports;
const args = {
  dataset: 'GLBX.MDP3',
  schema: 'statistics',
  stype_in: 'parent',
  symbols: 'OG.OPT',
  start: '2026-10-05T23:00:00Z',
  end: '2026-10-06T01:15:00Z',
};
const missing = () => {
  throw new Error('İstenen veri önbellekte yok; ağ indirmesi kapalı');
};

test('complete legacy cache is reused without new paid windows', async () => {
  let calls = 0;
  const original = { text: 'id,price\n1,2\n', sha256: 'existing', cached: true };
  const result = await downloadWindowed(
    {
      download: async (request, cachedOnly) => {
        calls++;
        assert.equal(cachedOnly, true);
        assert.equal(request, args);
        return original;
      },
    },
    args,
  );
  assert.equal(result, original);
  assert.equal(calls, 1);
});

test('hourly half-open slices cover the entire publication window in order across midnight', async () => {
  const requests = [];
  const result = await downloadWindowed(
    {
      download: async (request, cachedOnly) => {
        if (cachedOnly) return missing();
        requests.push(request);
        return { text: `id,price\r\n${requests.length},${requests.length * 10}\r\n`, cached: requests.length !== 2 };
      },
    },
    args,
  );
  assert.equal(
    JSON.stringify(requests.map(r => [r.start, r.end])),
    JSON.stringify([
      ['2026-10-05T23:00:00Z', '2026-10-06T00:00:00Z'],
      ['2026-10-06T00:00:00Z', '2026-10-06T01:00:00Z'],
      ['2026-10-06T01:00:00Z', '2026-10-06T01:15:00Z'],
    ]),
  );
  assert.equal(result.text, 'id,price\n1,10\n2,20\n3,30\n');
  assert.equal(result.cached, false);
  assert.equal(result.sha256, require('node:crypto').createHash('sha256').update(result.text).digest('hex'));
});

test('empty header-only windows preserve coverage; mismatched schemas or failed chunks return no partial result', async () => {
  const make = fail => ({
    download: async (request, cachedOnly) => {
      if (cachedOnly) return missing();
      if (request.start.includes('T00:00') && fail) {
        if (fail === 'http') throw new Error('indirme HTTP 504');
        return { text: 'different,header\n', cached: true };
      }
      return { text: 'id,price\n', cached: true };
    },
  });
  assert.equal((await downloadWindowed(make(), args)).text, 'id,price\n');
  await assert.rejects(downloadWindowed(make('http'), args), /statistics 2026-10-06T00:00:00Z.*HTTP 504/);
  await assert.rejects(downloadWindowed(make('schema'), args), /CSV alanları uyuşmuyor/);
});

test('corrupt or reserved original cache is never bypassed with another paid download', async () => {
  let calls = 0;
  await assert.rejects(
    downloadWindowed(
      {
        download: async () => {
          calls++;
          throw new Error('Önbellek doğrulanamadı');
        },
      },
      args,
    ),
    /Önbellek doğrulanamadı/,
  );
  assert.equal(calls, 1);
});
