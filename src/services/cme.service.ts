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

/**
 * Gerçek bir kapanış seansında metal futures eğrisinin tamamı settle olur; bu eşik
 * yarım/kapanmamış seansı eler.
 *
 * Ölçüldü (2026-08-08, 6 işlem günü): altın HER GÜN tam 34, gümüş 32 enstrüman
 * (2025-12-10'da 31 — listelenen kontrat sayısı zamanla azıcık oynuyor). Yani sağlıklı
 * bir günde sayı 30'un üzerinde; eşiğin 10 olması bol bol pay bırakıyor.
 *
 * TARİHÇE: bu değer bir ara 3'e indirilmişti, çünkü yüzey günlerce eski veriye düşüyordu.
 * Ölçüm gösterdi ki sebep eşik DEĞİLDİ — 3, 10 ve 15 aynı günü seçiyordu. Asıl sebep
 * opsiyon sorgusunun 348 MB'a çıkıp Databento ağ geçidinde 504 vermesiydi (bkz.
 * SETTLE_WINDOW). Eşik düşürmek bir şeyi düzeltmedi, yalnız emniyet payını aldı.
 */
const MIN_FUT_SETTLE = 10;

/**
 * CME COMEX kökleri — altın ve gümüş.
 *  - optRoot     : ANA (aylık) opsiyon kökü — bulunamazsa o gün geçersiz sayılır.
 *  - weeklyRoots : haftalık opsiyon kökleri — yüzeyin KISA VADE ucunu doldururlar.
 *                  Aylıklar tek başına kaldığında en yakın vade ~29 güne kadar çıkabiliyor
 *                  ve ondan kısa opsiyonlar "kote yok"a düşüyordu. Haftalıklar belirli
 *                  haftalarda listelendiği için bir kısmı her gün çözülmeyebilir —
 *                  bulunamayan kök sessizce atlanır (refresh'i bozmaz).
 *                  Maliyet ihmal edilebilir (~aylık kökün %5'i).
 *  - futRoot     : dayanak futures kökü (forward kaynağı).
 */
