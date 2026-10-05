import type { FunctionDeclaration, Schema } from '@google/genai';

const numeric = (description: string) => ({ type: 'number', description });
const optionProperties = {
  product: { type: 'string', enum: ['XAU', 'XAG'] },
  type: { type: 'string', enum: ['Call', 'Put'] },
  position: {
    type: 'string',
    enum: ['Long', 'Short'],
    description: 'MÜŞTERİ yönü. Long prim öder; Short prim alır. Banka yönü ayrı.',
  },
  strike: numeric(
    'Kullanıcının istediği kullanım fiyatı. Eksikse sor; ekranı kendiliğinden alma. Hedef prim aramasında strike aranır.',
  ),
  contractSize: numeric(
    'ZORUNLU. Kullanıcının belirttiği ons miktarı. Eksikse sor; ekran miktarını veya birim fiyat için 1 kullanma.',
  ),
  tradeDate: { type: 'string', description: 'İstenen değerleme tarihi YYYY-MM-DD; belirtilmediyse bugün.' },
  expiryDate: {
    type: 'string',
    description: 'ZORUNLU. Kullanıcının belirttiği vade YYYY-MM-DD. Eksikse sor; ekrandan devralma.',
  },
  // Runtime validation accepts only 360/365; omitted values use ACT/365.
  basis: {
    type: 'integer',
    description: 'Gün bazı: yalnız 360 veya 365. Belirtilmediyse gönderme; terminal ACT/365 kullanır.',
  },
  barrier: {
    type: 'object',
    description: 'Yeni, sürekli gözlemli bariyer. Eski işlem değerlemesinde geçmiş gözlem olmadan kullanma.',
    properties: {
      variant: { type: 'string', enum: ['uo', 'do', 'ui', 'di'] },
      level: numeric('Bariyer seviyesi'),
      rebate: numeric('Birim başına USD rebate'),
    },
    required: ['variant', 'level'],
  },
};
const option = {
  type: 'object',
  properties: optionProperties,
  required: ['product', 'type', 'position', 'contractSize', 'expiryDate', 'strike'],
  additionalProperties: false,
};
const searchOption = { ...option, required: option.required.filter(k => k !== 'strike') };

