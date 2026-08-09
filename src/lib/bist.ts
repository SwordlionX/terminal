/**
 * BIST hisse evreni — Portföy Takip ekranındaki "Yeni İşlem Ekle" listesinin kaynağı.
 *
 * Yahoo sembolü kodun sonuna `.IS` eklenerek kurulur (THYAO -> THYAO.IS).
 *
 * Buradaki her kod 2026-08-08'de Yahoo `chart` ucuna TEK TEK sorulup fiyat döndürdüğü ve
 * para birimi TRY geldiği doğrulanarak eklendi — tahminle yazılmadı. (Aynı taramada KOZAL
 * ve KOZAA çözülmedi, o yüzden listede yok.)
 *
 * DİKKAT: BIST 30 endeks bileşimi üç ayda bir değişir; bu liste endeksin RESMİ bileşimi
 * değil, takip için pratik bir evrendir (endeksin çekirdeği + yakın takip edilen adlar).
 * Listede olmayan bir hisse gerekirse ekranda kod elle de yazılabilir — sembol Yahoo'da
 * çözülmezse işlem eklenmez, sessizce boş satır oluşmaz.
 */

export interface BistTicker {
  /** BIST kodu, ör. "THYAO" */
  code: string;
  /** Kısa ad (ekranda kodun altında görünür) */
  name: string;
}

export const BIST_TICKERS: BistTicker[] = [
  { code: 'AEFES', name: 'Anadolu Efes' },
  { code: 'AGHOL', name: 'AG Anadolu Grubu Holding' },
  { code: 'AKBNK', name: 'Akbank' },
  { code: 'ALARK', name: 'Alarko Holding' },
  { code: 'ALFAS', name: 'Alfa Solar Enerji' },
  { code: 'ARCLK', name: 'Arçelik' },
  { code: 'ASELS', name: 'Aselsan' },
  { code: 'ASTOR', name: 'Astor Enerji' },
  { code: 'BERA', name: 'Bera Holding' },
  { code: 'BIMAS', name: 'BİM Birleşik Mağazalar' },
  { code: 'BRSAN', name: 'Borusan Boru' },
  { code: 'BRYAT', name: 'Borusan Yatırım' },
  { code: 'CIMSA', name: 'Çimsa Çimento' },
  { code: 'CWENE', name: 'CW Enerji' },
  { code: 'DOAS', name: 'Doğuş Otomotiv' },
  { code: 'EKGYO', name: 'Emlak Konut GYO' },
  { code: 'ENJSA', name: 'Enerjisa Enerji' },
  { code: 'ENKAI', name: 'Enka İnşaat' },
  { code: 'EREGL', name: 'Ereğli Demir Çelik' },
  { code: 'EUPWR', name: 'Europower Enerji' },
  { code: 'FROTO', name: 'Ford Otosan' },
  { code: 'GARAN', name: 'Garanti BBVA' },
  { code: 'GESAN', name: 'Girişim Elektrik' },
  { code: 'GUBRF', name: 'Gübre Fabrikaları' },
  { code: 'HEKTS', name: 'Hektaş' },
  { code: 'ISCTR', name: 'İş Bankası (C)' },
  { code: 'ISMEN', name: 'İş Yatırım' },
  { code: 'KCAER', name: 'Kocaer Çelik' },
  { code: 'KCHOL', name: 'Koç Holding' },
  { code: 'KONTR', name: 'Kontrolmatik' },
  { code: 'KRDMD', name: 'Kardemir (D)' },
  { code: 'MGROS', name: 'Migros' },
  { code: 'MPARK', name: 'MLP Sağlık (Medical Park)' },
  { code: 'ODAS', name: 'Odaş Elektrik' },
  { code: 'OYAKC', name: 'OYAK Çimento' },
  { code: 'PETKM', name: 'Petkim' },
  { code: 'PGSUS', name: 'Pegasus' },
  { code: 'REEDR', name: 'Reeder Teknoloji' },
  { code: 'SAHOL', name: 'Sabancı Holding' },
  { code: 'SASA', name: 'Sasa Polyester' },
  { code: 'SISE', name: 'Şişecam' },
  { code: 'SMRTG', name: 'Smart Güneş Enerjisi' },
  { code: 'SOKM', name: 'Şok Marketler' },
  { code: 'TABGD', name: 'TAB Gıda' },
  { code: 'TAVHL', name: 'TAV Havalimanları' },
  { code: 'TCELL', name: 'Turkcell' },
  { code: 'THYAO', name: 'Türk Hava Yolları' },
  { code: 'TOASO', name: 'Tofaş' },
  { code: 'TSKB', name: 'TSKB' },
  { code: 'TTKOM', name: 'Türk Telekom' },
  { code: 'TTRAK', name: 'Türk Traktör' },
  { code: 'TUPRS', name: 'Tüpraş' },
  { code: 'TURSG', name: 'Türkiye Sigorta' },
  { code: 'ULKER', name: 'Ülker' },
  { code: 'VESTL', name: 'Vestel' },
  { code: 'YKBNK', name: 'Yapı Kredi' },
  { code: 'ZOREN', name: 'Zorlu Enerji' },
];

