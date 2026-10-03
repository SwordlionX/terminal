# Faiz ve kira hesabı incelemesi — 3 Ekim 2026

İnceleme yerel `codex/terminal-audit-stage3` kaynak kodunda yapıldı. Üretimdeki Turso kayıtları okunmadı; gerçek kotasyonların hatalı olduğu veya hata büyüklüğü hakkında ölçüm yapılmadı. Fiyatlama kodu bu incelemede değiştirilmedi. Dış kaynaklar yalnız yöntem ve piyasa konvansiyonu doğrulaması için kullanıldı; fiyatlama girdisi alınmadı. Astra bağımsız kod incelemesi yaptı.

## Sonuç

Motorun sabit oranlı sürekli bileşik modelindeki forward ve iskonto cebiri tutarlı. Ancak bu, kullanılan faizin güncel olduğunu veya kira kalibrasyonunun doğru olduğunu göstermez. Kira regresyonunda tekrarlanabilir bir zaman ekseni kusuru ve fiyatla tekilleştirme kusuru bulundu. Mevcut veri tam bir faiz/kira vade eğrisi değil; bir faiz oranı ve yüzey başına bir kira tahminidir.

## Bilgi hangi durumda eksik olabilir?

- `buildCmeSurface` yalnız en az iki farklı sayısal futures fiyatı kaldığında kira üretir. Birden fazla opsiyon vadesi aynı dayanak futures'a bağlıysa kira olmayabilir. Aynı fiyatlı iki ayrı futures kontratı da yanlışlıkla tek kontrat gibi ele alınır.
- `buildSurface` Yahoo/ETF yüzeyine `builtWithR` yazar, fakat `impliedLeaseRate` yazmaz. IV yüzeyi mevcutken kira metadata'sı bulunmaması mümkündür.
- Eski kayıtlar metadata taşımayabilir; veri bağlantısı veya yüzeyin kendisi de eksik olabilir.
- Faiz okuyucusu kayıt yokluğunu ve veritabanı hatasını `%5` varsayılanıyla gizler. `builtWithR` dolu olması faizin piyasa kaynağından geldiğini kanıtlamaz.

Asistanın manuel/dış veri ile bu eksikleri tamamlamaması kullanıcı talebiyle uyumludur. Son eklenen metadata kontrolü yalnız eksikliği yakalar; mevcut değerlerin ekonomik doğruluğunu doğrulamaz.

## Doğrulanan kira kusuru

`src/lib/vol/cme.ts:122` günleri opsiyonun son kullanım tarihinden hesaplıyor. `:149` yüzeye bu opsiyon gününü ve dayanak futures fiyatını yazıyor. `:163` kontrat kimliği yerine sayısal fiyatla tekilleştiriyor. `:175` ve `:186` aynı opsiyon günlerini `ln(F)` regresyonunun zaman ekseni yapıyor; `:194` kira olarak `r − eğim` döndürüyor.

Opsiyon son kullanım tarihi ile dayanak futures'ın vadesi ayrı kavramlardır. Yeni haftalık opsiyonların eklenmesi futures'ın vadesini veya fiyatını değiştirmez; ancak mevcut algoritmanın tuttuğu ilk opsiyon gününü değiştirebilir. `src/lib/vol/surface.ts` içindeki `surfaceForwardCarry` açıklaması da bu zaman ekseni sınırını belirtiyor.

İzole yerel deneyde gerçek `buildCmeSurface` çalıştırıldı. IV ters çözümü sabit bir test cevabıyla taklit edilerek yalnız kira regresyonu sınandı. Bütün değerler sentetiktir; canlı fiyatlama değildir:

| Test girdisi | Hesaplanan kira |
| --- | ---: |
| A futures'ına bağlı 90 günlük, B futures'ına bağlı 180 günlük opsiyonlar | %0,964588 |
| Aynı veri + A'ya bağlı 30 günlük haftalık opsiyon | %2,578753 |

Faiz ve iki futures fiyatı aynı tutuldu. Sadece aynı dayanağa yeni opsiyon eklenmesi kira tahminini yaklaşık 1,614 yüzde puanı değiştirdi. Bu ekonomik kira eğrisi değişimi değildir; yanlış zaman ekseninin etkisidir. Sapmanın yönü/büyüklüğü genel olarak kontrat ve vade dağılımına bağlıdır.

