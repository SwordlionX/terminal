/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free CI cleanup, including failed installs. */
const { readdir, rm } = require('node:fs/promises');
const { homedir } = require('node:os');
const path = require('node:path');

/** Run only BETWEEN data processes on an isolated GitHub runner, never against a live local cache. */
async function cleanCmeCache(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true' || !env.RUNNER_TEMP || !path.isAbsolute(env.RUNNER_TEMP))
    throw new Error('Geçici CME dosyaları yalnız izole GitHub çalışma ortamında temizlenebilir.');
  const cacheDir =
    env.DATABENTO_CACHE_DIR ||
    (env.LOCALAPPDATA
      ? path.join(env.LOCALAPPDATA, 'Terminal-X', 'databento-audit')
      : path.join(homedir(), '.cache', 'terminal-x', 'databento-audit'));
  let files;
  try {
    files = await readdir(cacheDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of files) {
    // Keep budget.json, every completed CSV, source snapshots and checksums intact.
    // A restored legacy lock has no owner on this fresh runner. New locks live in RUNNER_TEMP.
    if (!entry.isFile() || !/^(?:budget\.lock|budget\.json\.tmp|[a-f0-9]{64}\.csv\.partial)$/.test(entry.name))
      continue;
    await rm(path.join(cacheDir, entry.name), { force: true });
    removed++;
  }
  return removed;
}

module.exports = { cleanCmeCache };
if (require.main === module)
  cleanCmeCache()
    .then(count => console.log(`CME: ${count} geçici dosya temizlendi; bütçe kaydı ve tamamlanmış veriler korundu.`))
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
