# 11–12 ve fiyatlama ekranı — kontrol notu

2 Ekim 2026. Değişiklikler `codex/terminal-audit-stage3` test branch'inde; ana siteye birleştirme yapılmadı.

## Yapılanlar

- Amerikan prim → Amerikan model IV → Avrupa tipi ana fiyatlama yolu korundu. Düşük volatilitede geçersiz CRR olasılığı oluşursa Avrupa fiyatına düşmek yerine risk-nötr, yeniden birleşen ağaç kullanılır. Erken kullanım ve Avrupa alt sınırları korunur.
- Sıfır volatilitede Avrupa modeli iskontolu forward içsel değerini, Amerikan modeli deterministik erken kullanım zamanlarını hesaplar. Negatif faizli call için hatalı Avrupa kısayolu kaldırıldı.
- IV çözücüleri sonlu girdi, fiyat sınırı, çözüm aralığı ve yeniden fiyatlama hatasını denetler. Başarısız sonuç artık başarılı IV gibi kullanılamaz.
- Yeterli ve tutarlı veride tüm strike eğrisi aynı kısıtlı SSVI uyumundan gelir. Gözlemlenen noktalar grafikte ayrı kalır. Kote aralık dışında sınırlı model uzatması vardır; uyum başarısızsa kanat üretilmez.
- Vadeler arasında toplam varyans enterpolasyonu ve sorgu noktasında takvim tutarlılığı kontrolü; kote vadeler dışında otomatik uzun-vade uzatması yok. Yüzeyin gün sayıları seçilen değerleme tarihine göre yaşlandırılır.
- Fiyatlamada gün bazı forward hesabıyla tutarlı. Geçersiz tarih, sıfır kontrat, sonlu olmayan girdiler veya taşan model sonuçlarında prim/Greeks/pozisyon/senaryo/kayıt bloke edilir.
- Yeni koyu/cyan palet, markalı ve gruplanmış menü, veri bağlamı kartları ve belirgin Call/Put model primleri. Mevcut rota ve kayıt akışları korundu.
- Manuel IV modunda smile yalnız referans diye etiketlenir. Bariyer yardımcı smile sorgularında model uzatması kullanımı görünür.
- Gemini planı `GEMINI_ASSISTANT_PLAN.md` içinde; çalışan API bağlantısı veya ücretli çağrı eklenmedi.

## Doğrulama

- `npm test`: 82/82 test geçti.
- Yeni testler: Amerikan/Avrupa fiyat ve IV sınırları, düşük vol/carry, negatif faiz, farklı çözünürlüklü Amerikan COMEX settlement → CME yüzeyi, SSVI uyum/kanat sürekliliği ve yoğun fiyat ızgarasında konvekslik, vade/tarih/taşma kontrolleri, manuel grafik ve bariyer veri kökeni uyarısı.
- Değişen TypeScript ve test dosyalarında ESLint temiz.
- Üretim derlemesi ve strict uygulama type-check kontrolü geçti; kökteki kullanıcıya ait deneysel `test_*.ts` dosyaları değiştirilmedi ve üretim derlemesine dahil değildir.
- Tarayıcıda yerel manuel fiyatlama, sıfır faiz kabulü, sıfır kontratta çıktının/kaydın engellenmesi ve 1280 px görünümde yatay taşma kontrol edildi.

## Sınırlar ve sonraki adım

- Canlı preview Vercel hesap girişi istiyor. Yerelde Turso ortam ayarları yok. Bu turda gerçek müşteri kayıt/kapanış akışına veya veri tabanına yazılmadı. Doğrudan canlı piyasa GET kontrolü yetkisiz oturumda 401 döndü; gerçek güncel yüzeyle yeni SSVI uyumu bu turda doğrulanamadı.
- SSVI için tek-vade yeterli butterfly koşulları uygulanır. Sorgu noktasındaki takvim kontrolü tüm yüzeyin global arbitrajsızlığını ispatlamaz. Ham/interpolasyon fallback'i için ayrıca global garanti yok.
- Fit kabul sınırları: IV RMSE 0.008 (0.8 vol puanı), maksimum 0.02 (2 vol puanı); model kotelerin aynısı değil, hata grafikte gösterilir. Kanat en yakın gözlemlenen uçtan 0.22 log-moneyness uzaklığıyla sınırlı.
- Değerleme tarihine yaşlandırma yeni veri üretmez; eski yüzeyin veri tarihi görünür kalır. Güncel IV değişimini doğrulamak için yeni settlement gerekir.
- IV ters çözümü, yeni yüzey oluşturulurken etkili olur. Önceden veritabanında saklanmış IV'ler kod değişince kendiliğinden yeniden hesaplanmaz; üretime geçiş ve normal CME yenilemesi sonrasında kontrol edilmelidir.
- CME kira çıkarımındaki opsiyon/futures vade ekseni konusu bu 11–12 paketinde yeniden tasarlanmadı; bunu tüm carry modelinin doğrulanması gibi yorumlamamak gerekir.
- Önceki yenileme takibi değişikliklerinin workflow kısmı üretim `main` ile uyumlu yayınlanmalı. Preview üretim CME dispatch'ini başlatmaz.
- Tasarımın tüm müşteri/hisse ekranları yeniden yapılmadı; bu aşama çerçeve, menü ve ana fiyatlama ekranıdır. Mobil etkileşim ve canlı tüm kullanıcı akışlarının uçtan uca tamamlandığı iddia edilmez.
