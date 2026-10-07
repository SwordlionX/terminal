# CME opsiyon kontrat tanımı eşleştirmesi — 7 Ekim 2026

7 Ekim çalışması futures girdilerini 5 Ekim seansı için kaydetti; XAU fiyatlama paketi kurulurken `Final opsiyon settlement için tanım eksik` nedeniyle durdu. Aktif iki metal paketi yarım veriyle değiştirilmedi.

Opsiyon tanımları daha önce yalnız 00:00–00:15 UTC aralığından alınıyordu. Artık seansın 00:00 UTC başlangıcından ertesi gün 00:00 UTC'ye kadar olan tanımlar ve gün içi güncellemeler okunur. Futures tanım penceresi, final yayın kontrolleri, günlük çalışma saatleri, bütçe ve iki metalin atomik aktivasyonu korunur. [Databento tanımları](https://databento.com/docs/schemas-and-data-formats/instrument-definitions) 24 saatlik seans isteğinin o aralıkta aktif kontratları kapsadığını açıklar.

Tanım/settlement birleştirmesi ayrı test edilebilir modüle taşındı. Gün içi eklemeler ve revizyonlar işlenir, silinmiş tanım geri getirilmez. Gerçekten eşleşmeyen settlement atlanmaz: hata ürün, seans, eksik adet ve en fazla 12 instrument_id içerir. Preliminary, silinmiş veya sentinel fiyatlar yine paketi durdurur.

212 otomatik test, ESLint ve TypeScript geçti. Yeni regresyonlar gece snapshot'ında olmayan strike, gün içi revizyon/silme, eksik kimliklerin sınırlı teşhisi, final/deletion/sentinel ve başka seansın ayrımı.

Gerçek 5 Ekim XAU tanımlarında tam seans 31.652 kontrat, ilk 15 dakika 31.650 kontrat içerdi. 23:20–23:30 UTC final yayın kesitindeki 31.650 settlement yeni modülle eksiksiz eşleşti ve final kontrolünü geçti. Yeniden indirilen eski kısa tanımlar da bu dar kesitle eşleşti; bu tek kesit ilk GitHub hatasının eksik kimliğini yeniden üretmedi. İlk log kontrat kimliğini kaydetmediğinden, ilk başarısızlığın hangi kontrata ait olduğu bu incelemede kesinleştirilemedi. Geniş 21:00–04:00 UTC tanı indirmeleri sağlayıcı zaman aşımıyla tamamlanmadı; yarım CSV kullanılmadı. Ham veriler ve anahtarlar Git'e eklenmedi; Gemini çağrısı yok.

İlk gerçek GitHub doğrulaması (`37636129016`, main `8fc771c`) 6 Ekim futures girdilerini tamamladı, ancak opsiyon indirmesinde Databento HTTP 504 ile durdu. Bunun üzerine istatistik indirmesi aynı yayın aralığını kesintisiz, birer saatlik parçalarla kapsar. Tam eski önbellek varsa ücretli tekrar yapılmaz. Parçalar kronolojik sırada birleştirilir; başlık uyuşmazlığı, bozuk önbellek veya tek bir başarısız parça tüm paketi durdurur. Her parça mevcut bütçe/uyarı/checksum kontrollerinden geçer. Önceki final yayın kapsamı ve settlement seçim kuralları değişmez. Dört ek pencere/önbellek testiyle yerel toplam 216 test, ESLint ve TypeScript geçti.
