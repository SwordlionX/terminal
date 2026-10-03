# Terminal asistanı — bağımsız son inceleme

**Sonuç: Tam koşudan 7 PASS ve düzeltme sonrası ayrı E10 tekrarından PASS; sekiz temel vakanın kabul ölçütleri bu iki kayıt birlikte değerlendirildiğinde karşılandı.** Tam koşudaki E10 dil hatası geçmişte korunuyor; geriye dönük başarılı sayılmıyor. Bu sonuç bütün 24 vaka, tüm ifade biçimleri veya finansal kalibrasyon için onay değildir.

- İnceleyen: Astra; kaynak ve kayıtlar bağımsız, salt okunur incelendi. Bu inceleme yeni API/model çağrısı yapmadı ve ortam sırlarını okumadı.
- Kaynak kayıt: `docs/ASSISTANT_FINAL_LIVE_EVAL.json`.
- E10 düzeltme sonrası ayrı kayıt: `docs/ASSISTANT_FINAL_LIVE_EVAL_RETEST.json`; başlangıç `2026-10-03T17:37:50.162Z`, aynı Lite modeli, iki kullanıcı turu ve dört gerçek sağlayıcı çağrısı. Bu tekrar panelin yerel model ayarıyla çalıştırılmıştır.
- Koşu başlangıcı: `2026-10-03T17:33:25.920Z`.
- İstenen ve sağlayıcı yanıtlarında görülen model: `gemini-3.5-flash-lite`.
- Gerçek kapsam: **8 vaka, 11 kullanıcı turu, 21 sağlayıcı isteği**.
- Bu koşuda ekran miktarı 100 ons; kullanıcı talebi XAU için 10, XAG için 20 ons. Kartların bu açık talebe uyduğu bağımsız kontrol edildi.
- Araç çağırma modu `VALIDATED`. Bir `MALFORMED_FUNCTION_CALL` yanıtı yürütülmeden atılmış, paylaşılan tek yeniden deneme bütçesi içinde tekrar denenerek ilgili tur tamamlanmıştır. Servis hatasızlığı sonucu çıkarılamaz.
- Değerlendirme çağrıları arasında en az 5 saniye bekletildi. Bu, panelin normal kullanımındaki kapasite veya gecikme garantisi değildir.
- Kaynak veriler: Terminal servislerinin XAU/XAG spotları ve `2026-10-02 CME settlement` tarihli mevcut yüzeyler. Geçmiş primli hedge vakasındaki müşteri ve giriş primi varsayımsal test bilgisidir; gerçek müşteri işlemi değildir.

## Vaka sonuçları

| Vaka | Sonuç | İncelenen kanıt |
| --- | --- | --- |
| E01 — XAU müşteri put satışı | PASS | `Put/Short`, 10 ons, ekranın strike/vade/gün bazı korunuyor. Kart terminal XAU spotunu kullanıyor; tahsilat yönü ve toplam prim tutarlı. |
| E24 — XAU'dan XAG'a geçiş | PASS | İkinci tur `XAG/Call/Long`, 20 ons ve kullanıcının verdiği XAG strike/vadesi kullanılıyor. XAG spotu 60.371; önceki XAU spotu taşınmıyor. Bu alt test, E24'ün desteklenmeyen USDTRY devam sorusunu içermiyor. |
| E03 — yüzde bazını netleştirme | PASS | İlk turda araç çağrısı ve kart yok; spot veya kullanım fiyatı bazını soruyor. İkinci tur `pct_spot`, hedef 5. Sonuç yüzde 5.0001156276; 0.0005 toleransı içinde. Metin bu kez tam eşitlik iddia etmiyor. |
| E04 — toplam USD hedefi | PASS | `total_usd`, hedef 1458.59, miktar 10 ons. Adaylar 1458.6130446 ve 1458.5054236 USD; ikisi de 0.145859 USD toleransı içinde. Toplam tutar birim prime karıştırılmıyor. |
| E05 — ulaşılamayan hedef | PASS | Kullanıcının strike aralığı araç girdisinde korunuyor. `reached=false`, aday listesi boş; metin en yakın sonucu da başarı saymıyor. |
| E10 — hedge ve tarihî prim | PASS — ayrı tekrar | Tam koşunun ilk turundaki “net prim maliyetini azaltmakta” ifadesi FAIL olarak korunur. Nakit akışı talimatı düzeltildikten sonraki ayrı tekrarda ek prim maliyeti doğru açıklanıyor; ikinci tur açıkça net tahsilatın azaldığını belirtiyor. Geçmiş 10 USD/ons primi yalnız short bacaklara, yeni long bacak maliyeti güncel model primine doğru eşleniyor. |
| E12/E13 — manuel piyasa varsayımları | PASS | Spot/IV/faiz/kira değişikliği reddediliyor ve eğri tutarlılığı gerekçesi veriliyor. Bu koşuda bunun yerine terminalin otomatik verisiyle 10 ons kartı üretilmiş; metin alternatifin terminal verisine dayandığını açıkça ayırıyor. Orijinal politika bunu yasaklamaz; sıfır kart zorunlu değildir. |
| E22 — mevcut bariyer ve eksik geçmiş | PASS | Geçmiş bariyer gözlemi olmadan kapanış fiyatı üretilmiyor. Model değeri kesin banka kapanış kotasyonu gibi sunulmuyor; emir veya kapanış yapıldığı iddia edilmiyor. |

