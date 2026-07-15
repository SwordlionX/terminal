import { dbc } from '@/lib/db';
import { VolSurface } from '@/lib/vol/surface';
import { buildCmeSurface, CmeOptionDef } from '@/lib/vol/cme';

/**
 * CME COMEX veri kaynağı — Databento GLBX.MDP3 settlement'ından IV yüzeyi.
 *
 * Databento historical CANLI değildir (veri ~1 seans geride) ve settlement fiyatı zaten
 * yalnızca seans kapanışında oluşur. Bu yüzden model: günde 1 kez (kapanış sonrası) çek,
 * kurulan yüzeyi `kv` tablosuna yaz, site oradan anında okusun. Ağır binom inversiyonu
 * refresh anında bir kez çalışır; sayfa açılışlarında tekrar hesaplanmaz.
 *
 * Databento API anahtarı: DATABENTO_API_KEY (yerelde .env.local, Vercel'de proje env).
 */

const HIST = 'https://hist.databento.com/v0';
const DATASET = 'GLBX.MDP3';

// Gerçek bir kapanış seansında gümüş futures eğrisinin çoğu ayı settle olur (~20+).
// Cari (yarım) seansta yalnız birkaç enstrüman settle olmuş olur; bu eşik onu eler.
const MIN_FUT_SETTLE = 10;

// Faz 1 kapsamı: yalnız gümüş. XAG -> opsiyon kökü SO.OPT, dayanak futures kökü SI.FUT.
const CME_PRODUCTS: Record<string, { optRoot: string; futRoot: string }> = {
  XAG: { optRoot: 'SO.OPT', futRoot: 'SI.FUT' },
};

export function cmeSupported(product: string): boolean {
  return !!CME_PRODUCTS[product.toUpperCase()];
}

function authHeader(): string {
  const key = process.env.DATABENTO_API_KEY;
  if (!key) throw new Error('DATABENTO_API_KEY tanımlı değil (.env.local veya Vercel env)');
  return 'Basic ' + Buffer.from(key + ':').toString('base64');
}

function rangeUrl(schema: string, symbols: string, start: string, end: string): string {
  const p = new URLSearchParams({
    dataset: DATASET, schema, symbols, stype_in: 'parent',
    start, end, encoding: 'csv',
  });
  return `${HIST}/timeseries.get_range?${p.toString()}`;
}

