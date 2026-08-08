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
