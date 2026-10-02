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
4. Deploy'a bas.

## 3. Domain bağla

Vercel → Project → Settings → Domains → domainini ekle.
Vercel'in verdiği DNS kayıtlarını (A / CNAME) domain sağlayıcında tanımla.

## Notlar

- **Yerel geliştirme:** `TURSO_DATABASE_URL` ve `TURSO_AUTH_TOKEN` gerekir.
  Yerel dosya yedeği yoktur. Hangi veritabanına bağlanıldığı bu değişkenlerle belirlenir;
  ayrı branch açmak veritabanını ayırmaz. Üretim bağlantısıyla yapılan yazmalar canlı veriyi değiştirir.
- **Doğrulama:** `npm test` ağdan ve üretim veritabanından bağımsız testleri çalıştırır.
  `npm run build` uygulamayı, bakım betiklerini ve üretilen route tiplerini denetler;
  `tsconfig.build.json` kökteki kişisel deney dosyalarını ve eski dev çıktılarını kapsamaz.
  TypeScript hata kontrolü açıktır.
- **Opsiyon zinciri:** CME ve Yahoo yüzeyleri Turso'da ayrı saklanır. CME ana kaynaktır;
  bir işin başarılı bitmesi, sağlayıcının daha yeni bir settlement günü yayımladığı anlamına gelmez.
  Ekrandaki yüzey veri tarihi ayrıca kontrol edilmelidir.
- **CME yenilemesi:** Uygulama GitHub Actions işini başlatır, dönen takip numarasıyla
  aynı işin sonucunu en fazla 20 dakika izler. İsteğin kabul edilmesi başarı sayılmaz.
  Sekme kapanırsa takip durur, GitHub işi iptal edilmez. Belirsiz sonuçta yeniden basmadan
  önce GitHub Actions'taki iş ve son yüzey tarihi kontrol edilmelidir.
- **CME dağıtım sırası:** `.github/workflows/cme-refresh.yml` içindeki `request_id` girişi
  ve `run-name` değişikliği önce hedef branch'e ulaşmalıdır (varsayılan `main`, sunucuda
  `CME_REFRESH_REF` ile değiştirilebilir). Ardından uygulama yayımlanır. Vercel sunucusunda
  `GITHUB_PAT` için bu repoda Actions okuma/yazma yetkisi gerekir; anahtar tarayıcıya gönderilmez.
  GitHub Actions'ta mevcut `DATABENTO_API_KEY`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
  secrets korunur. Vercel preview ortamından canlı CME işi başlatılması engellenir.
  Diğer ekranlar için preview ortamı kendiliğinden veritabanı izolasyonu sağlamaz.
- **Güvenlik / Şifre:** Kullanıcı kararıyla site şifre koruması kaldırılmıştır.
  `SITE_PASSWORD` tanımlı olsa bile kullanılmaz; bağlantıya sahip herkes müşteri
  verilerine ve kayıt işlemlerine erişebilir. `/login` ana sayfaya yönlenir.
  Otomatik yenileme uçlarının kendi servis anahtarı kontrolleri korunmuştur.
