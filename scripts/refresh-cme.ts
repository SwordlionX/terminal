/**
 * Günlük CME yüzey yenileme — Vercel DIŞINDA koşar (GitHub Actions).
 *
 * Neden burada: Databento'nun timeseries uçları istek başına ~20sn sabit gecikmeli ve günlük
 * settlement dosyası ~112 MB; toplam iş 3 dakikayı bulabiliyor. Vercel Hobby fonksiyonları
 * 60 saniyede kesildiği için bu iş orada güvenilir çalışamıyor. Burada zaman limiti yok.
 *
 * Uygulamanın kendi servis kodunu (services/cme.service) doğrudan çağırır — mantık
 * kopyalanmaz, tek kaynak korunur. Sonuç Turso'daki kv tablosuna yazılır; site oradan okur.
 *
 * Gerekli ortam değişkenleri:
 *   DATABENTO_API_KEY, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 *
 * Yerel deneme:  npm run refresh:cme
 * Belirli gün :  npm run refresh:cme -- --date=2026-07-24
 * Ürün        :  npm run refresh:cme -- --product=XAG
 */
import { loadEnvConfig } from '@next/env';
import { refreshCmeSurface } from '../src/services/cme.service';
import { getInterestRate } from '../src/services/market.service';

// .env.local'i Next'in kendi yükleyicisiyle oku (yerel çalıştırma için). GitHub Actions'ta
// değişkenler zaten ortamdan gelir; loadEnvConfig var olanları EZMEZ.
loadEnvConfig(process.cwd());

async function main() {
  const args = process.argv.slice(2);
  const get = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];

  const product = (get('product') || 'XAG').toUpperCase();
  const date = get('date');

  for (const v of ['DATABENTO_API_KEY', 'TURSO_DATABASE_URL']) {
    if (!process.env[v]) throw new Error(`${v} tanımlı değil`);
  }

  const t0 = Date.now();
  const rate = await getInterestRate();
  console.log(`[cme-refresh] başlıyor · ürün=${product}${date ? ` · gün=${date}` : ' · gün=otomatik (son settlement)'} · faiz=${(rate * 100).toFixed(2)}%`);

  const surface = await refreshCmeSurface(product, date ? { date, r: rate } : { r: rate });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const short = surface.expiries.filter(e => e.days < 32).map(e => `${e.days}g`).join(', ');
  console.log(`[cme-refresh] TAMAM (${secs}s)`);
  console.log(`  kaynak      : ${surface.fetchedISO}`);
  console.log(`  vade sayısı : ${surface.expiries.length}`);
  console.log(`  en kısa vade: ${surface.expiries[0]?.days} gün`);
  console.log(`  kısa uç     : ${short || '(32 günden kısa vade yok)'}`);
}

main().catch((e) => {
  console.error('[cme-refresh] HATA:', e instanceof Error ? e.message : e);
  process.exit(1);
});
