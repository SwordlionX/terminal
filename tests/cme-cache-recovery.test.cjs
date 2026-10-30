/* eslint-disable @typescript-eslint/no-require-imports -- Offline CI/cache migration regression. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const yaml = require('js-yaml');
const { cleanCmeCache } = require('../scripts/clean-cme-cache.cjs');

test('isolated-runner cleanup removes only transient artifacts and preserves every paid-data/budget byte', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-cme-recovery-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const id = 'a'.repeat(64);
  const keep = {
    'budget.json': '{"limitUsd":10,"requests":[{"status":"reserved","reserveUsd":1.1}]}',
    [id + '.csv']: 'id,price\n1,2\n',
    'pricing-bundle-2026-10-21.json': '{"version":2}',
    'unknown.partial': 'keep',
  };
  for (const [name, value] of Object.entries(keep)) await fs.writeFile(path.join(dir, name), value);
  await fs.mkdir(path.join(dir, 'curve-sources'));
  await fs.writeFile(path.join(dir, 'curve-sources', 'source.json'), '{"checksum":"unchanged"}');
  for (const name of ['budget.lock', 'budget.json.tmp', id + '.csv.partial'])
    await fs.writeFile(path.join(dir, name), 'incomplete');
  const env = { GITHUB_ACTIONS: 'true', RUNNER_TEMP: path.join(dir, 'runner'), DATABENTO_CACHE_DIR: dir };
  assert.equal(await cleanCmeCache(env), 3);
  for (const [name, value] of Object.entries(keep))
    assert.equal(await fs.readFile(path.join(dir, name), 'utf8'), value);
  assert.equal(await fs.readFile(path.join(dir, 'curve-sources', 'source.json'), 'utf8'), '{"checksum":"unchanged"}');
  assert.equal(await cleanCmeCache(env), 0);
});

test('cleanup refuses local/shared contexts before touching their lock and tolerates a missing CI cache', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-cme-local-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'budget.lock'), 'active local owner');
  for (const env of [
    { DATABENTO_CACHE_DIR: dir },
    { GITHUB_ACTIONS: 'true', DATABENTO_CACHE_DIR: dir },
    { GITHUB_ACTIONS: 'true', RUNNER_TEMP: 'relative', DATABENTO_CACHE_DIR: dir },
  ])
    await assert.rejects(cleanCmeCache(env), /yalnız izole GitHub/);
  assert.equal(await fs.readFile(path.join(dir, 'budget.lock'), 'utf8'), 'active local owner');
  assert.equal(
    await cleanCmeCache({ GITHUB_ACTIONS: 'true', RUNNER_TEMP: dir, DATABENTO_CACHE_DIR: path.join(dir, 'missing') }),
    0,
  );
});

test('both CME workflows preserve cache compatibility, mutual exclusion and cleanup time after timeout', async () => {
  let sharedGroup;
  for (const filename of ['cme-refresh.yml', 'cme-curves.yml']) {
    const workflow = yaml.load(await fs.readFile(path.join('.github/workflows', filename), 'utf8'));
    const job = Object.values(workflow.jobs)[0],
      steps = job.steps;
    sharedGroup ??= workflow.concurrency.group;
    assert.equal(workflow.concurrency.group, sharedGroup);
    assert.equal(workflow.concurrency['cancel-in-progress'], false);
    const restoreIndex = steps.findIndex(s => s.uses?.startsWith('actions/cache/restore@'));
    const saveIndex = steps.findIndex(s => s.uses?.startsWith('actions/cache/save@'));
    const restore = steps[restoreIndex],
      save = steps[saveIndex];
    assert.equal(restore.id, 'cme-cache');
    assert.equal(restore.with.path, '~/.cache/terminal-x/databento-audit');
    assert.equal(save.with.path, restore.with.path);
    assert.equal(restore.with['restore-keys'], 'cme-curve-budget-');
    assert.equal(restore.with.key, 'cme-curve-budget-${{ github.run_id }}-${{ github.run_attempt }}');
    assert.equal(save.with.key, restore.with.key);
    assert.equal(save.if, 'always()');
    const dataIndex = steps.findIndex(s => s.run?.includes('npm run collect:cme:curves'));
    const dataStep = steps[dataIndex];
    assert.ok(dataStep['timeout-minutes'] > 0);
    assert.ok(job['timeout-minutes'] - dataStep['timeout-minutes'] >= 5);
    const cleaners = steps.flatMap((s, i) =>
      s.run === 'node scripts/clean-cme-cache.cjs' ? [{ ...s, index: i }] : [],
    );
    assert.equal(cleaners.length, 2);
    assert.ok(restoreIndex < cleaners[0].index && cleaners[0].index < dataIndex);
    assert.ok(dataIndex < cleaners[1].index && cleaners[1].index < saveIndex);
    assert.equal(cleaners[1].if, "always() && steps.cme-cache.outcome == 'success'");
    assert.ok(cleaners.every(s => !s.env)); // cleanup never needs production/provider credentials
  }
});