const CME_PRODUCTS: Record<string, { optRoot: string; weeklyRoots: string[]; futRoot: string }> = {
  XAU: {
    optRoot: 'OG.OPT',
    weeklyRoots: ['OG1.OPT', 'OG2.OPT', 'OG3.OPT', 'OG4.OPT', 'OG5.OPT'],
    futRoot: 'GC.FUT',
  },
  XAG: {
    optRoot: 'SO.OPT',
    weeklyRoots: ['SO1.OPT', 'SO2.OPT', 'SO3.OPT', 'SO4.OPT', 'SO5.OPT'],
    futRoot: 'SI.FUT',
  },
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

/** `end`, mevcut veri sonunu (availableEnd) AŞMAZ — aşarsa Databento 422 döndürür. */
function capped(date: string, from: string, to: string, availableEnd: string): { start: string; end: string } {
  const start = `${date}T${from}`;
  const wanted = `${date}T${to}`;
  const cap = availableEnd.slice(0, 19); // "YYYY-MM-DDTHH:MM:SS"
  const end = Date.parse(`${wanted}Z`) <= Date.parse(`${cap}Z`) ? wanted : cap;
  return { start, end };
}

/**
 * SETTLEMENT PENCERESİ (statistics şeması için) — günün tamamı DEĞİL, 17:00–19:00 UTC.
 *
 * Neden: `statistics` şeması settlement'ın yanında bütün seans boyu intraday istatistik
 * taşır (açık pozisyon, bid/ask, hacim...). Tam gün istendiğinde opsiyon kökleri için
 * yanıt DEVASA oluyordu ve Databento'nun ağ geçidi ~60 saniyede HTTP 504 basıyordu:
 *   XAU opsiyon (6 kök) tam gün : 348 MB   →  17:00–19:00 :  3.4 MB   (102 kat)
 *   XAG opsiyon (6 kök) tam gün : 133 MB   →  17:00–19:00 :  2.2 MB   ( 60 kat)
 * Her 504 o günü düşürüp bir öncekine geçiyordu; art arda birkaç kez olunca yüzey
 * günlerce eski bir settlement'tan kuruluyordu. Gözlenen semptom buydu.
 *
 * Pencere neden yeterli — ölçüldü (2026-08-08):
 *  - CME settlement'ı gün içinde ÜÇ dalga yayınlıyor (ör. 17:30, 21:39, 23:03 UTC), ama
 *    üçü de BİREBİR AYNI fiyatları taşıyor. Altı ayrı gün × iki üründe fark çıkmadı.
 *  - Opsiyon köklerinde de aynı: XAU 33.948 ve XAG 20.948 settlement, erken pencere ile
 *    geç pencere arasında 0 fark, 0 eksik.
 *  - Kış saatinde (CST) settlement 18:25/18:30 UTC'ye kayıyor — pencere onu da kapsıyor
 *    (2026-01-14 ve 2025-12-10'da doğrulandı).
 *
 * Yan fayda: cron 12:00 UTC'de koştuğunda cari günün penceresi henüz availableEnd'in
 * ötesinde kalır, aşağıdaki geçersizlik kontrolü o günü TEK İSTEK ATMADAN eler.
 */
function settlementWindow(date: string, availableEnd: string) {
  return capped(date, '17:00:00', '19:00:00', availableEnd);
}

/**
 * TANIM PENCERESİ — günün ilk çeyrek saati (00:00–00:15 UTC).
 *
 * Tanımlar (instrument_id → call/put, strike, vade, dayanak) settlement fiyatlarının
 * sözlüğüdür: onlar olmadan elde 34.000 isimsiz sayı kalır, smile kurulamaz.
 *
 * Ölçüldü (2026-08-06 ve 08-07): tanımların TAMAMI gün başında tek seferde yayınlanıyor.
 * XAU'da 33.948 kaydın 33.946'sı 00:00 UTC diliminde, yalnız 2 tanesi gün içinde geliyor.
 *   pencere        XAU              XAG
 *   00:00-00:05    33.946-33.948    20.946-20.948
 *   00:00-00:15    33.946-33.948    20.946-20.948   ← seçilen (aynı sayı, biraz pay)
 *   00:00-23:59    33.948           20.948          (aynı veri, ~60 sn + sık 504)
 *
 * Neden dar pencere daha güvenilir: indirilen veri her iki durumda da aynı (~20 MB), ama
 * Databento'nun TARADIĞI aralık küçüldüğü için sorgu hazırlığı hızlanıyor — 60 sn'de
 * 504 veren sorgu 12-25 sn'de dönüyor. (Aynı gün 00:00-01:00 hâlâ 504 verebiliyordu.)
 *
 * Gün içinde listelenen 1-2 yeni enstrüman bu pencereye girmez; o gün zaten settlement'ları
 * olmadığı için yüzeye katkıları yok.
 */
function definitionWindow(date: string, availableEnd: string) {
  return capped(date, '00:00:00', '00:15:00', availableEnd);
}

const CSV_TIMEOUT_MS = 90_000;

/**
 * Databento'nun ağ geçidi büyük/yavaş sorgularda ARADA BİR 504 döndürüyor. Tek bir 504
 * eskiden o günü tamamen düşürüyordu; pencere daraltıldıktan sonra beklenmiyor ama
 * ucuz bir sigorta olarak birkaç kez yeniden deneniyor.
 */
const MAX_TRIES = 3;

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_TRIES) {
        console.warn(`[CME] ${label}: ${attempt}. deneme başarısız (${e instanceof Error ? e.message : e}) — yeniden deneniyor`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }
  throw lastErr;
}

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
interface SettlementBatch {
  /** instrument_id -> settlement fiyatı */
  prices: Map<string, number>;
  /** Partideki EN GEÇ ts_event (epoch saniye) — settlement'ın gözlendiği an. */
  lastEventSec: number;
}

