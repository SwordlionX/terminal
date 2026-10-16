import { auditCmeCache } from './lib/cme-cache-audit';

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const dir = value('cache-dir'),
    date = value('date'),
    product = value('product'),
    ids = value('ids');
  if (!dir || !date || !ids || (product !== 'XAU' && product !== 'XAG'))
    throw new Error('--cache-dir=... --date=YYYY-MM-DD --product=XAU|XAG --ids=42962984 gerekli');
  const evalAt = value('eval-at');
  const report = await auditCmeCache(
    dir,
    date,
    product,
    ids.split(','),
    evalAt ? Date.parse(evalAt) / 1000 : undefined,
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => {
  // No arbitrary file contents, provider bodies, environment values or credentials in errors.
  console.error(
    'CME önbellek denetimi tamamlanamadı: argümanları, cache dosyalarını ve checksum kayıtlarını kontrol edin. Ağ/veritabanı erişimi yapılmadı.',
  );
  process.exitCode = 1;
});