## Bağımsız sayısal kontrol

Kaydedilmiş çıktılar üzerinde 16 kotasyon görünümü, üç hedef araması ve 84 senaryo noktası yeniden kontrol edildi. Kotasyon sayısı, aramadaki aday/en yakın sonuç tekrarlarını içerir. Bu kontrollerde hata bulunmadı:

- Toplam prim = birim prim × miktar; Short tahsilatı pozitif, Long ödemesi negatif.
- Ekran miktarı 100 olsa da tüm ilgili XAU kartları 10 ons, XAG alım kartı 20 ons kullanıyor.
- Delta nötr hedge miktarı = −delta; manuel volatilite veya manuel fiyat kaynağına geçiş yok.
- Adayın gerçekleşen primi karttan yeniden türetildi; hedef farkı ilan edilen tolerans içinde.
- Her vade sonu senaryo noktası, bacakların yönü, içsel değeri, miktarı ve uygun giriş primi kullanılarak yeniden hesaplandı.
- Senaryo spotları, −%20 ile +%20 arasında iki puanlık adımlarla ilerliyor. Bu tarama aralığı teorik azami zarar hesabı olarak yorumlanmadı.

Canlı değerlendirme scriptinin mevcut motorla fiyat eşleşmesi kontrolleri de geçti. Bağımsız incelemede yüzey kalibrasyonu veya dış piyasa kotasyonu yeniden oluşturulmadı; burada doğrulanan şey kayıtlı motor çıktılarının aritmetiği ve isteklerle eşleşmesidir.

Tam koşudaki E10 dil hatasının sayısal kanıtı: short put tek başına 1458.5903509 USD model tahsilatı üretirken, 350.9927237 USD long put primi eklenince net model tahsilatı 1107.5976272 USD olur. Koruma maliyeti ortaya çıkar; maliyetin azaldığı söylenemez. Ayrı tekrarda bu açıklama düzelmiştir: ek prim maliyeti ve net tahsilat azalması doğru yönde anlatılır. Tekrarın ayrıca 84 senaryo noktası geçmiş prim ayrımıyla yeniden hesaplandı; hata bulunmadı. Sayısal kartların doğru olması, ilk koşudaki yanlış metni geçerli kılmaz.

## Kaynak düzeltmelerinin incelemesi

`assertPremiumBasis` yüzde aramasında modelin tek başına baz seçmesini engellemek için kullanıcı metnini kontrol ediyor. Belirsizlik, reddetme, soru ve mevcut baz düzeltmesi için bildirilen örnekler kaynakta ve regresyonlarda karşılandı. Son ek düzeltme, `spotun` gibi tanınan biçimlerin negatif ifade kontrolünü atlamasını ve nominal baz sorularının seçim sayılmasını kapatıyor.

Geçmiş kullanıcı metni, sunucunun doğruladığı şifreli sohbet içeriğinden çıkarılıyor. Model yanıtları ve araç cevapları kullanıcı baz seçimi olarak kullanılmıyor. Bu kural tabanlı dil kontrolü bütün Türkçe ifade biçimlerini kapsadığı iddiasını taşımaz; diğer prim birimlerinin niyetle eşleşmesi de ayrıca değerlendirme konusu olmaya devam eder.

Risk talimatları, short putun sonlu kaybını, korumasız short callun teorik sınırsız yukarı riskini, hedge'in kapsamını ve hedef toleransını doğru ayırıyor. Önceki baz varsayımı ve sınırsız short put kaybı hataları son tam koşuda görülmedi. Bu koşudaki prim maliyeti hatası ise ayrı E10 tekrarında giderilmiş olarak gözlendi. Tekrar, tüm dil varyasyonlarının sürekli doğru olacağını kanıtlamaz.

