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

## Bloomberg sidebar ve Vercel kabulü — 4 Ekim

Bloomberg branch'inde sol menü, fiyatlama alt menüsü, ana fiyatlamada bariyer seçimi, sağ altta sabit asistan düğmesi ve müşteri işlem tablosu uygulandı. Meridian geliştirmesi durduruldu; bu değişiklikler aktarılmadı.

182 otomatik test, ESLint ve üretim derlemesi geçti. Desktop ve 390px dar görünüm, menü açma/daraltma, bariyer açma/kapatma, eski bariyer URL'sinin ana fiyatlamaya yönlenmesi, müşteri filtreleri ve kayıt bağlantıları tarayıcıda kontrol edildi. Kabul için finansal kayıtlara yazılmadı.

Vercel Preview ortamında yalnız `codex/terminal-bloomberg-v1` için asistan sunucu ayarları kaydedildi. İlk gerçek canlı fiyatlama testi `MALFORMED_FUNCTION_CALL` ile başarısız oldu. Modelin seçili işlem koşullarını tekrar üretmesini gerektirmeyen `price_selected_option` aracı ve ortak tek tekrar hakkını koruyan onarım eklendi; bozuk cevap yürütülmez.

`eae9186` yayını üzerinde aynı bariyerli istek bir kez yeniden denendi ve tamamlandı: XAG müşteri satışı put, 10 ons, strike 60,37, vade 2027-01-02, UO bariyer 66,41. Asistan kartı ana ekranla aynı **31,26 USD**, **3,1256 USD/ons**, **%5,18 spot nominali** verdi; bariyer ve miktar korundu. Manuel spot/IV/faiz isteği ayrı kontrol edildi: açık eğri tutarlılığı gerekçesiyle ret, yeni fiyat kartı yok; sunucu ön kontrolü model çağrısı yapmaz. Bu tur ek Databento indirmesi yapılmadı. Başarılı tekrar ilk canlı hatayı gizlemez; bu sınırlı kabul bütün serbest metin senaryolarını kapsamaz.

Canlı branch adresi: https://terminal-git-codex-terminal-bloomberg-v1-swordlionxs-projects.vercel.app/

## Talep odaklı asistan — ekran varsayımları kaldırıldı

Kullanıcının son talebiyle fiyatlama ekranı bir başlangıç öncülü olmaktan çıkarıldı. Bağımsız fiyat, hedef ve analiz araçları eksik ürün/yön/tip/miktar/strike/vadeyi ekrandan tamamlamaz. Hedef aramasında strike sonuç olduğu için zorunlu değildir. Değerleme tarihi belirtilmediyse İstanbul takviminde bugün, gün bazı belirtilmediyse ACT/365 kullanılır. Piyasa girdileri her zaman terminalin ilgili metal eğrisidir. Ekran koşulları modele yalnız açık ekran okuma isteğinde gönderilir; selected araçları da bu isteği sunucuda kontrol eder. Sayfa/ürün/strike değişiklikleri sohbeti sıfırlamaz. Genel "bir fiyat al" isteği önce yeni işlem bilgilerini sorar ve model çağrısı harcamaz.

Müşterinin adıyla istenen dosya her sayfadan aranabilir; belirsiz eşleşmede tam adı sorulur, dosya kendiliğinden seçilmez. Özel notlar/vergi numarası modele taşınmaz. Bu istekte açıkça okunmuş dosya geçmiş primle analiz edilebilir. Yazma/emir/teminat çağrısı yetkisi eklenmedi.

189 test geçti. Yeni regresyonlar: altı işlem koşulunun ayrı ayrı eksikliği, ekran okuma isteğinin olmaması/negasyonu, farklı metal ve bariyerli ekranın bağımsız fiyata etkisizliği, model mesajında ekran koşullarının gizlenmesi, sohbet devamı, adı verilmemiş müşteri dosyasının reddi ve çoklu müşteri eşleşmesinde dosyanın okunmaması. ESLint ve üretim derlemesi başarılı. `f381f89` canlı kabulünde iki mesaj: kısmi gümüş put isteği eksik koşulları sordu; tamamlanan satış/10 ons/strike/vade bilgileriyle açık altın ekranından bağımsız doğru gümüş fiyatını verdi.

