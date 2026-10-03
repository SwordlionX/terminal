# Terminal Asistanı — ilk sürüm ve kurulum

Durum: Sağ alt sohbet paneli, Gemini sunucu bağlantısı ve motor araçları yerelde geliştirildi. Yeni kullanıcı talebiyle asistanın bütün manuel piyasa varsayımı yolları kapatıldı; eski manuel gösterim kartları kaldırıldı. Mevcut yerel panel modeli Gemini 3.5 Flash. Gemini 3.5 Flash-Lite ile üç sınırlı canlı davranış denemesi toplam beş model çağrısıyla tamamlandı. Amaç yalnız kullanıcının kişisel sunumu; şube ölçekleme bu aşamanın kapsamı değil. Sesli giriş/yanıt sonraki aşama.

## Kesin fiyatlama sınırı

Bütün prim, Greeks, hedef prim araması ve senaryo sonuçları Terminal X motorundan gelir. Ana sohbet modelinde Google Search, URL okuma veya başka bir fiyat API'si yoktur. Spot ve yüzey yalnız terminalin mevcut `market.service` / `cme.service` akışlarından alınır. Kullanıcı açıkça istese bile manuel spot, IV, faiz veya kira kabul edilmez; ekranın manuel spot/IV modu da fiyatlamayı durdurur. Manuel varsayımlar kayıtlı eğriyi değiştirmese de eğriyle fiyatlama tutarlılığını bozar; asistan bunu açıklar. Ürün, strike, vade, miktar ve müşteri yönü izin verilen işlem koşullarıdır.

Spot terminal servisinden; faiz ve kira yüzeyin `builtWithR` ve `impliedLeaseRate` alanlarından; IV aynı yüzeyden gelir. Bu metadata eksikse fiyatlama durur; ekran varsayımlarına düşülmez. Özellikle kira metadata'sı olmayan eski/ETF yüzeyleri asistan tarafından fiyatlanamaz; güvenilir terminal kaynağından bu alanın sağlanması gerekir. Asistan `getSurface` için yalnız önceden kurulmuş yüzeyi okuyan modu kullanır; eski snapshot'tan yeni yüzey kurmaz veya kaydetmez. Mevcut terminal ekranının diğer manuel araçları bu değişikliğin kapsamı değildir.

Vanilya hesabı `src/lib/pricing/engine.ts`, bariyer hesabı `src/lib/pricing/barrier.ts` üzerinden hem ekran hem asistan tarafından kullanılır. Mevcut Vanna–Volga / tek IV davranışı, yüzey uzatması ve tarih bilgisi korunur. Asistan modelinin metni kotasyon değildir; sayısal sonuçlar sunucunun hesapladığı kartlarda gösterilir.

## Neler yapar?

- Ekran bağlamını okuyarak müşteri açısından Long/Short Call/Put ve yeni bariyer yapıları fiyatlar.
- Spot veya strike nominalinin yüzdesi, USD/birim veya toplam USD hedefi için strike arar. En fazla 320 motor değerlendirmesi; her aday için yeni Gemini isteği yapılmaz. Birden fazla çözüm olabilir. Tolerans dışındaki en yakın sonuç başarı diye sunulmaz.
- Aynı dayanakta üç alternatif, alternatif başına sekiz vanilya bacağına kadar karşılaştırır. Delta/Gamma/Vega/Theta ve prim akışını birleştirir; spot için -%20 ile +%20 arasında vade sonu veya bugünkü spot senaryosunu grafikle gösterir. Bugünkü senaryoda her noktada IV aynı terminal eğrisinden yeniden sorgulanır; eğri değiştirilmez ve manuel/sabit IV varsayımı eklenmez. Eğri bir noktayı desteklemiyorsa karşılaştırma durur.
- Verilen pozisyonun hedge seçeneklerini, eğriyi ve varsayımları yorumlamak için araçları birlikte kullanabilir. Örnek düğmeler kapsamı sınırlamaz. Giriş primi yoksa gerçekleşmiş müşteri K/Z'si iddia edilmez; mevcut model primi referans olur.
- Kullanıcı tıklarsa vanilya fiyat kartının girdilerini forma uygular. Emir, işlem kaydı, müşteri değişikliği veya otomatik kapanış yapmaz.
- Yeni bariyer için mevcut sürekli gözlem motorunu kullanır. Mevcut bir bariyer işleminin kapanışı için geçmiş bariyer gözlemi gerekir; bu veri bağlı olmadığı için mevcut bariyer portföyünün kapanış/senaryo hesabı ilk sürümde desteklenmez.

Müşteri/işlem veritabanını okuyan bir araç yoktur. Çalışan pozisyon bilgilerini konuşmada verir. Konuşmalar uygulama veritabanına veya tarayıcı depolamasına kaydedilmez; panel belleğindedir. Sunucu Gemini araç geçmişini imzalı/şifreli, 30 dakika geçerli bir devam tokenında saklar; kullanıcı sahte araç geçmişi gönderemez. API kullanıldığında mesaj ve gerekli anonim fiyatlama girdileri Gemini'ye gönderilir. İlk denemelerde müşteri adı/hesap bilgisi kullanılmamalıdır.