Miktar alanı ortak araç şemasında zorunlu. Tek opsiyon fiyatında, hedef aramasında ve tek bacaklı stratejide sunucu kontrolü eksik miktarı veya tek açık kullanıcı miktarıyla uyuşmayan 1/100 gibi değerleri engelliyor. Çok bacaklı stratejilerde modelin farklı hedge oranları seçebilmesi için yalnız miktar alanının zorunluluğu korunuyor; bütün bacaklar tek kullanıcı miktarına zorlanmıyor. Bu tasarım her bacağın miktarını kullanıcı niyetiyle bağımsız doğrulamıyor. Negasyon, çoklu ayraç ve tüm Türkçe ifadeler için tam dil çözümlemesi yoktur; sekiz vaka bunların genel garantisi değildir.

## Gerçek panel kontrolü

Ana çalışma tarafından ek gerçek sağlayıcı tekrarı da yapıldı: `ASSISTANT_PANEL_PROVIDER_PROBE.json` ekran miktarı 100/strike 3700/vade 2027-01-01 ile iki isteği, dört gerçek Lite çağrısıyla geçti. Açık miktar/strike/vade değişikliği ve yalnız miktar değişikliği ayrı denendi. Bu yeni kayıt ilk başarısız probe'u geriye dönük başarılı saymaz.

Ana ajanın tarayıcı/DOM kontrolünde aktif ekran 100 ons, strike 3700 ve 2027-01-01 vade iken kullanıcı 10 ons, strike 4137.53 ve 2026-12-28 istedi. Sonuç kartında miktar, strike ve vade bu talebe uydu. `../assistant-gercek-fiyat.png` bağımsız görsel olarak da incelendi: başlıkta 100 ons ekran bağlamı sürerken kart 10 ons, 4137.5300 strike, 2026-12-28 vade, 145.8590 USD/ons ve 1458.59 USD toplam primi gösteriyor. Böylece açık kullanıcı işlem koşulunun ekran varsayılanını geçmesi bu gerçek panel örneğinde de gözlendi. Ana ajanın etkileşim kontrolü ile bağımsız ekran incelemesi ayrı kanıtlardır.

## Önceki koşular ve kararın sınırı

- `docs/ASSISTANT_FINAL_LIVE_EVAL_INITIAL.json` başarısız geçmiş olarak korunur. İlk koşuda E03 baz varsayımı yaptı; E10 sayısal kontrolü geçmesine rağmen risk dilinde yanlış sınırsız kayıp ifadesi kullandı. Manuel vaka için önceki sıfır kart şartı orijinal politikadan daha katıydı; bunun açıklanması ilk koşuyu bütünüyle başarılı yapmaz.
- `docs/ASSISTANT_FINAL_LIVE_EVAL_SECOND.json` başarısız/eksik geçmiş olarak korunur; E01 ve E05 tamamlanmadı. Sonraki başarı bu kesintileri veya yanıt kararlılığı sınırlamasını ortadan kaldırmaz.
- `docs/ASSISTANT_FINAL_FLASH_EVAL.json` içindeki Flash 3.5 servis hataları başarılı kalite testi sayılmaz. Lite başarısı Flash başarısı olarak aktarılamaz.
- `docs/ASSISTANT_FINAL_LIVE_EVAL_AUTO.json` önceki AUTO modunda sekiz alt vakanın geçtiği kaydı korur. O koşuda ekran ve talep miktarı aynıydı; daha sonra gerçek panelde bulunan miktar önceliği hatasını ölçmemişti. Önceki geçiş, yeni koşunun E10 hatasını kapatmaz.
- `docs/ASSISTANT_PANEL_PROVIDER_PROBE_INITIAL.json` panelde görülen yanlış miktar ve servis davranışı kanıtını korur; sonradan başarılı koşularla geriye dönük başarı olarak etiketlenmemelidir.
- Lite mevcut test edilen modeldir; bu modelle yedi vakanın tam koşudaki geçişi, düzeltme sonrası E10 geçişi ve gerçek panelde miktar önceliği örneği birlikte desteklenmiştir. Tam koşudaki E10 FAIL kaydı değişmez. Bu kanıt paneli test edilmiş modelle eşleştirmek için makuldür; tam 24-vaka geçişi veya kesintisiz hizmet sertifikası değildir.
- Bilinen faiz/kira denetim bulguları ve kalibrasyon belirsizliği sürer. Motor aktarımı ve sayısal eşleşmeler geçmiştir; oranların veya yüzeyin bağımsız piyasa doğruluğu onaylanmamıştır.

Bu inceleme kaynak JSON raporlarının durumlarını değiştirmedi. Tam koşunun 7 PASS / E10 FAIL kararı ile düzeltme sonrası ayrı E10 PASS kararı bu belgede birlikte kayıtlıdır.
