# Asistan tasarım incelemesi — 3 Ekim 2026

Astra kaynak ve görselleri inceledi; Sol UI düzeltmelerini uyguladı. Son kaynak/görsel turunda push'u engelleyen tasarım bulgusu görülmedi. Mevcut lacivert/cyan palet korundu.

## Düzeltilenler

- Bağlantı kontrol edilirken, hazır değilken veya erişim kodu gerekiyorken gönderim UI'da ve gönderim işlevinde engellenir.
- Arama açıklaması yanında ürün, Call/Put ve müşteri yönü sürekli gösterilir. Büyük tutarlar ve dar kartlar taşmadan sarılır.
- Grafikte kompakt para eksenleri SVG dışında sabit 12px metindir; eksi işaretleri korunur. Kesin tutarlar grafiğin altındadır. Risk tablosu yatay kaydırılır ve görünür ipucu vardır.
- Kontroller 44px dokunma hedefi ve belirgin klavye odağı kullanır. Slider, indis yerine spot hareketi ve senaryo spotunu duyurur; dikey dokunmatik kaydırma korunur.
- Kullanıcı geçmişi okurken sohbet aşağı zorlanmaz. Yeni yanıt düğmesi ve azaltılmış hareket desteği vardır. Lazy kart büyümesi yalnız aşağıyı takip eden kullanıcıyı izler.
- Hafif launcher, paneli ilk açılışta yükler; sonuç kartları ayrıca yüklenir. Piyasa store abonelikleri daraltıldı. Sohbet/taslak kapanıp açılınca korunur.
- Forma uygulama paneli kapatır, launcher'a odak döndürür ve görünür bildirim verir.
- Mobil açılışta mevcut sidebar hook'unun server/client farklı HTML üretmesi düzeltildi. `useSyncExternalStore` aynı ilk sunucu görünümünü korur, ardından ekran boyutunu izler; ayrı regresyon testi vardır.

## Görsel ve etkileşim kanıtı

Gerçek yerel tarayıcıda 390px panel ve 375px içerik alanında kart/grafik incelendi. Büyük USD tutarı, negatif eksenler, kart kimliği ve sayfada yatay taşma olmaması kontrol edildi. 320px için yapılan viewport denemesi tarayıcıda 390px kalmıştır; gerçek 320px doğrulaması tamamlandı diye raporlanmaz.

Slider Home tuşuyla yüzde -20 ve ilgili spot duyurusu doğrulandı. Panel odağı içerideydi; öneri seçimi mesaj alanına odaklandı; taslak kapanıp açılınca korundu; kapanış odağı launcher'a döndü. Mobil reload sonrası önceki hydration hata göstergesi kalktı. Sayısal kart/grafik görselleri açıkça etiketlenmiş sentetik tasarım fixture'ıyla üretildi, canlı fiyat doğrulaması değildir. Geçici fixture route'u commit öncesi kaldırıldı.

Gerçek Gemini bağlantısıyla panelden bir yetenek sorusu gönderildi; bekleme, yanıt ve tamamlanma duyurusu görüldü. Fiyatlama veya web araştırması istenmedi; bu kontrol sayısal fiyatlama kanıtı değildir. Yanıttaki “tüm zincir” ve güncellik ifadeleri üzerine talimat, yalnız tanımlı aralıkta arama ve tarih/kaynak doğrulaması yönünde netleştirildi; bu son metin değişikliği ayrıca canlı modelle yeniden denenmedi.

Lazy import ve abonelik değişiklikleri kaynakta doğrulandı; bundle/profiler ile hız artışı yüzdesi ölçülmedi. Faiz/kira kalibrasyonu bu tasarım incelemesinin kapsamında değildir; `RATE_LEASE_AUDIT.md` bulguları geçerlidir.