/** Dataset statistics şemasının mevcut veri bitişi (tam ISO zaman damgası). */
async function getAvailableEnd(): Promise<string> {
  const res = await fetch(`${HIST}/metadata.get_dataset_range?dataset=${DATASET}`, {
    headers: { Authorization: authHeader() }, cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Databento aralık sorgusu başarısız: HTTP ${res.status}`);
  const j = await res.json();
  const end: string = j?.schema?.statistics?.end || j?.end;
  if (!end) throw new Error('Databento statistics aralığı okunamadı');
  return end;
}

const isoDate = (t: number): string => new Date(t).toISOString().slice(0, 10);

/**
 * Bir günün [00:00, 23:59:59] penceresi — `end`, mevcut veri sonunu (availableEnd) AŞMAZ.
 * Cari (açık) seansta availableEnd henüz gün ortasında olduğu için tam-gün istemek 422
 * (data_end_after_available_end) verir; bu yüzden sınırlanır.
 */
function dayWindow(date: string, availableEnd: string): { start: string; end: string } {
  const start = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59`;
  const cap = availableEnd.slice(0, 19); // "YYYY-MM-DDTHH:MM:SS"
  const end = Date.parse(`${dayEnd}Z`) <= Date.parse(`${cap}Z`) ? dayEnd : cap;
  return { start, end };
}

const CSV_TIMEOUT_MS = 90_000;

/** Küçük CSV'yi (definition ~MB) tümüyle indirip satırlara böler. */
async function fetchCsvLines(url: string): Promise<string[]> {
  const res = await fetch(url, {
    headers: { Authorization: authHeader() },
    cache: 'no-store',
    signal: AbortSignal.timeout(CSV_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Databento indirme başarısız: HTTP ${res.status} (${url.split('?')[0]})`);
  const text = await res.text();
  return text.trim().length ? text.trim().split('\n') : [];
}

/**
 * settlement (stat_type=3) fiyatlarını akışla (stream) süzer: instrument_id -> fiyat.
 * statistics yanıtı büyük olabilir (intraday bid/ask stat'ları da içerir); tüm gövdeyi
 * bellekte tutmamak için satır satır işlenir, yalnız settlement satırları saklanır.
 * Fiyat Databento sabit-nokta (1e-9) formatındadır; geçersiz/sentinel değerler atılır.
 */
async function streamSettlements(url: string): Promise<Map<string, number>> {
  const res = await fetch(url, {
    headers: { Authorization: authHeader() },
    cache: 'no-store',
    signal: AbortSignal.timeout(CSV_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Databento settlement indirme başarısız: HTTP ${res.status}`);
  if (!res.body) throw new Error('Databento yanıt gövdesi boş');

  const out = new Map<string, number>();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let header: string[] | null = null;
  let iType = -1, iInst = -1, iPrice = -1;

  const handle = (line: string) => {
    if (!line) return;
    const c = line.split(',');
    if (!header) {
      header = c;
      iType = header.indexOf('stat_type');
      iInst = header.indexOf('instrument_id');
      iPrice = header.indexOf('price');
      return;
    }
    if (c[iType] !== '3') return; // yalnız settlement
    const p = Number(c[iPrice]);
    if (!Number.isFinite(p) || p <= 0 || p >= 9e18) return;
    out.set(c[iInst], p / 1e9); // son kayıt kazanır (final settlement)
  };

  // Her chunk'ta tek split — tamamlanan satırlar işlenir, son yarım satır buf'ta bekler.
  // (Chunk içinde tekrar tekrar buf.slice yapmak O(n²) olurdu; bu lineer kalır.)
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) handle(line.trim());
  }
  handle(buf.trim());
  return out;
}

/** Databento'dan çek, yüzeyi kur, DB'ye yaz. Döner: kurulan yüzey + özet. */
export async function refreshCmeSurface(
  product = 'XAG',
  opts: { date?: string; r?: number } = {},
): Promise<VolSurface> {
  const key = product.toUpperCase();
  const cfg = CME_PRODUCTS[key];
  if (!cfg) throw new Error(`CME kaynağı desteklenmiyor: ${key}`);
  const r = opts.r ?? 0.05;

  const availableEnd = await getAvailableEnd();

  // En son settlement'lı seansı bul. Her aday gün ATOMİK denenir: futures settlement +
  // opsiyon tanımı + opsiyon settlement + yüzey kurulumu. Herhangi biri başarısızsa
  // (cari seans henüz kapanmadı → yetersiz futures; ya da Databento o tarihte parent
  // sembolü geçici çözemiyor → 422) bir ÖNCEKİ güne düşülür. Böylece hem yarım seans
  // hem de tarih-bazlı Databento hıçkırıkları sessizce atlanır.
  const candidates = opts.date
    ? [opts.date]
    : Array.from({ length: 6 }, (_, i) => isoDate(Date.parse(availableEnd.slice(0, 10) + 'T00:00:00Z') - i * 86400000));

  let lastErr = 'aday gün yok';
  for (const cand of candidates) {
    try {
      const { start, end } = dayWindow(cand, availableEnd);

      // 1) Dayanak futures settlement (F kaynağı). Tamamlanmamış seansta yalnız birkaç
      //    enstrüman settle olmuş olur; eşiğin altındaysa bu gün gerçek bir kapanış değil.
      const futSettle = await streamSettlements(rangeUrl('statistics', cfg.futRoot, start, end));
      if (futSettle.size < MIN_FUT_SETTLE) { lastErr = `${cand}: yetersiz futures settlement (${futSettle.size})`; continue; }

      // 2) Opsiyon tanımları — strike/vade/underlying_id eşlemesi (422 burada fırlar → catch)
      const options = parseDefinitions(await fetchCsvLines(rangeUrl('definition', cfg.optRoot, start, end)));
      if (options.size === 0) { lastErr = `${cand}: opsiyon tanımı yok`; continue; }

      // 3) Opsiyon settlement'ları (büyük — akışla süzülür)
      const optSettle = await streamSettlements(rangeUrl('statistics', cfg.optRoot, start, end));

      const evalSec = Math.floor(Date.parse(`${cand}T00:00:00Z`) / 1000);
      const surface = buildCmeSurface(
        { options, optSettle, futSettle, evalSec, fetchedISO: `${cand} CME settlement` }, key, r,
      );
      if (surface.expiries.length === 0) { lastErr = `${cand}: geçerli yüzey kurulamadı`; continue; }

      await saveCmeSurface(key, surface);
      return surface;
    } catch (e) {
      lastErr = `${cand}: ${e instanceof Error ? e.message : 'hata'}`;
    }
  }
  throw new Error(`Son günlerde CME verisi çekilemedi (${lastErr})`);
}

/** definition CSV satırlarını instrument_id -> tanım haritasına çevirir (yalnız C/P, dedupe). */
function parseDefinitions(lines: string[]): Map<string, CmeOptionDef> {
  const out = new Map<string, CmeOptionDef>();
  if (lines.length < 2) return out;
  const h = lines[0].split(',');
  const iInst = h.indexOf('instrument_id'), iClass = h.indexOf('instrument_class'),
    iExp = h.indexOf('expiration'), iStrike = h.indexOf('strike_price'), iUnd = h.indexOf('underlying_id');
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const cls = c[iClass];
    if (cls !== 'C' && cls !== 'P') continue;
    out.set(c[iInst], {
      cls,
      expSec: Number(c[iExp]) / 1e9, // nanosaniye -> saniye
      strike: Number(c[iStrike]) / 1e9,
      und: c[iUnd],
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Kalıcılık (kv) + kaynak seçimi                                      */
/* ------------------------------------------------------------------ */

const surfKey = (product: string) => `cme_surface_${product.toUpperCase()}`;
const srcKey = (product: string) => `datasource_${product.toUpperCase()}`;

export async function saveCmeSurface(product: string, surface: VolSurface): Promise<void> {
  const c = await dbc();
  await c.execute({
    sql: 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
    args: [surfKey(product), JSON.stringify(surface)],
  });
}

export async function loadCmeSurface(product: string): Promise<VolSurface | null> {
  try {
    const c = await dbc();
    const r = await c.execute({ sql: 'SELECT v FROM kv WHERE k = ?', args: [surfKey(product)] });
    if (r.rows.length) return JSON.parse(String(r.rows[0].v)) as VolSurface;
  } catch { /* db yoksa null */ }
  return null;
}

/** Ürünün aktif veri kaynağı ('yahoo' | 'cme'). Varsayılan: yahoo. */
export async function getDataSource(product: string): Promise<'yahoo' | 'cme'> {
  try {
    const c = await dbc();
    const r = await c.execute({ sql: 'SELECT v FROM kv WHERE k = ?', args: [srcKey(product)] });
    if (r.rows.length && String(r.rows[0].v) === 'cme') return 'cme';
  } catch { /* varsayılana düş */ }
  return 'yahoo';
}

export async function setDataSource(product: string, src: 'yahoo' | 'cme'): Promise<void> {
  const c = await dbc();
  await c.execute({
    sql: 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
    args: [srcKey(product), src],
  });
}