## Call / put karşılaştırması ve güncel pozisyon K/Z — 4 Ekim

Ana fiyatlamada call ve put aynı işlem miktarı, strike, vade, müşteri yönü ve terminal veri paketiyle yan yana gösterilir. Her kartta USD toplam prim ve spot nominali yüzdesi aynı boyuttadır. Kart seçimi risk/analiz/kayıt için geçerli işlem tipini değiştirir; fiyat kartı seçmek kayıt oluşturmaz. Bariyer seçimi her iki fiyata uygulanır.

Pozisyon listesinde, müşteri özeti ve müşteri işlemlerinde bugünkü endikatif model değerleri gösterilir. Prim hariç pozisyon değeri müşteri alışında pozitif, satışında negatif; giriş nakit akışı alışta eksi, satışta artıdır. Güncel gerçekleşmemiş K/Z bu ikisinin toplamıdır. Eski `currentPremium`, `mtm`, `pnl` alanları aktif değerleme kaynağı değildir. Bugünkü İstanbul tarihi ve ACT/365 kullanılır; metal başına tek terminal snapshot okunur. Yeni zincir indirmesi veya finansal kayıt yazımı yapılmaz.

Vadesi gelmiş ama sonuçlanmamış kayıtta vade spotu istenir; bugünkü spotla settlement uydurulmaz. Sonuçlanmış kayıt yeniden değerlenmez. Bariyerli kayıtta geçmiş gözlem eksikliği sayıyla doldurulmaz. Spot/IV eksik veya eğri kapsamı dışında ise değer ve K/Z boş, gerekçe görünür; eksik satır varsa tam portföy toplamı verilmez. Değerleme ve yüzey tarihleri, eski spot/yüzey uyarıları görünür.

197 otomatik test: müşteri alış/satış işaretleri, tarihî primin korunması, spot değişiminin K/Z etkisi, eksik/geçersiz veride sahte sıfır olmaması, kapanmış/vadesi gelmiş/bariyerli kayıtlar, eksik portföy toplamı, kaynak tarihleri ve metal başına tek okuma. Strike verilmemiş hedef prim isteği farklı metal/miktar/manüel ekranından bağımsız çalıştırıldı; hedef toleransında bulunan strike doğrulandı. Tarayıcıda aynı kayıt için liste K/Z'si ve pozisyon analizinin bugünkü hücresi eşleşti; müşteri özeti iki aktif işlemin toplamıyla eşleşti. Gemini kotası bu otomatik testlerde kullanılmaz.

`d65dd95` Vercel Preview Ready ve canlı müşteri K/Z ekranı doğrulandı. Canlı hedef prim kabulünün ilk denemesi Gemini bağlantı hatasıyla sonuçlandı, fiyat kartı oluşmadı. Vercel kaydı isteği 6,6 saniye ve iki `generateContent` çağrısıyla gösterdi; bu kabul henüz başarılı sayılmaz. Hata ayrıntısını istemciye veya loglara sızdırmadan sonraki teşhis için yalnız model, durum kodu, çağrı ve tekrar sayısı sunucu loguna eklendi. Bu değişiklik fiyatlama yolunu, model seçimini veya tekrar limitini değiştirmez.

`a314f1d` teşhis yayını üzerindeki tek tekrar da başarısızdı: ikinci sağlayıcı çağrısı 400, ortak tekrar sayısı 1. ANY onarım isteği ayrı küçük tanıda da 400 döndü; sayısal enumu kaldırmak, native şema ve parametresiz araç düzenlemeleri tek başına ANY hatasını gidermedi. Bu hatanın kesin sağlayıcı iç nedeni bilinmiyor. ANY kullanılmıyor; tek onarım tekrarında VALIDATED korunur, şemaya uyma ve eksik bilgi varsa soru sorma talimatı eklenir. Araçlar native Gemini parametre şemasıyla sunulur; gün bazı, ek alanlar, miktar ve veri kuralları yine sunucuda denetlenir.