İkinci deneyde iki farklı futures'ın fiyatları eşit tutuldu. Geçerli yatay bir fiyat yapısı olmasına rağmen fiyatla tekilleştirme nedeniyle kira alanı oluşmadı. Kontrat kimliği ile tekilleştirme gerekir.

## Faiz ve forward kullanımı

- `src/services/market.service.ts:205`: tek kayıtlı faiz okunur; kayıt/DB sorunu durumunda `:214` sabit `%5` döner. Güncellik, kaynak ve vade metadata'sı yoktur.
- CME yenilemesi `scripts/refresh-cme.ts` üzerinden bu oranı kullanır. Yahoo yenilemesi ise aynı servisin `REF_RATE = 0.05` sabitini kullanır. İki yenileme yolu aynı faiz kaynağı politikasını izlemiyor.
- `src/lib/pricing/engine.ts:30`: `F = S × exp((r−q)×T)` uygulanır; oranlar yüzde biriminden çevrilir. Sabit, sürekli bileşik oran varsayımı altında işaret ve cebir tutarlıdır.
- `gk` için üç ayrı sentetik parametre setinde put-call paritesi doğrulandı; en büyük mutlak sayısal hata yaklaşık `3,6e−15`. Bu bir cebir kontrolüdür; piyasa kalibrasyonu veya genel motor sertifikasyonu değildir.
- Kira regresyonu tek eğim ve serbest kesişim üretir; gerçek spotu regresyonun çıpası yapmaz. Bu nedenle `S × exp((r−q)T)` ile her gözlenen futures seviyesine uyum garanti edilmez. Tek kira bütün vadelerin yapısını da temsil edemez.
- Kodda regresyon zamanı ACT/365, fiyatlama zamanı seçilen 360/365 bazıdır. Oranların gün bazı ve basit/sürekli bileşik türü açık tanımlanmalı. LBMA'nın metal kredi/forward konvansiyonunda 360 gün ve basit faiz kullanılması, bu oranların sürekli bileşik model girdisi olarak doğrudan aynı sayı kabul edilemeyeceğini gösterir.

## Güvenli düzeltme yönü

1. Mevcut terminal veri hattında futures kontrat kimliği, gerçek vade/değer tarihi ve settlement zamanı saklanmalı. Fiyatlar ve opsiyon vadeleri farklı alanlar olmalı.
2. Faizin onaylı terminal kaynağı, vadesi, tarihi, gün bazı ve bileşiklendirme türü açık olmalı; kayıt eksikliği sessiz `%5` ile gizlenmemeli.
3. Bankanın spot opsiyonu için aynı tarihteki spot ve ilgili vadeye ait forward/iskonto yapısı kullanılmalı. Dayanak futures fiyatını opsiyonun vadesine ait forward sanmak doğru değildir. COMEX futures ile bankanın OTC spot forward'ı arasındaki baz farkı ayrıca modellenebilir; kendiliğinden sıfır sayılamaz.
4. Kira/net taşıma parametresi bu tutarlı yapılardan vade bazında türetilmeli. Doğru futures zaman ekseninde regresyon, mevcut tek oranı daha az hatalı yapabilir; tek başına tam ve uygulanabilir bir banka kira eğrisi oluşturmaz.
5. Yeni haftalık opsiyon eklenmesine karşı değişmezlik, yatay futures eğrisi, forward seviyesine geri fiyatlama, faiz kaynağı eksikliği ve gün bazı dönüşümü test edilmeli. Önceki test başarısı kira regresyonunun doğruluğunu kapsamıyordu.

Ek inceleme adayı: `buildCmeSurface` aynı opsiyon vadesindeki çoğunluk underlying'i seçiyor, ancak adayları seçilen underlying ile sınırlamıyor. Aynı vadede farklı underlying tanımları varsa yanlış futures ile IV çözme riski var. Gerçek veri örneği görülmediği için oluşmuş bir üretim hatası olarak sınıflandırılmadı.

## Yöntem kaynakları

- [CME metal haftalık opsiyonlarının dayanak futures ilişkisi](https://www.cmegroup.com/trading/metals/files/weekly-options-faq.pdf)
- [CME taşıma maliyeti ve forward yapısı](https://www.cmegroup.com/education/courses/introduction-to-precious-metals/what-is-contango-and-backwardation)
- [LBMA kıymetli metal faiz ve forward konvansiyonları](https://www.lbma.org.uk/publications/the-code/annex-4-precious-metals-market-conventions)
- [LBMA metal ödünç verme ve alma](https://www.lbma.org.uk/publications/the-otc-guide/lending-and-borrowing-metal)
