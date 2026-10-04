import type { FunctionDeclaration } from '@google/genai';

const numeric = (description: string) => ({ type: 'number', description });
const optionProperties = {
  product: { type: 'string', enum: ['XAU', 'XAG'] },
  type: { type: 'string', enum: ['Call', 'Put'] },
  position: { type: 'string', enum: ['Long', 'Short'], description: 'MÜŞTERİ yönü. Long prim öder; Short prim alır. Banka yönü ayrı.' },
  strike: numeric('Kullanıcının istediği kullanım fiyatı. Eksikse sor; ekranı kendiliğinden alma. Hedef prim aramasında strike aranır.'),
  contractSize: numeric('ZORUNLU. Kullanıcının belirttiği ons miktarı. Eksikse sor; ekran miktarını veya birim fiyat için 1 kullanma.'),
  tradeDate: { type: 'string', description: 'İstenen değerleme tarihi YYYY-MM-DD; belirtilmediyse bugün.' },
  expiryDate: { type: 'string', description: 'ZORUNLU. Kullanıcının belirttiği vade YYYY-MM-DD. Eksikse sor; ekrandan devralma.' },
  basis: { type: 'integer', enum: [360, 365] },
  barrier: { type: 'object', description: 'Yeni, sürekli gözlemli bariyer. Eski işlem değerlemesinde geçmiş gözlem olmadan kullanma.',
    properties: { variant: { type: 'string', enum: ['uo', 'do', 'ui', 'di'] }, level: numeric('Bariyer seviyesi'), rebate: numeric('Birim başına USD rebate') }, required: ['variant', 'level'] },
};
const option = { type: 'object', properties: optionProperties, required: ['product', 'type', 'position', 'contractSize', 'expiryDate', 'strike'], additionalProperties: false };
const searchOption = { ...option, required: option.required.filter(k => k !== 'strike') };

