# Vercel'e Dağıtım Rehberi

## 1. Turso veritabanı oluştur (5 dakika, ücretsiz)

1. https://turso.tech adresine gir, GitHub ile kaydol.
2. "Create Database" ile bir veritabanı oluştur (bölge: Frankfurt öner — Türkiye'ye en yakın).
3. Veritabanı sayfasından şunları kopyala:
   - **Database URL** (`libsql://...turso.io`)
   - **Auth Token** ("Create Token" butonuyla üret)

Tablo oluşturmana gerek yok — site ilk açılışta şemayı ve örnek müşterileri kendisi kurar.

## 2. Vercel'e bağla

1. Projeyi GitHub'a pushla (`terminal/` klasörü repo kökü olacak şekilde).
2. https://vercel.com → "Add New Project" → repoyu seç. Next.js otomatik algılanır.
3. **Environment Variables** bölümüne ekle:
   - `TURSO_DATABASE_URL` = libsql://... (1. adımdan)
   - `TURSO_AUTH_TOKEN` = eyJ... (1. adımdan)
   - `SITE_PASSWORD` = seçeceğin giriş şifresi (siteyi şifre ekranıyla korur)
4. Deploy'a bas.

## 3. Domain bağla

Vercel → Project → Settings → Domains → domainini ekle.
Vercel'in verdiği DNS kayıtlarını (A / CNAME) domain sağlayıcında tanımla.

## Notlar

- **Yerel geliştirme:** env değişkeni gerekmez; otomatik `data/local.db` dosyası kullanılır.
  Yerel veri ile Vercel verisi ayrıdır.
- **Opsiyon zinciri:** İlk kurulumda depodaki `data/yahoo_snapshot.json` kullanılır.
  "Opsiyon Zincirlerini Yenile" butonuna basınca güncel zincir Turso'ya kaydedilir ve kalıcı olur.
- **Zincir yenileme süresi:** ~30-60 sn sürer (36 vade çekiliyor). Vercel Hobby planında
  fonksiyon limiti 60 sn'dir; nadiren zaman aşımı olursa bir daha basmak yeterli.
- **Güvenlik / Şifre:** `SITE_PASSWORD` tanımlıysa tüm sayfalar ve API'ler şifre ekranının
  arkasındadır; giriş 30 gün hatırlanır. Şifreyi değiştirmek içi