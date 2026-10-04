# Final settlement ve taşıma girdileri

4 Ekim 2026 — ortak altyapı; Bloomberg ve Meridian aynı veri snapshot'ını kullanır.

## Bulunan eski zamanlama notu

`.github/workflows/cme-refresh.yml` Pazartesi–Cumartesi 12:00 UTC / Türkiye 15:00'te çalışacak şekilde yazılmış. `src/services/cme.service.ts` 17:00–19:00 UTC sorgusunu büyük opsiyon indirmelerinde zaman aşımını önlemek için kullanıyor. Önceki altı günlük fiyat eşitliği deneyi erken fiyatların *final* olduğunu kanıtlamaz. Eski kod `stat_flags` ve `ts_ref` okumuyordu. Faiz/taşıma için bu yol kullanılmıyor; eski IV/piyasa kira yaklaşımının fiyatlama motoruna geçişi bu değişiklik değildir.

Kaynaklar: [Databento GLBX.MDP3 istatistik normalizasyonu](https://databento.com/docs/venues-and-datasets/glbx-mdp3), [CME preliminary/final settlement açıklaması](https://cmegroupclientsite.atlassian.net/wiki/spaces/EPICSANDBOX/pages/457414586/Settlement+Prices), [CME Cuma/Sunday startup açıklaması](https://www.cmegroup.com/tools-information/lookups/advisories/market-data/20110103.html).

## Yeni toplama yolu

`npm run collect:cme:curves -- --date=2026-10-01` doğrular, veritabanına yazmaz. `--write` yalnız bağımsız girdi snapshot'ını kaydeder; `--cache-only` ücretli indirmeleri tamamen kapatır ve açık tarih gerektirir.

- GC/SI ve SR1/SR3 için aynı `ts_ref` seansı; bu tarih yerel saat dilimine çevrilmez.
- İlk 15 dakikadan exchange definitions; kimlik, gerçek expiration/son işlem zamanı, kontrat sınıfı ve sembol saklanır. Opsiyon vadeleri taşıma hesabına girmez.
- İstatistik yayın aralığı normal günlerde 17:00 UTC–ertesi 04:00 UTC; Cuma için Pazartesi 04:00 UTC'ye kadar. Bu aralık CDT/CST dönemlerini kapsayan muhafazakâr bir toplama aralığıdır, tüm ürünlerin borsa yayın saati değildir. Veri sonu bu aralığı kapsamıyorsa aday ücretsiz elenir.
- Final bit'i zorunlu; intraday ve trading-tick fiyatları yerine clearing-tick kayıtları kullanılır. Theoretical final saklanabilir ve bayrağı korunur; theoretical olmak tek başına eksik veri demek değildir.
- Son güncelleme, silme ve sentinel fiyat işlenir. Eski geçerli kayıt yeni geçersiz kaydın yerine geri gelmez. Eksik kolon, bozuk CSV, tanımsız settlement kontratı veya bulunan bir outright'ta preliminary/invalid fiyat bütün adayı reddeder.
- Listed/untraded/no-OI kontratların settlement'ı MDP'de bulunmayabilir. Eksik kimlikler kayda yazılır; asgari kontrat sayısı tek başına tüm feed'in tamamlığını kanıtlamaz. Gerekli gelecekteki fiyatlama düğümleri ayrıca kapsam denetimi gerektirir.
- Cuma final'inin yalnız Sunday SecurityDefinition TradingReferencePrice içinde yayımlandığı enstrümanlar için bu ayrı alan Databento definition CSV'sinde mevcut değil. Final statistics bulunamazsa sistem kabul etmez; otomatik mod önceki doğrulanan seansa geçer ve sebebini yazar. Cuma verisi mutlaka Pazartesi kullanılacak garantisi verilmez.

## Hesabın anlamı

Metal futures'larında her kontrat kimliği korunur. Aynı fiyatlı farklı kontratlar birleştirilmez. Komşu kontratlar arasındaki net taşıma:

`c = ln(F₂/F₁) / ((sonİşlem₂ − sonİşlem₁) / ACT365)`

Bu CME futures vade farkının bir proxy ölçüsüdür; banka metal kirası değildir. Futures expiration'ı OTC teslim/ödeme valörü olarak kullanılmaz. Düğümler arasında yalnız log-fiyat enterpolasyonu var; aralık dışı extrapolasyon yok. Henüz spot çapası, USD iskonto faktörü veya metal lease faktörü kurulmadı. SR1/SR3 fiyatlarını doğrudan zero faiz saymak veya bunlardan eksik fixing/konveksite/valör işlemleri olmadan OIS curve üretmek doğru değildir.

`pricingReady=false` açıkça saklanır. `cme_surface_XAU`, `cme_surface_XAG`, `interest_rate` ve aktif kaynak anahtarları değiştirilmez. Mevcut yüzeyin eski kira ve tek-faiz sorunları bu veri toplama adımıyla giderilmiş sayılmaz. Yeni bankacılık fiyatlamasına geçişte USD curve, carry/lease faktörleri ve IV yeniden kurulumu birlikte uygulanmalıdır.

## Saklama, bütçe ve zamanlama

Ham CSV'ler Git'e girmez; dış önbellekte checksum ve ücret tahminli ledger bulunur. Her ücretli indirmeden önce `metadata.get_cost`; çalışma başına $0.25 rezerv, yerel ledger toplamı $10 sınırı. Rezerv tahminin iki katı + $0.01'dir. Bunlar sağlayıcı/fatura/hesap genelinde zorunlu harcama limitleri değildir. Başarısız ücretli indirme otomatik yeniden denenmez; rezerv korunur. Hatalı cache checksum veya sağlayıcı uyarısı kabul edilmez.

Turso'da içerik hash'li `databento_curve_inputs_v1:<seans>:<hash>` snapshot ve atomik `databento_curve_inputs_v1:latest` işaretçisi kullanılır. Eski tarihli manuel çalışma latest'i geriye götürmez. Bu işaretçi fiyatlama yüzeyinin işaretçisi değildir.

Yeni `.github/workflows/cme-curves.yml` hafta içi Türkiye 15:00'te doğrulanan son seansı toplar. Ücret ledger'ı başarısız işlerde de cache'e alınır. GitHub zamanlı işler default branch'teki workflow üzerinden yürür; yalnız tasarım branch'lerine push etmek zamanlı çalışmayı aktif etmez. Default branch geçişi bu çalışmada yapılmadı.

## Gerçek veri kontrolü

1 Ekim 2026 seansı, 2 Ekim 04:00 UTC'ye kadar yayınlar:

| Kök | Vadesi geçmemiş final outright | Final yayın aralığı UTC |
| --- | ---: | --- |
| GC | 34 | 23:35:05–23:37:48 |
| SI | 32 | 23:34:48–23:37:50 |
| SR1 | 25 | 23:34:51–23:38:05 |
| SR3 | 45 | 23:34:43–23:37:49 |

Bu örnekte dört ailede de geçmemiş outright'ların eksik settlement kimliği yok. GC/SI erken ve son fiyatları aynı; erken kayıtların final bayrağı olmadığı ayrıca doğrulandı. SOFR aileleri metalin erken penceresinde bulunmuyor.

Yeni dört örnek indirmesinin metadata tahmini **$0.010114338248**. Önceki kontrollerle toplam tahmin $0.019994206725; gerçek fatura değildir. Doğrulama/Turso yazımı mevcut dört cache dosyasını kullandı: yeniden ücretli istek 0, Gemini isteği 0. Canlı pricing anahtarlarının önce/sonra hash'leri aynı. Snapshot ham veri hash'i `480eae016aa315f12b2caa9707401b6945ff42e23ecd70016ceb8ea6af1135da`.

152 test geçiyor. Yeni testler final/preliminary/revision/ref date, deletion, intraday/tick, eksik CSV/tanım, Cuma/DST ufku, eşit fiyatlı farklı kontratlar, haftalık opsiyon bağımsızlığı, gerçek vade/log enterpolasyonu, maliyet sınırı, cache checksum, uyarı ve başarısız indirme rezervini kapsıyor.