## İstisnai yöntem araştırması

Normal fiyatlama ve haber için web kapalıdır. `research_diagnostic` yalnız araç/veri hatası veya açık yöntem doğrulaması isteğinde açılır. Sunucu yalnız dört sabit yöntem sorusunu (Avrupa modeli, yüzey, bariyer gözlemi, birim/tarih) ayrı bir Gemini Search çağrısına gönderir; kullanıcı metni ve pozisyon bilgileri gönderilmez. Sonuç kaynak bağlantıları ve sağlayıcının arama bileşeniyle ayrı araştırma kartında gösterilir. Araştırma metni/rakamları ana sohbet modeline veya fiyatlama motoruna dönmez. Araştırma bir mesajda en fazla bir kez çalışır.

Bu ilk sürüm yöntem farklarını açıklayabilir; bulduğu fark üzerine motor kodunu veya veri setini otomatik değiştirmez.

## Kurulum

1. Google AI Studio'da terminal için ayrı bir Gemini API anahtarı oluşturun. Anahtarı sohbet mesajına, kaynak koda veya `NEXT_PUBLIC_` değişkenine koymayın.
2. Yerelde projenin `.env.local` dosyasına; Vercel'de proje ortam değişkenlerine aşağıdaki alanları ekleyin. Dağıtımda mevcut Turso bağlantısı da gerekli.

```dotenv
GEMINI_API_KEY=buraya_kendi_anahtariniz
GEMINI_MODEL=gemini-3.5-flash
ASSISTANT_ACCESS_CODE=uzun_rastgele_asistan_erisim_kodu
ASSISTANT_SESSION_SECRET=ayri_uzun_rastgele_oturum_sirri
ASSISTANT_DAILY_MODEL_CALL_LIMIT=300
ASSISTANT_REQUESTS_PER_MINUTE=20
```

`TURSO_DATABASE_URL` ve `TURSO_AUTH_TOKEN` mevcut terminalin sunucu ayarlarıdır. Production'da erişim kodu ve ortak sayaç bağlantısı olmadan ücretli asistan açık değildir. Sayaç mevcut `kv` tablosunda atomik artırılır; eşzamanlı Vercel örnekleri aynı sınırı paylaşır. Yeni tablo gerekmez. Bağlantı hatasında sayaç bypass edilmez.

3. Yerelde `npm ci` ve `npm run dev` ile açın. Production ortam ayarlarını değiştirdikten sonra yeniden dağıtın. Panelde erişim koduyla giriş yapın; yalnız Gönder basılınca Gemini çağrılır. Panel açmak, yazmak ve örnek seçmek ücretli çağrı başlatmaz.
4. Küçük miktarlı, anonim örnekle kartı aynı otomatik veriyle çalışan ekran fiyatıyla karşılaştırın. Hedef prim, ulaşılamayan hedef, manuel talebin reddi, eksik piyasa verisi, hedge grafiği ve yöntem araştırması akışlarını deneyin. `docs/ASSISTANT_EVAL_CASES.json` Astra'nın hazırladığı 24 vakalık soru setidir; `docs/ASSISTANT_EVAL_REPORT.md` gerçek doğrulama kapsamını açıklar. Bu süreç talimat/kod iyileştirmesidir, fine-tuning değildir.

Varsayılan model ortam değişkeniyle değiştirilebilir. Model/Google Search erişimi, proje kotası ve faturalandırma anahtarın bağlı olduğu projeye göre doğrulanmalıdır; Gemini 3.8 Flash ve Gemini 3.5 Flash ile gerçek çağrı ve function calling denendi; yerelde 3.5 Flash kullanılıyor. Ortam değişkeni verilmezse kodun varsayılanı 3.8 Flash olur; başka modeller ve Google Search erişimi ayrıca doğrulanmalı. Google AI Pro/Plus uygulama aboneliği terminalin API çağrılarını otomatik kapsamaz.

## Hız, sınırlar ve maliyet

Bir istekte en fazla beş ana model karar turu, toplam on iki farklı araç çağrısı ve bir yöntem araştırması vardır. Geçici 500/502/503/504 servis hatasında bütün istek boyunca yalnız bir kez, bir saniye bekleyerek tekrar denenir; bu deneme de ortak kotadan düşer. Araştırma ve tekrar dahil en fazla altı model çağrısı yapılabilir. Anahtar/izin/kota hatalarında tekrar yoktur; SDK iç tekrarları kapalıdır. Son tur yeni araç çağırmayı kapatır. En fazla altı bağımsız araç aynı turda çalışır. Aynı parametrelerle tekrar istenen araç bir kez hesaplanır; piyasa verisi istek içinde paylaşılır. Hedef araması ve grafikler yerel motor hesabıdır.

