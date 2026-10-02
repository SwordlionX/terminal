# Terminal asistanı — uygulama planı

Durum: Planlama. Henüz Gemini bağlantısı, API anahtarı, ücretli çağrı veya müşteri verisi aktarımı yok.

## Kullanım ve ekran

- Masaüstünde sağdan açılan yaklaşık 400 px panel; küçük ekranda tam ekran. Paneli açmak veya yazı yazmak çağrı yapmaz. Yalnız Gönder ile çalışır.
- Başlangıç örnekleri: “90 gün vadeli, ons başına 12 USD primli put bul”, “Bariyeri 28 USD üzerinde olan gümüş alternatiflerini karşılaştır”, “Gümüş için kaynaklı kısa piyasa özeti”.
- Sonuç kartı: ürün, yön, opsiyon tipi, strike, bariyer tipi/seviyesi, tarih/gün bazı, prim/ons ve toplam prim, hedefe fark, kullanılan IV'nin gözlem/model/uzatma durumu ve veri tarihi.
- Forma uygula yalnız kullanıcı tıklayınca girdileri doldurur. Emir, kayıt, müşteri değişikliği veya kapanış yapmaz. Kaydetme mevcut manuel onay akışında kalır.

## Fiyatı model değil, mevcut motor hesaplar

Gemini isteği yorumlar ve tipli araç çağrısı üretir; tüm sayısal fiyatlar aynı deterministik fiyatlama motorundan gelir. Gemini'nin kendi yazdığı rakam geçerli kotasyon sayılmaz.

1. `get_market_context`: önbellekteki CME yüzeyi, spot, fiyatlama varsayımları ve tarihleri. Yeni veri çekmeyi tetiklemez.
2. `price_option`: doğrulanmış ürün, tarihler, gün bazı, faiz/kira, tip ve tutarla motoru çalıştırır. Geçersiz veya fiyatlanamayan istek açık hata döndürür.
3. `find_candidates`: hedef primin birimini (USD/ons, toplam USD veya strike yüzdesi), Long/Short ve Call/Put yönünü netleştirir. Sonlu strike/bariyer aralığında sınırlı tarama ve kök araması yapar. Hedef toleransını ve çözüm bulunamadığını açıkça raporlar; tek kök veya monotonluk varsaymaz.
4. `market_briefing`: yalnız açık piyasa araştırması isteğinde devreye girer; 3–5 tarihli bağlantı ve kısa özet. Haber metni talimat değil veridir. Gelecek yönü kesinmiş gibi sunulmaz.

“Bariyeri maksimum şurada” isteği için önce up/down, in/out, spot gözlemi ve izleme dönemi belirlenir. Long/Short ticari yön, Call/Put opsiyon tipi ve bariyer yönü birbirine karıştırılmaz. Veri dışı SSVI uzatmasına izin açık görünür; çözümsüz istek için sayı uydurulmaz.

## Tasarruf ve güvenlik

- İlk sürümde hafif model; model adı ve fiyatı uygulama anında resmi belgelerden doğrulanacak. Zor isteklerde otomatik pahalı modele geçiş yok.
- Uygulama önbelleği: fiyatlama yüzeyi zaten mevcut veri akışından; aynı snapshot + aynı normalize parametre için sonuç tekrar kullanılır. Yeni snapshot otomatik cache anahtarını değiştirir.
- Piyasa özeti ürün + kapsam bazında önerilen 30 dakika önbellek; kaynak tarihleri görünür. Eski özet yenisi gibi sunulmaz.
- Tek mesaj için en fazla 3 araç turu, sınırlı aday sayısı ve süre; tekrar denemeler sınırlı, aynı istekte tek yürütme. Sayısal tarama her aday için Gemini çağırmaz.
- Günlük kullanıcı isteği, token ve toplam bütçe sınırları sunucuda uygulanır. Bütçe bitince net uyarı; gizli aşım veya sürekli arka plan araştırması yok. İptal düğmesi mevcut isteği durdurur.
- Anahtar yalnız sunucu ortam değişkeninde, `NEXT_PUBLIC_` alanında değil. İstek günlüklerinde anahtar, müşteri adı veya müşteri pozisyonları tutulmaz.
- İlk sürüm anonim piyasa/fiyatlama girdileriyle çalışır; müşteri verisi erişimi yok. İleride müşteri bağlamı istenirse ayrıca erişim kontrolü ve veri aktarım onayı gerekir.
- PIN koruması kaldırılmış terminale ücretli ve müşteri bağlantılı chatbot eklenmeden önce ayrı asistan erişimi/rate limit zorunlu; açık URL'ye sınırsız ücretli uç nokta bağlanmaz.

## Abonelik farkı

Google AI Pro/Plus, Gemini uygulamasındaki hakları belirler. Harici terminalin Gemini API kullanımı ayrı proje/anahtar, kota ve faturalandırma üzerinden yönetilir. Pro aboneliği sınırsız veya otomatik ücretsiz terminal API'si anlamına gelmez. Uygun geliştirici kredileri varsa ayrıca hesap üzerinden doğrulanır; bütçeye varmış gibi yazılmaz.

Resmi kaynaklar (2 Ekim 2026 kontrolü):
- https://ai.google.dev/gemini-api/docs/google-ai-plans
- https://ai.google.dev/gemini-api/docs/function-calling
- https://ai.google.dev/gemini-api/docs/billing
- https://support.google.com/gemini/answer/16275805?hl=en

## Aşamalı teslim

1. Anahtar olmadan deterministik araç sözleşmeleri ve hedef prim araması; birim, sınır, tolerans ve yanıltıcı veri testleri.
2. Gemini sunucu bağlantısı, maliyet tavanı ve panel; sadece fiyatlama use case'i.
3. İsteğe bağlı kaynaklı piyasa özeti, cache ve hata/kota durumları.
4. Güvenlik ve canlı küçük bütçe denemesi; ancak ondan sonra müşteri bağlamı konusu.

Kabul testleri: aynı girdiye aynı motor fiyatı; belirsiz birimde açıklama isteme; hedef ulaşılamazsa dürüst cevap; bariyer kısıtına uymayan adayı eleme; eski CME tarihini gösterme; yinelenen istekte yeni dış çağrı yapmama; panel açılışında sıfır çağrı; kota/iptal/key hatasında kullanılabilir ekran; haber içindeki talimatı yürütmeme; hiçbir otomatik kayıt/kapanış.
