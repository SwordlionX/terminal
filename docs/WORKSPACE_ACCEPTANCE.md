# Çalışma alanı kabul kontrolleri — 4 Ekim 2026

## Otomatik kontroller

- 179 test geçti: geçmiş prim korunması; seçili kayıtların sahipliği; hatalı/fazla kimlik ve dış fiyat alanlarının reddi; karışık metal/bariyer/vadesi geçmiş pozisyon sınırları; müşteri değişiminde sohbet ayrımı; toplu teminat okuma; eksik spot kaynak uyarısı; sunucuda erken vade sonucu yasağı; doğal dilde manuel piyasa girdisi talebinin fiyat kartına dönüşmeden ve model çağrısı harcamadan reddi.
- ESLint, TypeScript ve üretim derlemesi doğrulandı. Son tema aktarımı sonrası iki branch derlemesi ayrıca kontrol edilir.

## Gerçek uygulama kontrolleri

- Bloomberg ana fiyatlama: USD/% eşit görünüm, merkez smile, müşteri yönüne göre Greeks ve sonlu short put kaybı.
- Tek/çoklu kayıt seçimi: kayıtlı giriş primiyle K/Z ve delta/gamma haritaları, eksik yüzey hücrelerinin boş bırakılması.
- Müşteri dosyası: özet/işlem/teminat/not sekmeleri, gerçek kayıtlara bağlantılar.
- Risk dosyası seçimi: seçimin ve hazır sorunun asistana aktarımı, gönderim olmadan sıfır model çağrısı.
- Eğriler: gerçek paket seansı, ayrı spot/yüzey zamanları, smile/vade geçişi, iskonto/taşıma tablosu.
- Hedef prim: spot nominali %5 için mevcut IV eğrisinde strike araması, gerçek USD/% kartı ve strike'ın forma uygulanması.
- Bariyer/delta hedge: ortak koşullar, piyasa yükleme durumunda hesap vermeme, yöntem sınırları.
- 390px iframe görünümünde gerçek fiyatlama ve pozisyon analizi. Dar ekranda tablo yatay kayabilir; asistan tam ekran açılır.

## Sınırlar

Bu kontroller banka kira kotasyonu veya canlı OIS eğrisi doğrulaması değildir. Aktif bundle endikatif CME/SOFR proxy'dir. Kayıt/teminat veritabanına kabul testi için yazma yapılmadı. Ek Databento indirmesi yapılmadı. Müşteri adları, anahtarlar ve kimlikler bu rapora dahil edilmez.

## Son gerçek bağlantı değerlendirmesi

Gerçek üretim API'si, erişim kodu ve Gemini `gemini-3.5-flash-lite` ile üç vaka denendi. İlk tur `WORKSPACE_LIVE_EVAL.json`, düzeltme sonrası tek vaka `WORKSPACE_LIVE_EVAL_RETEST.json` içinde korunur. Toplam **7 gerçek sağlayıcı çağrısı**; ekstra ücretli Databento indirmesi yok.

| Vaka | Sonuç |
| --- | --- |
| Seçili kayıtlı pozisyon | 3 model çağrısı. Geçmiş prim, kayıtlı miktar/strike, ortak motor fiyatı/Greeks, K/Z haritası ve Avrupa tipi sözleşme yükümlülüğünün devamı doğrulandı. |
| Spot nominali %5 hedef, açıkça 10 ons | 2 model çağrısı. Doğru miktar, tolerans içindeki strike, terminal motoruyla aynı fiyat ve araştırma kullanılmaması doğrulandı. |
| Manuel spot/IV/faiz/kira | İlk tur 2 çağrıda manuel sayılar kullanılmadan otomatik fiyat kartı verilmiş, açık ret gerekçesi eksik kalmıştı. Sunucu ön kontrolü eklendi. Yalnız bu vaka yeniden çalıştırıldı: **0 model çağrısı**, fiyat kartı yok, eğri tutarlılığı gerekçesiyle açık ret. |

Son durum: bu üç kabul vakası geçti. Bu sınırlı değerlendirme bütün serbest metinleri/model paraphrase'lerini doğruladığı anlamına gelmez. Önceki başarısız ilk tur raporu silinmez veya başarıya çevrilmez.
