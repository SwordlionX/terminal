# Bloomberg ekran yapısı — 4 Ekim 2026 önerisi

Kullanıcı referansı: `tasarim-demolari/01-islem-terminali.png` / `terminal.html`. Yeni çalışma eski sayfa/card hiyerarşisine bağlı olmadan tasarlanacak. Bu belge plan; aşağıdaki sayfa birleşimleri ve asistan yerleşimi henüz uygulanmadı. Bu turdaki ürün düzeltmesi uygulandı: işlem seçenekleri ve asistan araçlarında yalnız XAU/XAG.

## Referansla mevcut uygulamanın farkı

Referansta üst marka/sekme şeridi, solda işlem formu, ortada yan yana USD/yüzde prim ve hemen altında smile, sağda dar risk sütunu var. Uygulama eski Sidebar/Header kabuğunu korudu, smile'ı ayrı alt bölüme taşıdı ve asistanı eski bağımsız panel/yuvarlak butonla bıraktı. Sonuç örneğin bilgi yerleşiminden ayrılıyor. Bunu zorunlu kılan bir teknik engel yok; eski kabuğun yeniden kullanılması uygulama tercihiymiş.

## Önerilen beş çalışma alanı

| Alan | Yeni düzen ve birleşim | Mevcut ekranlar |
| --- | --- | --- |
| Fiyatlama | Ana işlem formu; hedef prim, bariyer ve hedge araçları aynı işleme ait sekmeler/çekmeceler. Araç değiştirince ürün, yön, miktar ve vade bağlamı korunur. | `/`, reverse-engineering, barrier, delta-hedge |
| Pozisyonlar | Üstte aranabilir müşteri/işlem tablosu; açık, yaklaşan vade ve vade sonunda sonuçlanmış işlemler filtreleri. Seçili pozisyon alt alanda birleşik K/Z, fiyat×tarih haritası, delta/gamma ve koruma karşılaştırmasıyla açılır. | trades, archive, position-analysis |
| Müşteriler | Sol liste + sağ müşteri dosyası. Özet, işlemler, teminat ve notlar dosya içi sekmeler; müşteri seçimini sayfa geçişleri kaybettirmez. | customers, customer detail, customer margin |
| Risk ve Teminat | Gerekli ek teminat, yaklaşan vadeler ve işlem gerektiren müşteriler önce; ayrıntılı risk listesi aşağıda. Şube teminat kontrolleri, model Greeks senaryolarıyla karıştırılmaz. | dashboard + margin |
| Eğriler ve Veri | Geniş smile + vade tablosu, seçili strike/vade; spotun ve yüzeyin ayrı kaynak/tarih/durumu, yayınlanan seans ve final bilgisi. Veri eksikliği grafik üzerindeki ilgili bölgede görünür. Yönetim ayarları ayrı çekmece. | settings içindeki veri yönetimi + ana sayfa eğri araçları |

`stock-tracker` BIST hisse takibi olduğundan metal çalışma alanının ana menüsünde yer almayacak. Mevcut veri silinmeyecek; metal arayüzü dışında erişim/koruma kararı uygulama sırasında verilecek. Arşiv bir işlem durumudur; Avrupa tipi işlemin vade öncesi kapatılması olarak sunulmaz. Ters işlem/hedge eski sözleşmeyi feshetmez. Kotasyon geçmişi ile kaydedilmiş müşteri işlemleri farklı veri türleridir; saklanan kotasyon geçmişi altyapısı yokken varmış gibi sekme gösterilmez.

## Görsel kurallar

- Referanstaki grafit/siyah, amber vurgu, ince ayırıcı çizgiler, küçük dikdörtgen kontrol ve hizalı sayısal sütunlar bütün sayfalara uygulanacak. Ayrı renkli dashboard/card kimliği olmayacak.
- Metin hiyerarşisi sakin: büyük sloganlar yerine ekran işlevi; genişlik grafik ve tablolara ayrılacak. USD ve nominal yüzde aynı önemle yan yana görünecek.
- Smile merkezde primin altında, risk sağda; birleştirilmiş tablolardan grafiklere açılan ayrıntı paneli. Boşluk ve yükseklik, bileşenlerin birbirinden bağımsız eski ölçülerinden alınmayacak.
- Pozitif/negatif risk renkleri değerlerin anlamını gösterir. Bekleyen/eski/eksik veri, yeşil "canlı" etiketiyle gösterilmez.
- Dar ekranda liste → ayrıntı; asistan tam ekran açılır. Masaüstünde sağa bağlı yaklaşık 380px panel; grafik çalışma alanını örtmek yerine alan paylaşır.

## Asistan

Örnekteki sağ üst `Asistan ↗` düğmesi ve aynı terminal stilindeki sağ panel kullanılacak. Tek düğme; ikinci yüzen giriş olmayacak. Konuşma, seçili müşteri/pozisyon/fiyatlama bağlamını gösterir. Sonuçlar kısa açıklama + USD/yüzde + ilgili grafik/karşılaştırma kartı olarak görünür. Ekrana uygulama ve pozisyon analizine geçiş açık eylemler olur. Ses/bas-konuş daha sonra; bu tasarım çalışmasında gerçek Gemini çağrısı yapılmaz.

## Uygulama sırası

1. Bu sayfa haritasını temel alıp Pozisyonlar ve Risk ekranlarının kısa görsel örneklerini üret; referansla aynı kabuğu kullan. Tam sayfa dönüşümlerinden önce yerleşimi göster.
2. Bloomberg kabuğu/asistan görünümü; sonra pozisyon/arşiv birleşimi, müşteri dosyası, risk/dashboard birleşimi ve eğri/veri alanı. Eski URL'lere erişim bozulmayacak.
3. Temel akışları ve dar ekranı doğrula; asistan kabul testlerini bütün diğer işler tamamlandıktan sonra sınırlı sayıda yap.

## Son karar listesi — açık kalacak

- USD iskonto eğrisini kurma; metal carry/faktörlerini ve Amerikan kaynak IV yeniden kurulumunu aynı sürüme bağlama. `pricingReady=false` olan Databento girdileri banka kira eğrisi olarak etkinleştirilmeyecek. Eski kira hesabının fiyatlamadaki düzeltmesi tamamlanmış sayılmayacak.
- Bloomberg/Meridian hangi branch'in sunum/ana sürüm olacağına en son karar verilecek. GitHub default branch geçişi/merge ve final settlement workflow'un otomatik çalışması bu karara bağlı. Kullanıcı "en son karar verelim" dedi: bu turda main merge veya default branch değişimi yapılmayacak.

İlgili veri durumu: `docs/DATABENTO_FINAL_CARRY_INPUTS.md`.
