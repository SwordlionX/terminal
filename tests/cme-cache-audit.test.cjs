/* eslint-disable @typescript-eslint/no-require-imports -- Offline audit with an in-memory filesystem. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const ts = require('typescript');
const test = require('node:test');
function load(file, imports = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText,
    {
      module: mod,
      exports: mod.exports,
      require: name => {
        if (Object.hasOwn(imports, name)) return imports[name];
        throw new Error('Unexpected dependency: ' + name);
      },
      fetch: () => {
        throw new Error('Unexpected network');
      },
      process: {
        env: new Proxy(
          {},
          {
            get: () => {
              throw new Error('Unexpected env access');
            },
          },
        ),
      },
    },
  );
  return mod.exports;
}
const carry = load('src/lib/market/cme-carry.ts');
const scope = load('src/lib/market/cme-option-scope.ts');
const options = load('src/lib/market/cme-option-inputs.ts', { './cme-carry': carry, './cme-option-scope': scope });
const ns = value => String(BigInt(Date.parse(value)) * 1000000n);
const date = '2026-10-12',
  dir = path.resolve('synthetic-audit-not-on-disk');
const defHeader = 'instrument_id,instrument_class,expiration,strike_price,underlying_id,security_update_action,ts_recv';
const statHeader = 'instrument_id,stat_type,price,ts_ref,ts_recv,ts_event,stat_flags,update_action';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const definition = (id, cls = 'C', action = 'A') =>
  [id, cls, ns(date + 'T18:30:00Z'), '100000000000', '77', action, ns(date + 'T00:00:00Z')].join(',');
const statistic = (id, price = '0', flags = 3, action = 1, at = date + 'T23:36:00Z') =>
  [id, 3, price, ns(date + 'T00:00:00Z'), ns(at), ns(at), flags, action].join(',');
function fixture(defs, stats) {
  const requests = [],
    files = new Map(),
    reads = [];
  function add(schema, text, overrides = {}) {
    const id = sha(schema + requests.length),
      entry = {
        id,
        schema,
        dataset: 'GLBX.MDP3',
        status: 'complete',
        sha256: sha(text),
        symbols: 'OG.OPT',
        start: schema === 'definition' ? date + 'T00:00:00Z' : date + 'T21:00:00Z',
        end: schema === 'definition' ? '2026-10-13T00:00:00Z' : '2026-10-13T04:00:00Z',
        ...overrides,
      };
    requests.push(entry);
    files.set(path.join(dir, id + '.csv'), text);
    return entry;
  }
  const defEntry = add('definition', [defHeader, ...defs].join('\n'));
  const statEntry = add('statistics', [statHeader, ...stats].join('\n'));
  const audit = load('scripts/lib/cme-cache-audit.ts', {
    'node:fs/promises': {
      readFile: async file => {
        reads.push(file);
        if (file === path.join(dir, 'budget.json')) return JSON.stringify({ requests });
        if (!files.has(file)) throw new Error('Unexpected file read');
        return files.get(file);
      },
    },
    'node:path': path,
    'node:crypto': crypto,
    '../../src/lib/market/cme-carry': carry,
    '../../src/lib/market/cme-option-inputs': options,
    '../../src/lib/market/cme-option-scope': scope,
  });
  return { ...audit, requests, files, reads, add, defEntry, statEntry };
}

test('audit reads only verified cached files and reports zero/expiry without env, network, DB or writes', async () => {
  const c = fixture(
    [definition('42962984'), definition('999')],
    [statistic('42962984'), statistic('999', '5500000000')],
  );
  const report = await c.auditCmeCache(dir, date, 'XAU', ['42962984'], Date.parse(date + 'T23:35:00Z') / 1000);
  assert.equal(report.readOnly, true);
  assert.equal(report.instruments.length, 1);
  assert.equal(report.instruments[0].latestClearing.priceStatus, 'zero');
  assert.equal(report.instruments[0].maturityExclusion, 'short_or_expired');
  assert.equal(report.files.length, 2);
  assert.equal(c.reads.length, 3);
  assert.ok(!JSON.stringify(report).includes('5500000000'));
  assert.ok(!Object.hasOwn(report.instruments[0].recentVersions[0], 'price'));
});

test('audit distinguishes missing definition, deletion, preliminary, sentinel and tick versions', async () => {
  const c = fixture(
    [definition('1'), definition('2', 'C', 'D')],
    [
      statistic('1', '1000000000'),
      statistic('1', '9223372036854775807', 2, 2, '2026-10-13T01:00:00Z'),
      statistic('1', '9000000000', 7, 1, '2026-10-13T02:00:00Z'),
      statistic('2'),
      statistic('3'),
    ],
  );
  const report = await c.auditCmeCache(dir, date, 'XAU', ['1', '2', '3']);
  const [one, two, three] = report.instruments;
  assert.equal(one.latestClearing.final, false);
  assert.equal(one.latestClearing.deleted, true);
  assert.equal(one.latestClearing.priceStatus, 'sentinel');
  assert.equal(one.versionCount, 3);
  assert.equal(two.definition.classification, 'deleted');
  assert.equal(three.definition.classification, 'unknown');
  assert.equal(one.maturityExclusion, 'not_evaluated');
});

test('checksum mismatch, unsafe filenames and provider warnings fail closed', async () => {
  for (const kind of ['checksum', 'path', 'warning']) {
    const c = fixture([definition('1')], [statistic('1')]);
    if (kind === 'checksum') c.files.set(path.join(dir, c.statEntry.id + '.csv'), 'tampered');
    if (kind === 'path') c.statEntry.id = '../secret';
    if (kind === 'warning') c.statEntry.warningPresent = true;
    await assert.rejects(c.auditCmeCache(dir, date, 'XAU', ['1']), /checksum|güvenilir/);
  }
});

test('unrelated products/sessions and incomplete cache reservations are not read', async () => {
  const c = fixture([definition('1')], [statistic('1')]);
  c.add('statistics', 'must-not-read', { symbols: 'SO.OPT' });
  c.add('statistics', 'must-not-read', { start: '2026-10-01T21:00:00Z', end: '2026-10-02T04:00:00Z' });
  c.add('statistics', 'must-not-read', { status: 'reserved' });
  const report = await c.auditCmeCache(dir, date, 'XAU', ['1']);
  assert.equal(report.files.length, 2);
  assert.equal(c.reads.length, 3);
});

test('weekly-only option parents are included without matching unrelated names', async () => {
  const c = fixture([definition('1')], [statistic('1')]);
  c.defEntry.symbols = 'OG1.OPT';
  c.statEntry.symbols = 'OG5.OPT';
  const report = await c.auditCmeCache(dir, date, 'XAU', ['1']);
  assert.equal(report.files.length, 2);
  assert.equal(report.instruments[0].latestClearing.priceStatus, 'zero');
});

test('audit bounds output history and refuses invalid/bulk instrument requests', async () => {
  const c = fixture(
    [definition('1')],
    Array.from({ length: 30 }, (_, i) =>
      statistic('1', String(i), 3, 1, new Date(Date.parse(date + 'T23:35:00Z') + i * 1000).toISOString()),
    ),
  );
  const report = await c.auditCmeCache(dir, date, 'XAU', ['1']);
  assert.equal(report.instruments[0].versionCount, 30);
  assert.equal(report.instruments[0].recentVersions.length, 20);
  for (const ids of [[], ['../secret'], Array.from({ length: 21 }, (_, i) => String(i))])
    await assert.rejects(c.auditCmeCache(dir, date, 'XAU', ids), /instrument_id/);
});

test('diagnostic workflow is manual, secret-free and restore-only; it cannot run the refresh pipeline', () => {
  const workflow = fs.readFileSync('.github/workflows/cme-cache-audit.yml', 'utf8');
  const configuration = workflow
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .join('\n');
  const cli = fs.readFileSync('scripts/audit-cme-cache.ts', 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /fail-on-cache-miss: true/);
  assert.match(workflow, /test "\$RESTORED_CACHE_KEY" = "\$AUDIT_CACHE_KEY"/);
  assert.doesNotMatch(
    configuration,
    /secrets\.|schedule:|actions\/cache\/save|upload-artifact|refresh:cme|collect:cme|--write/,
  );
  assert.doesNotMatch(cli, /loadEnvConfig|DatabentoCache|createClient|writeFile/);
  const actions = [...workflow.matchAll(/uses: (\S+)/g)].map(m => m[1]);
  assert.ok(actions.every(action => /@[a-f0-9]{40}$/.test(action)));
});