async function streamSettlements(url: string): Promise<SettlementBatch> {
  const res = await fetch(url, {
    headers: { Authorization: authHeader() },
    cache: 'no-store',
    signal: AbortSignal.timeout(CSV_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Databento settlement indirme başarısız: HTTP ${res.status}`);
  if (!res.body) throw new Error('Databento yanıt gövdesi boş');

  const out = new Map<string, number>();
  let lastEventSec = 0;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let header: string[] | null = null;
  let iType = -1, iInst = -1, iPrice = -1, iTs = -1;

  const handle = (line: string) => {
    if (!line) return;
    const c = line.split(',');
    if (!header) {
      header = c;
      iType = header.indexOf('stat_type');
      iInst = header.indexOf('instrument_id');
      iPrice = header.indexOf('price');
      iTs = header.indexOf('ts_event');
      return;
    }
    if (c[iType] !== '3') return; // yalnız settlement
    const p = Number(c[iPrice]);
    if (!Number.isFinite(p) || p <= 0 || p >= 9e18) return;
    out.set(c[iInst], p / 1e9); // son kayıt kazanır (final settlement)
    // ts_event ham NANOSANİYE epoch (~1.79e18). Bu değer Number'ın güvenli tamsayı
    // aralığını (9.0e15) aşar, ama kaybedilen hassasiyet en fazla birkaç yüz nanosaniye —
    // saniyeye böldüğümüzde ~3e-7 sn eder, yani önemsiz. BigInt'e gerek yok.
    if (iTs >= 0 && c[iTs]) {
      const sec = Math.floor(Number(c[iTs]) / 1e9);
      if (Number.isFinite(sec) && sec > lastEventSec) lastEventSec = sec;
    }
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
  return { prices: out, lastEventSec };
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
  // Hafta sonları elenir: COMEX metallerde Cts/Paz settlement oluşmaz, o günleri denemek
  // yalnızca boşa istek demek (Databento'nun timeseries ucu istek başına ~20sn gecikmeli).
  // Resmi tatiller yine de denenir — onları eleyen, aşağıdaki MIN_FUT_SETTLE kontrolü.
  const candidates = opts.date
    ? [opts.date]
    : Array.from({ length: 8 }, (_, i) => isoDate(Date.parse(availableEnd.slice(0, 10) + 'T00:00:00Z') - i * 86400000))
        .filter(d => { const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); return wd !== 0 && wd !== 6; })
        .slice(0, 5);

  let lastErr = 'aday gün yok';
  const skippedErrs: string[] = [];
  for (const cand of candidates) {
    try {
      // Her iki sorgu da DAR pencerede: settlement 17:00–19:00, tanımlar 00:00–00:15 UTC.
      const settle = settlementWindow(cand, availableEnd);
      if (Date.parse(settle.start + 'Z') >= Date.parse(settle.end + 'Z')) {
        // Cari gün: settlement saati henüz gelmemiş. Hiç istek atılmadan elenir.
        throw new Error(`settlement penceresi henüz oluşmadı (${settle.start} > mevcut veri sonu)`);
      }

      // 1) Dayanak futures settlement (F kaynağı). Tamamlanmamış seansta bu pencere boş
      //    döner; eşiğin altındaysa bu gün gerçek bir kapanış değil.
      const futBatch = await withRetry(`${key} futures settlement ${cand}`,
        () => streamSettlements(rangeUrl('statistics', cfg.futRoot, settle.start, settle.end)));
      const futSettle = futBatch.prices;
      if (futSettle.size < MIN_FUT_SETTLE) {
        lastErr = `${cand}: yetersiz futures settlement (${futSettle.size})`;
        skippedErrs.push(lastErr);
        continue; 
      }

      // 2) Opsiyon TANIMLARI — aylık + haftalık kökler TEK istekte.
      //    Databento'nun timeseries uçları istek başına ~20sn sabit gecikmeli (48 KB'lık
      //    istek bile ~22sn); bu yüzden kritik olan indirilen HACİM değil, İSTEK SAYISI.
      //    Çözülemeyen kök (ör. o hafta listelenmemiş SO3) sorun çıkarmaz: Databento
      //    yalnız HİÇBİRİ çözülemezse hata verir, kısmi çözümde isteği başarıyla döndürür.
      const optRoots = [cfg.optRoot, ...cfg.weeklyRoots].join(',');
      const defWin = definitionWindow(cand, availableEnd);
      const options = parseDefinitions(await withRetry(`${key} opsiyon tanımı ${cand}`,
        () => fetchCsvLines(rangeUrl('definition', optRoots, defWin.start, defWin.end))));
      if (options.size === 0) {
        lastErr = `${cand}: opsiyon tanımı yok`; 
        skippedErrs.push(lastErr);
        continue; 
      }

      // 3) Opsiyon settlement'ları — yine TEK istek, dar pencerede, akışla süzülür.
      const optSettle = (await withRetry(`${key} opsiyon settlement ${cand}`,
        () => streamSettlements(rangeUrl('statistics', optRoots, settle.start, settle.end)))).prices;

      /**
       * DEĞERLEME ANI = settlement'ın gerçekten gözlendiği an (futures stat'larının en geç
       * ts_event'i), gün başı DEĞİL.
       *
       * Eskiden `cand`ın 00:00'ı kullanılıyordu; oysa settlement 17:30 UTC'de (kışın 18:30)
       * oluşuyor. Bu, vadeye kalan süreyi 17.5 saat FAZLA gösteriyordu ve IV'ler o oranda
       * DÜŞÜK çözülüyordu. Ölçüldü (XAU, 2026-08-07):
       *     7.7g → 7g   ATM %22.64 → %23.74   (+1.10 vol puanı, %4.9 göreli)
       *    14.7g → 14g  ATM %22.36 → %22.91   (+0.55)
       *    48.7g → 48g  ATM %22.73 → %22.89   (+0.16)
       * Hata kısa vadede büyük, uzun vadede sönüyor.
       *
       * İkinci ve daha sinsi etki: vade etiketleri. Doğru çapayla vadeler tam sayıya
       * oturuyor (7, 14, 19, 48 gün) çünkü opsiyon 18:30 UTC'de, settlement 17:30 UTC'de.
       * Fiyatlama ekranı vadeyi TAKVİM GÜNÜ sayıyor (7 gün); yüzey 7.7 dediği için en yakın
       * vade `surfaceVol`un kote aralığının ALTINA düşüyor ve null dönüyordu — yani en kısa
       * vadeli opsiyon hiç fiyatlanamıyordu.
       *
       * Damga veriden okunur, sabit yazılmaz: yaz/kış saati (CDT/CST) kaymasını kendiliğinden
       * takip eder. Beklenmedik biçimde okunamazsa gün başına düşülür (eski davranış).
       */
      const evalSec = futBatch.lastEventSec > 0
        ? futBatch.lastEventSec
        : Math.floor(Date.parse(`${cand}T00:00:00Z`) / 1000);
      // fetchedISO HER ZAMAN sade bir tarih etiketidir — ekranda tarih olarak gösteriliyor.
      // Atlanan günlerin sebebi ayrı `notes` alanına yazılır (bkz. VolSurface.notes).
      const surface = buildCmeSurface(
        { options, optSettle, futSettle, evalSec, fetchedISO: `${cand} CME settlement` }, key, r,
      );
      if (surface.expiries.length === 0) { 
        lastErr = `${cand}: geçerli yüzey kurulamadı`; 
        skippedErrs.push(lastErr);
        continue; 
      }

      if (skippedErrs.length > 0) {
        console.warn(`[CME] ${key} - ${cand} tarihine düşüldü. Hatalar:`, skippedErrs.join(' | '));
        surface.notes = `${skippedErrs.length} gün atlandı → ${skippedErrs.join(' | ')}`;
      }
      await saveCmeSurface(key, surface);
      return surface;
    } catch (e) {
      lastErr = `${cand}: ${e instanceof Error ? e.message : 'hata'}`;
      skippedErrs.push(lastErr);
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

/**
 * Süreç-içi yüzey önbelleği. Sayfa her açılışında ~90KB JSON'ın Turso'dan çekilip parse
 * edilmesi gecikmenin büyük kısmıydı; yüzey günde bir kez değiştiği için TTL'li memo güvenli.
 * Yazma yolu (saveCmeSurface) aynı süreçte önbelleği anında tazeler; başka bir sunucu
 * örneği (serverless) en fazla TTL kadar geç görür.
 *
 * NOT: Aktif KAYNAK (yahoo/cme) bilinçli olarak önbelleğe ALINMAZ. Tek satırlık ucuz bir
 * sorgu, buna karşılık önbelleğe alınırsa Ayarlar'dan kaynak değiştirildiğinde fiyatlama
 * ekranı TTL boyunca eski kaynağı göstermeye devam ediyordu.
 */
const SURFACE_TTL_MS = 5 * 60 * 1000;
const surfaceCache = new Map<string, { at: number; val: VolSurface | null }>();

export async function saveCmeSurface(product: string, surface: VolSurface): Promise<void> {
  const key = product.toUpperCase();
  const c = await dbc();
  await c.execute({
    sql: 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
    args: [surfKey(key), JSON.stringify(surface)],
  });
  surfaceCache.set(key, { at: Date.now(), val: surface });
}

export async function loadCmeSurface(product: string): Promise<VolSurface | null> {
  const key = product.toUpperCase();
  const hit = surfaceCache.get(key);
  if (hit && Date.now() - hit.at < SURFACE_TTL_MS) return hit.val;

  const c = await dbc();
  const r = await c.execute({ sql: 'SELECT v FROM kv WHERE k = ?', args: [surfKey(key)] });
  const val = r.rows.length ? (JSON.parse(String(r.rows[0].v)) as VolSurface) : null;
  surfaceCache.set(key, { at: Date.now(), val });
  return val;
}

/**
 * Ürünün aktif veri kaynağı. VARSAYILAN: CME COMEX (destekleniyorsa).
 *
 * CME, vadeli settlement'tan gelen gözlemlenen forward'ı taşır ve ETF vekili üzerinden
 * geçmez — asıl kaynak odur. Yahoo/ETF yolu bilinçli bir tercih olarak kalır: yalnız
 * kv'de açıkça 'yahoo' yazıyorsa kullanılır. CME'yi desteklemeyen bir ürün eklenirse
 * (ör. platin) o üründe otomatik olarak Yahoo'ya düşer.
 *
 * Önbelleklenmez (bkz. yukarı): önbelleklenirse Ayarlar'dan kaynak değiştirmek ekrana
 * TTL boyunca yansımıyordu.
 */
export async function getDataSource(product: string): Promise<'yahoo' | 'cme'> {
  const key = product.toUpperCase();
  const c = await dbc();
  const r = await c.execute({ sql: 'SELECT v FROM kv WHERE k = ?', args: [srcKey(key)] });
  if (r.rows.length && String(r.rows[0].v) === 'yahoo') return 'yahoo';
  return cmeSupported(key) ? 'cme' : 'yahoo';
}

export async function setDataSource(product: string, src: 'yahoo' | 'cme'): Promise<void> {
  const c = await dbc();
  await c.execute({
    sql: 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
    args: [srcKey(product.toUpperCase()), src],
  });
}
