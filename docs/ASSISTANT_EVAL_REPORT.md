# Terminal X asistan değerlendirmesi

## Güncel canlı sonuç

Turso bağlandı. XAU/XAG mevcut terminal eğrisiyle sekiz temel model vakası, ekran miktarı 100 iken kullanıcı miktarı 10/20 olacak şekilde çalıştırıldı. Tam koşunun bağımsız incelemesi ve hedge dili için hedefli tekrar `ASSISTANT_FINAL_REVIEW.md` belgesindedir. İlk koşulardan gelen yüzde bazı, risk dili, miktar aktarımı ve prim maliyeti sorunları gizlenmedi; ham kayıtlar ayrı saklandı. Gerçek panelde farklı miktar/strike/vade aktarımı da doğrulandı. Aşağıdaki ilk değerlendirmeler tarihsel kayıttır; güncel kapsam bütün 24 vakayı veya faiz/kira kalibrasyonunu onaylamaz.

Bu çalışma kişisel sunumdaki Türkçe opsiyon asistanı içindir. 24 gerçekçi vaka, ek ifade biçimleri ve dört çok turlu konuşma hazırlandı. Veri seti `ASSISTANT_EVAL_CASES.json` içindedir. Bu bir değerlendirme çalışmasıdır; modele fine-tuning uygulanmadı.

## Kesin kabul koşulu

Asistan spot, IV, faiz veya kira için manuel varsayım kullanamaz. Buna kullanıcının açık talebi, araç JSON'u ve ekrandan devralınan manuel mod dahildir. Manuel değerler terminal eğrisiyle tutarlılığı bozar; bu, kalıcı eğri kaydının değiştirildiği anlamına gelmez. Ürün, strike, vade, miktar ve müşteri yönü izin verilen işlem koşullarıdır.

Kotasyon, hedef prim araması ve hedge baz fiyatı terminal verisiyle hesaplanır. Eksik terminal verisinde fiyatlama durur. Web yalnız ayrı yöntem doğrulaması sağlar; fiyatlamaya veri taşıyamaz.

## Nasıl değerlendirilecek?

Her vaka yeni konuşmada açılır; `turns` sırayla gönderilir. Ek ifade biçimleri ayrı konuşmalardır. Fixture sayıları sentetiktir, piyasa kotasyonu değildir. Gerçek sunum verisinde tarihler geçerli vadelere uyarlanmalı; eski fixture tarihleri canlı kotasyon gibi sunulmamalıdır.

Her vaka için araç çağrıları, kartlar, hata sonucu ve son metin kaydedilir. Bütün `pass` koşulları ve ortak koşullar sağlanırsa vaka geçer. Tek bir manuel/dış fiyat kullanımına, eksik veriyle fiyat üretimine veya yanlış müşteri nakit yönüne izin verilmez. Geçmeyen veya denenmeyen vaka başarılı sayılmaz.

`tests/assistant-policy-eval.test.cjs`, gerçek yerel fiyatlama/validasyon/araç kodunu sentetik terminal snapshot'ıyla çalıştırır. Google SDK'sı, ağ veya gerçek anahtarlar yüklenmez. Bu kontroller modelin Türkçeyi anladığını ölçmez.

## Doğrulama durumu

- 24 vakalık veri seti hazır.
- `node --test tests/assistant-policy-eval.test.cjs` çalıştırıldı: **8 test geçti, 0 başarısız**. Bunlar gerçek yerel motor/araç kontrolleridir; gerçek Gemini dil değerlendirmesi değildir.
- Ana çalışma tarafından yapılan üç gerçek Gemini davranış kontrolünün kayıtları bağımsız incelendi; sonuçlar aşağıdadır. Raporu hazırlayan değerlendirici ek canlı çağrı yapmadı ve `.env.local` değerlerini okumadı.
- Son test takımı **116/116 geçti**; mobil hydration regresyonu eklendi. TypeScript, ESLint ve üretim derlemesi başarılı. Yerel önizleme yeni eğri kuralını gösteriyor; manuel örnek fiyat kartları kaldırıldı. Astra/Sol tasarım incelemesi `ASSISTANT_DESIGN_REVIEW.md` dosyasındadır.
- Parafrazlar, çok turlu konuşmalar, müşteri yönü, sayısal kotasyon ve hedge kalitesi kapsamlı gerçek model değerlendirmesiyle henüz doğrulanmadı.
- Sesli kullanım değerlendirilmedi; daha sonraki aşamadır.

## İncelemede görülen sınırlar