/** BIST kodunu Yahoo sembolüne çevirir: "thyao" -> "THYAO.IS". Zaten ".IS" varsa dokunmaz. */
export function toYahooSymbol(code: string): string {
  const c = code.trim().toUpperCase();
  return c.endsWith('.IS') ? c : `${c}.IS`;
}

/** Yahoo sembolünden BIST kodu: "THYAO.IS" -> "THYAO". */
export function toBistCode(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.IS$/, '');
}

/** Listede varsa hissenin adı, yoksa kodun kendisi (elle girilmiş semboller için). */
export function bistName(symbol: string): string {
  const code = toBistCode(symbol);
  return BIST_TICKERS.find(t => t.code === code)?.name ?? code;
}

/**
 * Kabul edilebilir sembol biçimi. Sunucu tarafında da uygulanır: `stock_positions`
 * birincil anahtarı sembol olduğu için serbest metin, tabloda çöp satır açardı.
 */
export const SYMBOL_RE = /^[A-Z0-9]{3,10}\.IS$/;

/* ------------------------------------------------------------------ */
/* İşlem yönleri                                                       */
/* ------------------------------------------------------------------ */

/**
 * MÜŞTERİNİN yönü. Dört opsiyon yönü + eski "düz hisse" kaydı.
 *
 * Başta yalnız `long` ve `put_sell` vardı; müşteri call da yazabildiği/alabildiği için
 * dördü de gerekiyor. `long` (düz hisse alımı) BİLİNÇLİ olarak korunuyor: veritabanında
 * bu tipte kayıtlı satırlar var, kaldırılsa onlar okunamaz hale gelirdi.
 */
export type StockTradeType = 'call_buy' | 'call_sell' | 'put_buy' | 'put_sell' | 'long';

export const STOCK_TRADE_TYPES: StockTradeType[] = ['call_buy', 'call_sell', 'put_buy', 'put_sell', 'long'];

export const STOCK_TRADE_LABELS: Record<StockTradeType, string> = {
  call_buy: 'Call Alışı (müşteri aldı)',
  call_sell: 'Call Satışı (müşteri yazdı)',
  put_buy: 'Put Alışı (müşteri aldı)',
  put_sell: 'Put Satışı (müşteri yazdı)',
  long: 'Düz Hisse Alışı (Long)',
};

/** Kart üstündeki kısa rozet metni. */
export const STOCK_TRADE_SHORT: Record<StockTradeType, string> = {
  call_buy: 'Call Alış',
  call_sell: 'Call Satış',
  put_buy: 'Put Alış',
  put_sell: 'Put Satış',
  long: 'Hisse Long',
};

export const isOptionTrade = (t: StockTradeType) => t !== 'long';
const isCall = (t: StockTradeType) => t === 'call_buy' || t === 'call_sell';
/** Müşteri primi ALDI mı (yazdı mı)? Aldıysa prim gelir, ödediyse maliyettir. */
const isWriter = (t: StockTradeType) => t === 'call_sell' || t === 'put_sell';

export function normalizeStockTradeType(v: unknown): StockTradeType | null {
  return typeof v === 'string' && (STOCK_TRADE_TYPES as string[]).includes(v)
    ? (v as StockTradeType)
    : null;
}

/**
 * Vade sonu kar/zarar (müşteri açısından, toplam TL).
 *   Yazan (satan)  : prim − içsel değer × miktar
 *   Alan           : içsel değer × miktar − prim
 *   Düz hisse      : (fiyat − maliyet) × miktar + prim
 * `premium` her zaman POZİTİF girilir; yön işareti burada uygulanır.
 */
export function stockPnL(
  type: StockTradeType,
  price: number,
  basePrice: number,
  quantity: number,
  premium: number,
): number {
  if (type === 'long') return (price - basePrice) * quantity + premium;
  const intrinsic = isCall(type)
    ? Math.max(0, price - basePrice) * quantity
    : Math.max(0, basePrice - price) * quantity;
  return isWriter(type) ? premium - intrinsic : intrinsic - premium;
}

/** Net K/Z'nin sıfırlandığı hisse fiyatı. */
export function stockBreakEven(
  type: StockTradeType,
  basePrice: number,
  quantity: number,
  premium: number,
): number | null {
  if (!(quantity > 0) || !Number.isFinite(basePrice) || !Number.isFinite(premium)) return null;
  const perShare = premium / quantity;
  if (type === 'long') return basePrice - perShare;
  return isCall(type) ? basePrice + perShare : basePrice - perShare;
}

/** Başabaşın hangi tarafı müşteri lehine? */
export function stockProfitSide(type: StockTradeType): 'above' | 'below' {
  if (type === 'long' || type === 'call_buy' || type === 'put_sell') return 'above';
  return 'below';
}
