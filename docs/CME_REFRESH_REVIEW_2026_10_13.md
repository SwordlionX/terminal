# CME yenileme incelemesi — 13 Ekim 2026

13 Ekim'deki `38329498664` çalışması 9 Ekim futures girdilerini kaydetti, ancak XAU final opsiyon settlement eşleştirmesinde 364 eksik tanım nedeniyle durdu. Ham futures girdisinin `latestPromoted: true` olması, fiyatlama paketinin güncellendiği anlamına gelmez. İki metalin atomik paket aktivasyonu başarısızlıkta gerçekleşmez.

GitHub'dan ayrıca okunan 12 Ekim çalışmaları (`38301893115`, `38253595168`) başarılı olsa da yeni paket kurmamış: 9 Ekim GCZ8 finali eksik olduğu için 8 Ekim'e dönmüş ve `upToDate: true` bildirmişler. O tarihteki paket kimliği `258c003ecc28de6a9bdec4f344b57d040f5af9b3c60ff85571e37d20f40b87a1`. Bu, 13 Ekim sonrasındaki canlı veritabanının doğrudan doğrulaması değildir.

## Doğrulanan kod hatası ve düzeltme

Databento'nun opsiyon parent grupları tekil call/put yanında spread ve karma stratejileri de içerir. Eski kod yalnız C/P tanımlarını saklıyor, ancak aynı gruptaki tüm settlement kimliklerini bu dar haritayla karşılaştırıyordu. Böylece tanımı bulunan bir spread bile "eksik opsiyon tanımı" sayılabiliyordu. [Sağlayıcının açıklaması](https://databento.com/docs/venues-and-datasets/glbx-mdp3) bu gruplamayı doğrular.

Yeni indeks tekil opsiyonları, açıkça tanımlanmış opsiyon dışı kontratları ve silinen kimlikleri ayırır. Settlement eşleştirmesi yalnız pozitif olarak tanımlanan opsiyon dışı kayıtları yüzey dışında tutar. Tanımı hiç bulunmayan, sınıfı belirsiz veya silinen kimlikler yine paketi durdurur. Tekil opsiyonun preliminary/deleted/sentinel settlement kontrolü değişmez. Ana fiyatlama motoru, IV hesabı, bütçe ve iki metalin atomik aktivasyonu değiştirilmedi.

Bu hata izole fixture ile yeniden üretildi; eski eşleştirme dört bilinen stratejide hata verirken yeni eşleştirme aynı girdinin tekil opsiyonunu eksiksiz korur. Ancak 364 gerçek kimliğin sınıfları ham CSV olmadan kesinleştirilemedi. Son hatalı çalışmanın indirilebilir workflow artifact'i yok; yerel Databento denetim önbelleği de bulunmuyor. Bu düzeltmenin o canlı çalışmayı tamamen çözdüğü henüz iddia edilemez.

## Kapsam sorgusu dayanıklılığı

`metadata.get_dataset_range` isteği daha önce tek bir 30 saniyelik zaman aşımıyla tüm çalışmayı bitiriyordu. Geçici timeout/429/5xx bağlantı hatalarında artık yalnız bir kez tekrar denenir. 401/403 veya bozuk veri hemen durur. Hata hangi endpoint'in başarısız olduğunu güvenli şekilde belirtir; anahtar veya sağlayıcı yanıt gövdesi yazılmaz. Bu değişiklik ücretli timeseries indirmesi veya bütçe rezervasyonu yapmaz.

8 Ekim'deki 31 saniyelik hatanın kesin endpoint'i logda bulunmuyor; metadata sorgusunu iyileştirmek, o eski hatanın nedenini kesin olarak kanıtlamaz.

## Doğrulama ve kalan adım

236 otomatik test geçti; değişen dosyalarda ESLint ve takip edilen proje dosyalarında TypeScript kontrolü temiz. Testlerde gerçek sağlayıcı isteği veya üretim müşteri verisi değişikliği yapılmadı.

Bir sonraki gerçek yenilemede yeni sınıf/silme sayıları ve kalan eksik kimlikler kontrol edilmeli. Eksik tanım sürerse mevcut checksum doğrulamalı definition/statistics önbelleği incelenmeli; 364 kimlik topluca atlanmamalı ve silinmiş tanımlar körlemesine geri getirilmemeli.