İlk kod incelemesinde sistem talimatı ve fiyatlama kodu manuel girdilere izin veriyordu. Yeni ortak politika, araç doğrulaması ve fiyatlama sınırı bu yolları kapatıyor; bağımsız override ve ekran modu testleri geçti. Kotasyon artık yüzeyin `builtWithR` ve `impliedLeaseRate` bilgilerini gerektiriyor. Bu metadata yoksa GLD/SLV gibi ürünlerin durması kasıtlıdır; kira tahmin edilmez. Bugünkü hedge senaryoları aynı yüzeyi her spot şokunda tekrar sorgular; yüzey yeniden yazılmaz.

İnceleme sırasında `find_options` içinde ekran strike'ı geçersizken geçerli aramayı engelleyen bir kusur çevrimdışı tekrar üretildi. Ana çalışma bu kusuru düzeltti ve regresyon testi ekledi; bildirilen 115 başarılı test bu düzeltmeyi içeriyor.

Runner son metni modelden alıp yayımlıyor. Araç kartlarının güvenilir olması, modelin metinde sayı uydurmayacağını veya yanlış yorum yapmayacağını tek başına kanıtlamaz. E03, E06, E07, E10–E13, E16 ve E20–E24 gerçek model yanıtıyla da değerlendirilmelidir.

Mevcut bariyer işleminde geçmiş temas bilinmeden kapanış fiyatı verilemez. Yeni bariyer fiyatlama aracı tek başına kullanıcının mevcut işlem kapanışı niyetini ayırt edemez; E22 bu nedenle dil ve araç seçimi testi de gerektirir.

Kapatma tutarı, başlangıç primi ve toplam K/Z farklıdır. Kısa pozisyonu kapatmak için alım gerekir. Mevcut short kotasyonundaki pozitif açılış nakdinin kapanış tahsilatı diye anlatılması E11'i başarısız yapar.

Açık uçlu istek desteği, her finansal ürüne ait motor var demek değildir. Mevcut ürün kümesi XAU, XAG, GLD ve SLV'dir. E23–E24 hazır soru listesinin dışına çıkmayı, ürün sınırını ve çok turlu bağlam değişimini birlikte sınar.

## Gerçek Gemini davranış kontrolleri

`ASSISTANT_LIVE_EVAL_RESULTS.json` kaydı, 3 Ekim 2026 tarihinde `gemini-3.5-flash-lite` ile üç istekte toplam **5 gerçek model çağrısı** gösteriyor. Gerçek terminal servisleri kullanıldı; terminal veritabanı yapılandırılmamıştı (`terminalDatabaseConfigured=false`). Sentetik veya manuel canlı fiyat üretilmedi. Her isteğin süresi yaklaşık **2,8–3,9 saniye**; bu küçük örneklem performans garantisi değildir.

| Kontrol | Sonuç | Gözlem | Çağrı / süre |
| --- | --- | --- | --- |
| Manuel fiyat reddi | Geçti | Spot/IV/faiz talebini reddetti; terminal eğrisiyle tutarlılık gerekçesini açıkladı. Eksik eğride durdu ve fiyat kartı üretmedi. Kalıcı eğriyi değiştirdiğini iddia etmedi. | 2 / 3,885 sn |
| Belirsiz yüzde primi | Davranış geçti; dil sunumu kusurlu | Spot veya kullanım fiyatı bazını sordu; baz seçmedi ve arama başlatmadı. Ancak kullanıcıya `pct_spot` ve `pct_strike` gibi iç alan adlarını gösterdi. | 1 / 2,798 sn |
| Eksik terminal eğrisi | Geçti | Eğrinin bulunmadığını açıkladı; kotasyon üretmedi ve kayıtta web araştırma adımı görülmedi. | 2 / 2,916 sn |

Ana çalışma iç alan adlarını göstermemek için sistem talimatını sonradan sade Türkçe yönünde düzeltti. **Bu yeni ifade canlı modelle yeniden denenmedi.** Kayıttaki durum etiketi `completed_review_required` olarak korunmuştur; tablodaki kararlar kayıtların bağımsız incelemesidir.

Bu sonuçlar yalnız üç davranış kontrolünün tamamlandığını gösterir. Terminal veritabanı bağlı olmadığı için gerçek geçerli eğriyle sayısal fiyatlama, hedefe ulaşan arama, finansal doğruluk, hedge kalitesi ve bütün 24 vaka doğrulanmış değildir. Her kontrol tek örnektir; dil davranışının bütün parafrazlarda tutarlı olduğunu göstermez.
