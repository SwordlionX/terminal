import type { FunctionDeclaration } from '@google/genai';

const numeric = (description: string) => ({ type: 'number', description });
const optionProperties = {
  product: { type: 'string', enum: ['XAU', 'XAG'] },
  type: { type: 'string', enum: ['Call', 'Put'] },
  position: { type: 'string', enum: ['Long', 'Short'], description: 'MÜŞTERİ yönü. Long prim öder; Short prim alır. Banka yönü ayrı.' },
  strike: numeric('Kullanım fiyatı; belirtilmediyse aktif ekrandan alınır.'),
  contractSize: numeric('ZORUNLU. XAU/XAG miktarı ons cinsindedir. Açık kullanıcı miktarı ekran miktarından öncelikli. Birim fiyat için 1 yapma; miktar hiç belirtilmediyse ekran miktarını gönder. Nominal USD ile karıştırma.'),
  tradeDate: { type: 'string', description: 'Değerleme tarihi YYYY-MM-DD; belirtilmediyse aktif ekran.' },
  expiryDate: { type: 'string', description: 'Vade YYYY-MM-DD; belirtilmediyse aktif ekran.' },
  basis: { type: 'integer', enum: [360, 365] },
  barrier: { type: 'object', description: 'Yeni, sürekli gözlemli bariyer. Eski işlem değerlemesinde geçmiş gözlem olmadan kullanma.',
    properties: { variant: { type: 'string', enum: ['uo', 'do', 'ui', 'di'] }, level: numeric('Bariyer seviyesi'), rebate: numeric('Birim başına USD rebate') }, required: ['variant', 'level'] },
};
const option = { type: 'object', properties: optionProperties, required: ['type', 'position', 'contractSize'], additionalProperties: false };

export const toolDeclarations: FunctionDeclaration[] = [
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
    parametersJsonSchema: { type: 'object', properties: { product: optionProperties.product }, additionalProperties: false } },
  { name: 'price_option', description: 'Terminal X mevcut eğrisi ve AYNI motoruyla endikatif vanilya veya bariyer opsiyon fiyatla. Manuel piyasa varsayımı yasak; eksik veri fiyatlamayı durdurur. Bütün fiyat ve Greeks kartları yalnız bu motorun çıktısıdır.', parametersJsonSchema: option },
  { name: 'find_options', description: 'Hedef prim için strike aralığını Terminal X motorunda toplu tara. Aynı çağrı yüzlerce hesabı yapar. Yüzde birimini netleştir; modelden IV üretme. Çözümsüz hedef açıkça bildirilir.',
    parametersJsonSchema: { type: 'object', properties: { option, target: numeric('Hedef prim, seçilen unit biriminde; yüzde ise 5 = %5.'),
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
