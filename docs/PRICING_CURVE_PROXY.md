# Vade bazlı faiz ve metal taşıma düzeltmesi — 4 Ekim 2026

Bu sürüm sunum için onaylanan **endikatif CME/SOFR proxy** modelidir. Banka OIS iskonto eğrisi veya banka metal kira kotasyonu değildir. Gerçek banka valör/teminat/karşı taraf koşullarını içermez.

## Girdiler ve yöntem

- Databento GLBX.MDP3: GC/SI futures tanımları, gerçek son işlem zamanları ve final clearing settlement fiyatları; OG/SO ailesi opsiyon tanımları ve final settlement fiyatları. `underlying_id` eşleşmesi kullanılır. Aynı fiyatlı iki ayrı kontrat birleştirilmez. Opsiyon vadeleri futures vadesinin yerine kullanılmaz.
- USD: aylık SR1 SOFR futures settlement fiyatından `(100 − fiyat) / 100` aylık aritmetik gecelik faiz ortalaması alınır. Bu sayı doğrudan sıfır kupon faizi değildir. Seans öncesindeki NY Fed SOFR gerçekleşmeleri çıkarılır; bilinmeyen iş günü gecelik faizleri her ay için sabit kabul edilerek aylık ortalama yeniden üretilir. Tatil/hafta sonları önceki iş gününün fixing'ini taşır. İskonto günlük ACT/360 tahakkuklardan üretilir; hafta sonu aynı iş günü dönemi içinde basit tahakkuktur. SR3 girdileri ayrıca saklanır, bu sürümün USD kalibrasyonunda kullanılmaz.
- Tiingo: aynı seansın 1 dakikalık XAUUSD/XAGUSD spot kapanışları. Gold 13:30, silver 13:25 New York settlement penceresine göre seçilir; saat dilimi/yaz saati otomatik çözülür. Bir dakikalık barın bitişi pencerenin sonunu aşamaz ve en fazla bir dakika geride olabilir. Bugünkü spot, geçmiş futures ile kira türetmek için karıştırılmaz.
- Her metalde kaynak zamanına göre normalize edilen USD faktörü `D(T)` ile metal faktörü `Q(T)=D(T)×F(T)/S_ref` kurulur. Pozitif faktörler kendi gerçek zaman ekseninde logaritmik enterpole edilir. Veri kapsamı dışında fiyat yoktur. Negatif taşıma oranı sırf negatif olduğu için sıfırlanmaz.
- CME Amerikan futures opsiyonu IV'si, futures martingale ağacı ve her adımın USD iskonto oranıyla yeniden çözülür. Avrupa Black-76 kontrol değişkeni kullanılır. Kaynak opsiyonun tam bitiş saati IV zamanını, futures son işlem zamanı taşıma düğümünü belirler. Aynı bitiş zamanındaki farklı dayanaklar tek smile içinde karıştırılmaz.
- Avrupa tipi terminal fiyatlaması değerleme/vade tarihleri arasında `D(T)/D(t)` ve `Q(T)/Q(t)` kullanır. Güncel terminal spotuyla `F=S×Q/D` hesaplanır. IV, aynı sürümün yüzeyinden alınır. 360/365 seçimi oranların gösterimini değiştirir; aynı faktörler, ACT/365 volatilite zamanı ve prim korunur. Delta/gamma/vega sabit IV kısmi türevlerdir; theta bir günlük eğri ilerlemesidir.

## Sınırlar

SR1 futures/swap konveksite düzeltmesi ve ay içi FOMC dağılımı yoktur; tam OIS bootstrap iddiası yapılmaz. Metal futures son işlem tarihi, taşıma düğümünün **vade proxy** zamanıdır; gerçek OTC teslim tarihi değildir. Spot valörü, futures/forward baz farkı, karşı taraf/teminat düzenlemesi ve aynı anda iki ayrı piyasadan tam işlem yapılabilir kotasyon modellenmez. Tiingo dakikalık spotu, CME settlement fiyatının birebir eşanlı borsa işlemi değildir.

Bariyer modeli vade-eşdeğer sabit faiz/taşıma kullanır ve bunu açıkça belirtir; tüm dönemsel eğri yolunu çözen model değildir. Tersine IV ekranı yalnız tanı aracıdır; çözülen IV piyasa yüzeyine yazılmaz. Manuel spot/faiz/kira/volatilite fiyatlama tutarlılığını bozar; üretim metal yolunda manuel fiyatlama veya ETF yüzeyine geçiş kullanılmaz.

