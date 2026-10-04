# Terminal X çalışma alanları — 4 Ekim 2026

Pozisyonlar ve Risk/Teminat görselleri kullanıcı tarafından onaylandı; aşağıdaki düzen Bloomberg branch'inde gerçek uygulamaya geçirildi. Meridian geliştirmesi kullanıcının isteğiyle durduruldu; son sidebar ve bariyer bağlantısı değişiklikleri Meridian'a taşınmadı. İki tasarımın fiyatlama motoru aynı doğrulanmış veri paketini kullanır.

| Alan | Uygulanan davranış |
| --- | --- |
| Fiyatlama | Sol işlem koşulları, eşit önemle USD ve spot nominali yüzdesi, merkezde prim altında geniş smile, sağda müşteri Greeks özeti. Hedef prim, bariyer ve delta hedge ortak ürün/strike/miktar/vadeyi korur. Hedef prim mevcut eğride strike arar; IV uydurmaz. |
| Pozisyonlar | Arama, açık/yaklaşan/arşiv filtreleri; sekiz kayda kadar seçim, kayıtlı giriş primiyle birleşik K/Z, fiyat×tarih ve delta/gamma haritası. Geçersiz, bariyer geçmişi eksik, vadesi geçmiş veya farklı metal kayıtları sessizce modele alınmaz. |
| Müşteriler | Sol müşteri listesi + sağ dosya; özet, işlemler, teminat, notlar/hareketler. Mevcut kayıt ve teminat işlemleri korunur; açık pozisyonun saklanan sıfır K/Z'si güncel model değeri gibi gösterilmez. |
| Risk ve Teminat | Gerekli ek teminat, öncelikli müşteri dosyaları, yaklaşan/geçmiş vadeler, ayrıntılı risk listesi. Şube teminat prosedürü ve model MTM ayrıdır. Eksik/eski kaynak görünür; fallback sonucu yeşil güvenli etiketiyle gizlenmez. |
| Eğriler ve Veri | Geniş smile/vade görünümü; USD iskonto, metal taşıma oranı ve model forward tablosu/grafiği. Spot ve yüzeyin ayrı zamanları, final seans ve yöntem sınırları görünür. Veri yönetimi ayrı bağlantıyla erişilir. |

## Asistan bağlantısı

Sağ altta sabit asistan düğmesi; masaüstünde sağda açılan panel, dar ekranda tam ekran panel. Konuşma panel kapatılınca kaybolmaz. Ekrandaki soru düğmeleri mesajı hazırlar; kullanıcının gönderimi olmadan Gemini çağrısı yapılmaz. `price_selected_option`, yeni fiyatlama ekranındaki koşulları bariyer dahil değiştirmeden okur; farklı koşullar için `price_option` kullanılır. Bozuk model komutu yürütülmez; ortak tek tekrar hakkıyla onarılır.

İstemci yalnız seçili müşteri/işlem kimliklerini gönderir. Sunucu kayıtların varlığını ve müşteri sahipliğini denetleyip geçmiş primi ve işlem koşullarını veritabanından okur. `get_workspace_context` dosya ve kaynak uyarılarını getirir; `analyze_selected_position` gerçek giriş primini koruyan ortak analiz motorunu çalıştırır. Sohbet devamı seçim ve işlem koşullarına bağlanır; başka müşteri seçilince eski model bağlamı taşınmaz. Asistan kayıt/emir/teminat çağrısı yazamaz.

Yalnız XAU/XAG. Her fiyat, prim, Greeks ve senaryo Terminal X motorundan gelir. Manuel spot/faiz/kira/IV ile hesap yapılmaz: manuel varsayımlar eğri–fiyat tutarlılığını bozar. Araştırma yalnız yöntem/veri tutarsızlığı içindir; fiyat kaynağı olamaz.

## Avrupa tipi işlemler

Vade öncesi kullanım veya otomatik kapatma yoktur. Hedge/ters işlem/yeni vade yeni bacaklardır, eski sözleşme yükümlülüğünü kaldırmaz. Vade sonucunun kaydedilmesi hem arayüzde hem sunucuda vade tarihine bağlıdır. Eski `/archive`, `/dashboard` ve müşteri teminat URL'leri gerçek alanlara bağlanır. BIST ekranı korunur, metal ana menüsüne eklenmez.

## Tasarım ve kaynaklar

Bloomberg: grafit/siyah, amber sayılar, ince çizgiler, dikdörtgen kontroller. Sol menü masaüstünde daraltılabilir; mobilde çekmece açılır ve içerik tek sütuna iner. Ana fiyatlamada bariyer seçeneği bulunur; hedef prim, pozisyon analizi ve delta hedge fiyatlama alt menüsündedir. Müşteri işlemleri ortak tablo düzenine geçirildi; USD prim ve yüzdesi yan yana görünür. Meridian'ın açık zemin ve mor vurgu tasarımı mevcut halinde bekler.

Faiz/taşıma/IV onaylanan **endikatif CME/SOFR proxy** paketinden gelir. Banka OIS veya metal kira kotasyonu iddiası yok; ayrıntılar `PRICING_CURVE_PROXY.md` içinde. Yapay sıfır/eski MTM yerine eksik sonuç ve gerekçesi gösterilir.

Üretim asistanı `GEMINI_API_KEY`, `GEMINI_MODEL`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ASSISTANT_ACCESS_CODE` sunucu ortam ayarları gerektirir. Hiçbiri kaynak koduna veya ekran bağlamına konmaz. Yerel ayarlar `.env.local` içinde ve Git dışında tutulur.

## Son karar — açık

İki tasarım ayrı branch'lere pushlanır. Sunum/ana sürüm seçimi, main merge/default branch değişimi ve final settlement workflow'un otomatik etkinleşmesi en son kullanıcıyla kararlaştırılacak. Bu geliştirme main/default branch'i değiştirmez. Ses ve bas-konuş daha sonraki aşamadır.
