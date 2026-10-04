# Çalışma alanı kabul kontrolleri — 4 Ekim 2026

## Otomatik kontroller

- 177 test geçti: geçmiş prim korunması; seçili kayıtların sahipliği; hatalı/fazla kimlik ve dış fiyat alanlarının reddi; karışık metal/bariyer/vadesi geçmiş pozisyon sınırları; müşteri değişiminde sohbet ayrımı; toplu teminat okuma; eksik spot kaynak uyarısı; sunucuda erken vade sonucu yasağı.
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

Son gerçek Gemini kontrolünün sonuçları `WORKSPACE_LIVE_EVAL.json` içinde kayıt altına alınır. Kota tüketen testler bütün geliştirmeler bittikten sonra sınırlı sayıda yapılır.