export const toolDeclarations: FunctionDeclaration[] = [
  { name: 'get_customer_file', description: 'Kullanıcının konuşmada adıyla istediği müşteriyi terminal kayıtlarında ara ve açık işlemleri/teminat özetini oku. Her sayfadan kullanılabilir. Birden çok eşleşme varsa dosya okunmaz; tam adı sor. Ekran seçimini veya rastgele müşteri adını query olarak kullanma.', parametersJsonSchema: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 100, description: 'Kullanıcının mesajında veya bu konuşmada açıkça belirttiği müşteri adı.' } }, required: ['query'], additionalProperties: false } },
  { name: 'price_selected_option', description: 'YALNIZ kullanıcı açıkça ekrandaki/seçili yeni işlemi fiyatlamak istediğinde kullan. Sayfanın açık olması izin değildir. Bariyer dahil koşulları korur. Bağımsız fiyatlama isteğinde eksikleri sor ve price_option kullan. Kayıtlı işlemler için kullanma.', parametersJsonSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'get_workspace_context', description: 'Ekranda seçili müşteri/işlem veya risk özeti. Kimlikler sunucuda doğrulanır. Salt okunur; teminat prosedürü model MTM değildir. Sadece bu seçimi okur.', parametersJsonSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'analyze_selected_position', description: 'Seçili kayıtlı Avrupa tipi vanilya pozisyonu geçmiş gerçek primiyle analiz eder. En fazla sekiz bacak, aynı metal ve müşteri. Bariyer/vadesi bitmiş/kesilmiş dosyada durur. Fiyat×tarih K/Z, delta/gamma ve birleşik grafik üretir.', parametersJsonSchema: { type: 'object', properties: { scenarioDate: { type: 'string', description: 'İsteğe bağlı YYYY-MM-DD; bugün ve ilk vade arasında.' } }, additionalProperties: false } },
  { name: 'analyze_position', description: 'Avrupa tipi vanilya pozisyonu için birleşik K/Z, fiyat × tarih haritası ve delta/gamma risk görünümü üret. Vade öncesi kullanım veya fesih yapmaz. Eksik hücreyi boş bırakır. Yalnız terminal motoru; manuel piyasa girdisi yok.',
    parametersJsonSchema: { type: 'object', properties: {
      label: { type: 'string', description: 'Kısa pozisyon adı.' },
      scenarioDate: { type: 'string', description: 'İsteğe bağlı YYYY-MM-DD; bugün ile ilk opsiyon vadesi arasında. Yoksa otomatik tarih haritası.' },
      legs: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', properties: { option,
        entryPremiumPerUnit: numeric('Yalnız verilen geçmiş işlem primi, USD/birim. Eksikse bugünkü motor primi referans; gerçekleşmiş müşteri K/Z’si sayılmaz.') }, required: ['option'], additionalProperties: false } },
    }, required: ['legs'], additionalProperties: false } },
  { name: 'get_market_context', description: 'Yalnız Terminal X mevcut veri servisinden piyasa, veri tarihi, forward ve örnek IV eğrisini oku. Dış araştırma veya yeni opsiyon zinciri indirmesi yapmaz.',
    parametersJsonSchema: { type: 'object', properties: { product: optionProperties.product }, required: ['product'], additionalProperties: false } },
  { name: 'price_option', description: 'Terminal X mevcut eğrisi ve AYNI motoruyla endikatif vanilya veya bariyer opsiyon fiyatla. Manuel piyasa varsayımı yasak; eksik veri fiyatlamayı durdurur. Bütün fiyat ve Greeks kartları yalnız bu motorun çıktısıdır.', parametersJsonSchema: option },
  { name: 'find_options', description: 'Hedef prim için strike aralığını Terminal X motorunda toplu tara. Aynı çağrı yüzlerce hesabı yapar. Yüzde birimini netleştir; modelden IV üretme. Çözümsüz hedef açıkça bildirilir.',
    parametersJsonSchema: { type: 'object', properties: { option: searchOption, target: numeric('Hedef prim, seçilen unit biriminde; yüzde ise 5 = %5.'),
      unit: { type: 'string', enum: ['usd_per_unit', 'total_usd', 'pct_spot', 'pct_strike'] },
      minStrike: numeric('İsteğe bağlı pozitif alt sınır'), maxStrike: numeric('İsteğe bağlı üst sınır'),
      tolerance: numeric('Hedefin kendi biriminde kabul edilen hata; belirtilmediyse küçük varsayılan tolerans.') }, required: ['option', 'target', 'unit'], additionalProperties: false } },
  { name: 'compare_strategies', description: 'Kullanıcının hedefi için senin oluşturduğun vanilya alternatiflerini veya mevcut pozisyon + hedge bacaklarını aynı motorla karşılaştır; net prim, risk ve grafik üret. Bütün yönler MÜŞTERİ açısından. Güncel model değeri ile içsel değer aynı değildir.',
    parametersJsonSchema: { type: 'object', properties: {
      horizon: { type: 'string', enum: ['expiry', 'now'], description: 'expiry: aynı vadede vade sonu; now: terminalin mevcut eğrisinden yeniden IV sorgulanan bugünkü spot şoku. Eğri değişmez.' },
      strategies: { type: 'array', maxItems: 3, items: { type: 'object', properties: {
        label: { type: 'string' }, legs: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', properties: {
          option, entryPremiumPerUnit: numeric('Yalnız kullanıcı/veri verdiğinde başlangıç primi USD/birim. Yoksa şu anki motor primi.') }, required: ['option'], additionalProperties: false } },
      }, required: ['label', 'legs'], additionalProperties: false } },
    }, required: ['horizon', 'strategies'], additionalProperties: false } },
  { name: 'research_diagnostic', description: 'FİYATLAMA ARACI DEĞİL. Yalnız kaydedilmiş veri/motor hatası veya kullanıcının açık yöntem doğrulama isteği için kaynak araştır. Fiyat arama, piyasa kotasyonu, model girdisi bulma ve genel haber araması yasak. Sonuç fiyatlama araçlarına aktarılmaz.',
    parametersJsonSchema: { type: 'object', properties: { topic: { type: 'string', enum: ['european_model', 'volatility_surface', 'barrier_monitoring', 'units_and_dates'] } }, required: ['topic'], additionalProperties: false } },
];