Düzeltme sonrası gerçek Gemini + gerçek terminal verisiyle uçtan uca kabul geçti: açık ekran XAU/Call/Long/250 ons/strike999/başka vade iken istek XAG/Put/Short/10 ons/2027-01-02/spot nominali %5. İki model çağrısı, tek find_options, 67 terminal hesabı; araştırma yok. Bulunan strike 58,46711247; birim prim 3,01845659 USD, toplam 30,18456587 USD, spot nominali %4,99984527; hata -0,00015473 yüzde puan, tolerans 0,0005. Yüzey tarihi 2026-10-01 ve üç günlük veri uyarısı kartta korundu. Kaynak ve tarihleri olan endikatif proxy kullanıldı; banka kotasyonu iddiası yok. 198 test, lint ve üretim derlemesi geçti. Başarılı kabul önceki iki canlı başarısızlığı gizlemez.

## Sunum kabulü ve kullanıcı isteğiyle kayıt temizliği — 4 Ekim

Kullanıcı vadesi geçmiş eski işlemlerin doğrudan silinmesini istedi. Turso'da 5 kaydın 3'ü 4 Ekim'den önce vadeye gelmişti; tamamı yerel geri alma yedeği alındıktan sonra tek transaction içinde silindi. Kayıt değişmişse veya silme sayısı uyuşmazsa bütün transaction geri alınır. İleri vadeli 2 kayıt aynı değerlerle korundu; müşteriler ve teminatlara dokunulmadı. İşlem silme olayları geçmişe kaydedildi. Canlı pozisyon listesinde 2 açık işlem ve tam değerleme toplamı doğrulandı. Finansal kayıtların yedeği ve müşteri bilgileri Git'e eklenmedi.

`scripts/eval-assistant-presentation.ts --live` gerçek yerel üretim API'si, mevcut Turso verisi ve Gemini ile dört ölçülebilir kabul çalıştırır. Sonuç `ASSISTANT_PRESENTATION_ACCEPTANCE.json`: bütün vakalar geçti, toplam **5 model çağrısı**. Altın ekranından adıyla istenen müşteri dosyası + bugünkü K/Z (3 çağrı); iki bacaklı put koruması, tarihî giriş primi, prim maliyeti, azalan azami kayıp, birleşik fiyat/tarih ve delta/gamma haritası, Avrupa tipi sözleşmenin sürmesi (2 çağrı); manuel piyasa girdisi reddi ve genel fiyat isteğinde eksik koşulları sorma (0+0 çağrı). Sayısal sonuçlar model metnine göre değil motor/gerçek giriş primi ve gerçek araç çıktılarıyla karşılaştırıldı. Rapora isim, kimlik, mesaj, cookie veya anahtar kaydedilmedi. Kabul testi finansal kayıtlara yazmadı ve Databento/veri yenilemesi çalıştırmadı. ESLint ve TypeScript kontrolü geçti.

Erişim kodu sunum kotası için mevcut ayrı kapıdır; API anahtarı değildir. Cookie sekiz saat geçerli. Kaldırılmadı; kullanıcıya yerel kod dosyası açıldı. Bu tur otomasyon dosyası, main branch veya Meridian değiştirilmedi. Uzak main yeniden okunarak mevcut Pazartesi–Cumartesi 12:00 UTC eski yüzey yenilemesinin kodu doğrulandı; bunun çalışma durumu/run logları bu kabulde denetlenmedi. Yeni `pricing_bundle_v2:latest` verisini beraber güncelleyen akış Bloomberg branch'inde olduğundan, mevcut main zamanlanmış işi yeni paketi otomatik güncellemez. Yeni akışın default branch'e alınması henüz yapılmadı; kullanıcıya bu ayrım açıklandı.