Ana çağrı başına 8.192, araştırma başına 4.096 çıktı tokenı; geçmiş bağlamı 48 KB; tek API çağrısı 20 saniye; toplam istek 55 saniye ile sınırlı. Panel durum ve motor kartlarını geldikçe gösterir; nihai açıklama tamamlandığında gelir. İptal mevcut isteği durdurur; gelmiş kartları korur. Daha önce tüketilen sağlayıcı kullanımı iptalle geri alınmaz.

Günlük sınır varsayılan olarak bütün terminal için 300 model çağrısı, dakikalık sınır toplam 20 istektir. Gün İstanbul saatine göre değişir. Bunlar çağrı sınırıdır; sabit dolar bütçesi garantisi değildir. Google Search bir araştırma çağrısında birden fazla sorgu yapabilir. Sağlayıcı fiyatları/kotaları ayrıca kontrol edilmeli; otomatik pahalı modele geçiş veya sınırsız tekrar denemesi yoktur. Eski sayaç anahtarları mevcut `kv` tablosunda kalır; uzun kullanımda saklama/temizlik politikası eklenebilir.

## Yerel görsel kontrol

Push öncesi Astra tasarım incelemesi ve Sol düzeltmeleri tamamlandı. Grafik eksenleri, kart kimliği, mobil taşmalar, erişilebilir kontroller, sohbet kaydırması ve ilk açılışta yükleme iyileştirildi. Ayrıntılar `docs/ASSISTANT_DESIGN_REVIEW.md` içinde. Mobil server/client görünüm uyuşmazlığına regresyon testi eklendi; son test takımı 116/116 geçti.

`npx tsx scripts/validate-terminal-live.ts --live` Gemini çağrısı yapmadan mevcut terminal bağlantısı ve aynı eğriyle motor aktarımını, hedef aramasını ve senaryoları kontrol eder. Sonuç `docs/TERMINAL_LIVE_VALIDATION.json` dosyasına yazılır. Bu kontrol bağımsız piyasa kalibrasyonu doğrulaması değildir; `docs/RATE_LEASE_AUDIT.md` içindeki faiz/kira bulguları ayrıca çözümlenmelidir. Bağlantı eksikliği başarılı fiyatlama olarak raporlanmaz.

`/assistant-preview` yalnız development ortamında açılır. Asistanı ve eğriyle fiyatlama kuralını tanıtır; manuel/sentetik fiyat kartı üretmez. Fiyat kartları için mevcut terminal verisine erişim gerekir. Production'da 404 döner.

Kontroller: `npm test` 116/116 geçti; `npx tsc --noEmit -p tsconfig.build.json`, değişen dosyalarda ESLint ve `npm run build` başarılı. Asistan testleri aynı motor fiyatını, manuel girdi reddini, veri eksikliğini, birim/yön doğrulamasını, hedef çözümünü, çoklu kökü, hedge toplamlarını, değiştirilmeyen eğriden senaryo IV sorgusunu, yalnız kurulu eğri okumasını, araştırma izolasyonunu, şifreli geçmişi, eşzamanlı kota sınırını ve bounded model döngüsünü doğrular. SDK testleri taklit yanıtlarla, sayısal testler sentetik terminal fixture'larıyla çalışır; canlı kotasyon değildir. Önceki manuel canlı fiyat örneği yeni eğri politikasının canlı sayısal doğrulaması sayılmaz.

Canlı davranış denemesi: `npx tsx scripts/eval-assistant-live.ts --live`. Ayrı değerlendirme sürecinde yalnız 3.5 Flash-Lite kullanır; panelin model ayarını değiştirmez. Çalıştırma başına sekiz model çağrısıyla sınırlıdır. Sonuçlar `docs/ASSISTANT_LIVE_EVAL_RESULTS.json` içinde kayıtlıdır. Manuel talep reddedildi, yüzde birimi soruldu, terminal eğrisi bulunmayınca fiyat üretimi durdu. Yerelde Turso bağlantısı bulunmadığı için canlı sayısal fiyatlama veya hedge kalitesi doğrulanmadı. Üç örnek 24 vakanın tamamı için başarı ölçümü değildir.

Sonraki adımlar: Kullanıcının mevcut terminal veri bağlantısıyla hedef prim ve hedge akışlarını doğrulama; 24 vaka üzerinden talimat/kod iyileştirmesi; sunum provasının ardından bas-konuş ve sesli yanıt. Müşteri pozisyonlarını otomatik okuma ayrı bir bağlantı aşamasıdır. Geliştirme ve sunum aynı Google proje kotasını tüketir; 20 çağrılık Flash sınırı eğitim/prova için dardır, Lite'ın 500 çağrılık kotası daha uygundur.

Resmi referanslar (3 Ekim 2026):
- [Gemini modelleri](https://ai.google.dev/gemini-api/docs/models)
- [Function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Google Search](https://ai.google.dev/gemini-api/docs/google-search)
- [Kotalar](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Faturalandırma](https://ai.google.dev/gemini-api/docs/billing)
- [Google AI planları](https://ai.google.dev/gemini-api/docs/google-ai-plans)