const declarations: FunctionDeclaration[] = [
  {
    name: 'get_customer_file',
    description:
      'Kullanıcının konuşmada adıyla istediği müşteriyi terminal kayıtlarında ara ve açık işlemleri/teminat özetini oku. Her sayfadan kullanılabilir. Birden çok eşleşme varsa dosya okunmaz; tam adı sor. Ekran seçimini veya rastgele müşteri adını query olarak kullanma.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 2,
          maxLength: 100,
          description: 'Kullanıcının mesajında veya bu konuşmada açıkça belirttiği müşteri adı.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'price_selected_option',
    description:
      'YALNIZ kullanıcı açıkça ekrandaki/seçili yeni işlemi fiyatlamak istediğinde kullan. Sayfanın açık olması izin değildir. Bariyer dahil koşulları korur. Bağımsız fiyatlama isteğinde eksikleri sor ve price_option kullan. Kayıtlı işlemler için kullanma.',
    parametersJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_workspace_context',
    description:
      'Ekranda seçili müşteri/işlem veya risk özeti. Kimlikler sunucuda doğrulanır. Salt okunur; teminat prosedürü model MTM değildir. Sadece bu seçimi okur.',
    parametersJsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'analyze_selected_position',
    description:
      'Seçili kayıtlı Avrupa tipi vanilya pozisyonu geçmiş gerçek primiyle analiz eder. En fazla sekiz bacak, aynı metal ve müşteri. Bariyer/vadesi bitmiş/kesilmiş dosyada durur. Fiyat×tarih K/Z, delta/gamma ve birleşik grafik üretir.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        scenarioDate: { type: 'string', description: 'İsteğe bağlı YYYY-MM-DD; bugün ve ilk vade arasında.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'analyze_position',
    description:
      'Avrupa tipi vanilya pozisyonu için birleşik K/Z, fiyat × tarih haritası ve delta/gamma risk görünümü üret. Vade öncesi kullanım veya fesih yapmaz. Eksik hücreyi boş bırakır. Yalnız terminal motoru; manuel piyasa girdisi yok.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Kısa pozisyon adı.' },
        scenarioDate: {
          type: 'string',
          description: 'İsteğe bağlı YYYY-MM-DD; bugün ile ilk opsiyon vadesi arasında. Yoksa otomatik tarih haritası.',
        },
        legs: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            properties: {
              option,
              entryPremiumPerUnit: numeric(
                'Yalnız verilen geçmiş işlem primi, USD/birim. Eksikse bugünkü motor primi referans; gerçekleşmiş müşteri K/Z’si sayılmaz.',
              ),
            },
            required: ['option'],
            additionalProperties: false,
          },
        },
      },
      required: ['legs'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_market_context',
    description:
      'Yalnız Terminal X mevcut veri servisinden spot, veri tarihi, vade bazlı USD faizi ve metal taşıma oranı (termStructure), forward ve örnek IV eğrisini oku. Dış araştırma veya yeni opsiyon zinciri indirmesi yapmaz.',
    parametersJsonSchema: {
      type: 'object',
      properties: { product: optionProperties.product },
      required: ['product'],
      additionalProperties: false,
    },
  },
  {
    name: 'price_option',
    description:
      'Terminal X mevcut eğrisi ve AYNI motoruyla endikatif vanilya veya bariyer opsiyon fiyatla. Manuel piyasa varsayımı yasak; eksik veri fiyatlamayı durdurur. Bütün fiyat ve Greeks kartları yalnız bu motorun çıktısıdır.',
    parametersJsonSchema: option,
  },
  {
    name: 'find_options',
    description:
      'Hedef prim için Terminal X motorunda toplu tarama. Varsayılan: verilen koşullarda strike aranır. Bariyerli işlemde iki bilinmeyen varsa kullanıcıya tek seviye sordurmak yerine: (1) barrierLevels ile birkaç bariyer seviyesi ver, her biri için hedefi sağlayan strike tablo halinde bulunur; (2) solveFor="barrier" ile strike sabit tutulur, hedefi sağlayan bariyer seviyesi aranır. Yüzde birimini netleştir; modelden IV üretme. Çözümsüz hedef açıkça bildirilir.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        option: searchOption,
        target: numeric('Hedef prim, seçilen unit biriminde; yüzde ise 5 = %5.'),
        unit: { type: 'string', enum: ['usd_per_unit', 'total_usd', 'pct_spot', 'pct_strike'] },
        minStrike: numeric('İsteğe bağlı pozitif alt sınır'),
        maxStrike: numeric('İsteğe bağlı üst sınır'),
        tolerance: numeric('Hedefin kendi biriminde kabul edilen hata; belirtilmediyse küçük varsayılan tolerans.'),
        solveFor: {
          type: 'string',
          enum: ['strike', 'barrier'],
          description:
            'strike (varsayılan): strike aranır. barrier: option.strike ve option.barrier.variant sabit, bariyer seviyesi aranır; option.barrier.level yok sayılır.',
        },
        barrierLevels: {
          type: 'array',
          minItems: 2,
          maxItems: 6,
          items: { type: 'number' },
          description:
            'Yalnız solveFor=strike ile: her bariyer seviyesi için strike ayrı aranır ve tablo üretilir. option.barrier.variant gerekli; option.barrier.level yok sayılır. Kullanıcı seviye vermediyse spotun yaklaşık %5, %10, %15, %20 uzağını kullan (yukarı bariyerde üstü, aşağıda altı).',
        },
        minBarrier: numeric('solveFor=barrier için isteğe bağlı alt sınır'),
        maxBarrier: numeric('solveFor=barrier için isteğe bağlı üst sınır'),
      },
      required: ['option', 'target', 'unit'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_strategies',
    description:
      'Kullanıcının hedefi için senin oluşturduğun vanilya alternatiflerini veya mevcut pozisyon + hedge bacaklarını aynı motorla karşılaştır; net prim, risk ve grafik üret. Bütün yönler MÜŞTERİ açısından. Güncel model değeri ile içsel değer aynı değildir.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        horizon: {
          type: 'string',
          enum: ['expiry', 'now'],
          description:
            'expiry: aynı vadede vade sonu; now: terminalin mevcut eğrisinden yeniden IV sorgulanan bugünkü spot şoku. Eğri değişmez.',
        },
        strategies: {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              legs: {
                type: 'array',
                minItems: 1,
                maxItems: 8,
                items: {
                  type: 'object',
                  properties: {
                    option,
                    entryPremiumPerUnit: numeric(
                      'Yalnız kullanıcı/veri verdiğinde başlangıç primi USD/birim. Yoksa şu anki motor primi.',
                    ),
                  },
                  required: ['option'],
                  additionalProperties: false,
                },
              },
            },
            required: ['label', 'legs'],
            additionalProperties: false,
          },
        },
      },
      required: ['horizon', 'strategies'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_collateral',
    description:
      'Asistanın yapabildiği TEK kayıt işlemi: kullanıcı bu mesajda açıkça istediğinde, adıyla belirttiği müşteriye USD nakit veya XAU/XAG (ons) teminat EKLER. Bir mesajda bir kez çağır. Silme, değiştirme, işlem kaydı veya emir yapmaz. Tutarı kullanıcının yazdığı gibi gönder; kur veya birim dönüştürme yapma.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        customer: { type: 'string', description: 'Kullanıcının mesajında yazdığı müşteri adı.' },
        asset: {
          type: 'string',
          enum: ['USD', 'XAU', 'XAG'],
          description: 'USD nakit veya ons cinsinden altın/gümüş.',
        },
        amount: numeric('USD için tutar, XAU/XAG için ons. Kullanıcının yazdığı sayı (100 bin = 100000).'),
      },
      required: ['customer', 'asset', 'amount'],
      additionalProperties: false,
    },
  },
  {
    name: 'research_diagnostic',
    description:
      'FİYATLAMA ARACI DEĞİL. Yalnız kaydedilmiş veri/motor hatası veya kullanıcının açık yöntem doğrulama isteği için kaynak araştır. Fiyat arama, piyasa kotasyonu, model girdisi bulma ve genel haber araması yasak. Sonuç fiyatlama araçlarına aktarılmaz.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: ['european_model', 'volatility_surface', 'barrier_monitoring', 'units_and_dates'],
        },
      },
      required: ['topic'],
      additionalProperties: false,
    },
  },
];