## Yayınlama ve maliyet

`collect:cme:curves --write` dört futures ailesinin final girdi snapshot'ını toplar. `refresh:cme` (ve uyumlu `scripts/refresh-cme.ts`) iki metalin faktör/IV paketini birlikte kurup tek Turso işleminde yayınlar. Bir metal başarısızsa etkin sürüm değişmez. Tarih geriye alınamaz; geçmiş paket ayrı anahtarda saklanır. Kaynak cache sağlama toplamı ve ücret rezervasyon defteri korunur; yarım indirme otomatik ücretli tekrar edilmez.

Yeni opsiyon veri çekimlerinin bu turdaki maliyet tahmini yaklaşık **$0,26774** (ilk tanım çekimi dahil); bu sağlayıcı metadata tahminidir, kesin fatura değildir. Yeniden kalibrasyon/aktivasyon cache kullandı, yeni ücretli indirme veya Gemini isteği açmadı. Yerel toplam ücret rezervasyonu $10 sınırında durur; aynı defter GitHub cache ile taşınır. Collector çalışma sınırı $0,25, iki metal IV kurulum sınırı $2 rezervasyondur.

Bu branch'lerin push'u, GitHub default branch veya main merge kararı değildir. Otomatik workflow'un ana sürüme geçirilmesi ve GitHub/Vercel ortam ayarları en son kullanıcıyla kararlaştırılacak.

## Doğrulanan veri

1 Ekim 2026 final seansı, paket `2989cac094e1da01c9709b66a9ea1b6d51a7098ce96ddfca95f4411ff84826b1`: USD 14 aylık projeksiyon / 401 günlük düğüm; her metalde 14 taşıma düğümü / 17 IV vadesi. Referans spot XAU 4.172,72 (17:30 UTC), XAG 60,848 (17:25 UTC). Bunlar tarihli kalibrasyon referanslarıdır; ekranın güncel spotu ayrıca okunur.

4 Ekim değerleme tarihinde bu tarihli referans spotlarla 7/30/60/90/180/270 gün ve beş strike oranında toplam 60 fiyatlama denendi. Kapsama giren 13'er futures düğümü yeniden üretildi; en büyük fiyat farkı altın için `9,1e−13`, gümüş için `1,4e−14`. Put-call paritesi doğrulandı. 360/365 prim farkı sıfır. 90 günlük eşdeğer faiz yaklaşık %4,04383; metal taşıması altın %0,97786, gümüş %1,58279. Bunlar tüm vadelerde kullanılan tek sabit oranlar değildir.

Eski etkin yüzey 2 Ekim tarihlidir; yeni final paket 1 Ekimdir. Farklı seansları doğrudan karşılaştırıp prim değişimini yalnız algoritma düzeltmesine atfetmek doğru olmaz. Ayrıntılı, gizli olmayan yerel doğrulama çıktısı dış cache'deki `pricing-validation-2026-10-01.json` dosyasındadır.

167 otomatik test geçti; bunların 14'ü yeni tarihli faktör/SOFR/Amerikan IV, gün bazı, manuel engel, paket bütünlüğü, asistan ve tarihli pozisyon senaryosu regresyonlarıdır. Tam lint ve üretim derlemesi de doğrulandı. Gemini kabul denemeleri bu aşamada yapılmadı (0 istek).

## Kaynaklar

- [CME SOFR settlement hesapları](https://www.cmegroup.com/education/files/sofr-futures-settlement-calculation-methodologies.pdf)
- [New York Fed reference rate yöntemleri](https://www.newyorkfed.org/markets/reference-rates/additional-information-about-reference-rates)
- [CME SOFR swap/futures ve konveksite](https://www.cmegroup.com/articles/2025/price-and-hedging-usd-sofr-interest-swaps-with-sofr-futures.html)
- [CME metal kontratları ve teslim konvansiyonları](https://www.cmegroup.com/trading/metals/files/metals-prod-guide-2022.pdf)
- [Databento GLBX.MDP3](https://databento.com/docs/venues-and-datasets/glbx-mdp3)
- [Tiingo FX veri belgeleri](https://www.tiingo.com/documentation/forex)