// Use Gemini's native function schema. Keep richer validation in the executor
// rather than depending on the provider to enforce arbitrary JSON Schema fields.
function nativeSchema(value: unknown): Schema {
  const schema = value as Record<string, unknown>;
  return {
    type: String(schema.type).toUpperCase() as Schema['type'],
    ...(schema.description ? { description: String(schema.description) } : {}),
    ...(schema.enum ? { enum: schema.enum as string[] } : {}),
    ...(schema.required ? { required: schema.required as string[] } : {}),
    ...(schema.properties
      ? {
          properties: Object.fromEntries(
            Object.entries(schema.properties as Record<string, unknown>).map(([key, child]) => [
              key,
              nativeSchema(child),
            ]),
          ),
        }
      : {}),
    ...(schema.items ? { items: nativeSchema(schema.items) } : {}),
    ...(schema.minItems !== undefined ? { minItems: String(schema.minItems) } : {}),
    ...(schema.maxItems !== undefined ? { maxItems: String(schema.maxItems) } : {}),
  };
}
export const toolDeclarations: FunctionDeclaration[] = declarations.map(({ parametersJsonSchema, ...declaration }) => ({
  // No-argument tools omit parameters instead of declaring an empty OBJECT.
  ...declaration,
  ...(parametersJsonSchema && Object.keys((parametersJsonSchema as { properties?: object }).properties ?? {}).length
    ? { parameters: nativeSchema(parametersJsonSchema) }
    : {}),
}));
