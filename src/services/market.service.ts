import { dbc } from '@/lib/db';
import { YahooSnapshot, SnapshotProduct, VolSurface, buildSurface, PRODUCT_SURFACE_MAP } from '@/lib/vol/surface';
import { getDataSource, loadCmeSurface } from './cme.service';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
// Dakikada bir tazeleme. 30 sn'deydi; süreç-içi önbellek her sunucu örneğinde ayrı
// sayıldığı için sağlayıcı kotasını (Twelve Data ücretsiz: 800 istek/gün) gereksiz yere
// zorluyordu. 60 sn hem ekran için yeterince canlı hem kota açısından rahat.
const SPOT_TTL_MS = 60 * 1000;

// Ürün -> Yahoo spot sembolleri (sırayla denenir, ilk başarılı kullanılır).
// Öncelik: fiilen ÇALIŞAN, ons-bazlı token (-USD) başta -> olmazsa vadeli (=F).
// Not: gerçek-spot sembolleri (XAUUSD=X / XAGUSD=X) Yahoo'da neredeyse her zaman 404
// döndüğü için baştan çıkarıldı — her açılışta boşa bir ağ turu harcıyorlardı. Token
// (PAXG = PAX Gold, XAGX = Silver Token) spota en yakın vekildir; futures carry yüzünden
// sapar (=F kaynağı ekranda "vadeli" uyarısıyla etiketlenir).
const SPOT_SYMBOLS: Record<string, string[]> = {
  XAU: ['PAXG-USD', 'GC=F'],
  XAG: ['XAGX-USD', 'SI=F'],
  GLD: ['GLD'],
  SLV: ['SLV'],
};

interface SpotCacheEntry { price: number; at: number; source: string }
const spotCache: Record<string, SpotCacheEntry> = {};

let snapshotMem: YahooSnapshot | null = null;

/**
 * Kurulmuş Yahoo/ETF yüzeyleri — süreç-içi önbellek (sembol -> yüzey).
 * ÖNBELLEK ANAHTARI ARTIK FAİZ İÇERMİYOR: yüzey yenileme anında REF_RATE ile bir kez
 * kurulup veritabanına yazılıyor (CME yolundaki gibi). Eskiden anahtar `sembol@faiz`'di
 * ve kullanıcı faiz alanında tek rakam değiştirdiğinde 11 saniyelik binom inversiyonu
 * baştan koşuyordu. Faiz uyuşmazlığı artık /api/market'in `rateNote`'uyla bildiriliyor.
 */
const surfaceMem: Record<string, { at: number; val: VolSurface }> = {};
const SURFACE_TTL_MS = 60 * 1000;

/** Yüzeyin kurulduğu referans faiz. Değiştirilirse yeni yenilemede geçerli olur. */
const REF_RATE = 0.05;

const ySurfKey = (sym: string) => `yahoo_surface_${sym.toUpperCase()}`;

// Spot çağrısı ölçüldü: sağlıklı durumda ~250 ms. Zaman aşımı OLMADAN Yahoo takıldığında
// tüm /api/market isteği (dolayısıyla ekranın açılışı) onu bekliyordu. Sınır konunca en
// kötü durumda sıradaki sembole, o da olmazsa eski önbelleğe düşülür.
const SPOT_TIMEOUT_MS = 4000;

async function fetchChartPrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      cache: 'no-store',
      signal: AbortSignal.timeout(SPOT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof p === 'number' && p > 0 ? p : null;
  } catch {
    return null;
  }
}

const TWELVEDATA_KEY = process.env.TWELVEDATA_API_KEY || 'f4289f23003940cfbf46c7825bd8ec3a';
const TIINGO_KEY = process.env.TIINGO_API_KEY || 'af1224275560d5fb3e93aca2a0fa157da7cce183';

async function fetchTwelveDataPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVEDATA_KEY}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(SPOT_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[spot] Twelve Data ${symbol}: HTTP ${res.status}`);
      return null;
    }
    const j = await res.json();
    // Twelve Data hatayı çoğu zaman HTTP 200 GÖVDESİNDE döndürür ({status:"error",code:429}).
    // Sessizce null dönmek, kota dolduğunda ekranın sebepsizce vekil fiyata kaymasına yol
    // açıyordu; sebep en azından sunucu loglarında görünsün.
    if (j?.status === 'error' || j?.code) {
      console.warn(`[spot] Twelve Data ${symbol}: kod=${j.code} ${j.message ?? ''}`);
      return null;
    }
    const p = parseFloat(j.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

async function fetchTiingoPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.tiingo.com/tiingo/fx/top?tickers=${encodeURIComponent(symbol)}&token=${TIINGO_KEY}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(SPOT_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[spot] Tiingo ${symbol}: HTTP ${res.status}`);
      return null;
    }
    const j = await res.json();
    const p = j?.[0]?.midPrice;
    return typeof p === 'number' && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * GERÇEK SPOT sağlayıcı zinciri — ürün başına sırayla denenir, ilk geçerli fiyat kazanır.
 * Bir sağlayıcı düşerse (kota, kesinti, geçici hata) diğeri devreye girer; ikisi de düşerse
 * aşağıdaki token/vadeli VEKİL sembollere inilir.
 *
 * Sıra 2026-08-08'de ölçülerek belirlendi:
 *  - Twelve Data ücretsiz planda XAU/USD var, XAG/USD YOK (HTTP 404) → altın onunla başlar.
 *  - Tiingo'da hem xauusd hem xagusd var → gümüşün birincil kaynağı, altının yedeği.
 * Gümüşte Twelve Data yine de ikinci sırada duruyor: mutlu yolda hiç çağrılmıyor (yalnız
 * Tiingo düşerse denenir), plan yükseltilirse kendiliğinden devreye girer.
 * İki kaynak çapraz doğrulandı: XAU 4342.35 (TD) vs 4341.48 (Tiingo) — %0.02 fark.
 */
const SPOT_PROVIDERS: Record<string, { source: string; get: () => Promise<number | null> }[]> = {
  XAU: [
    { source: 'XAU/USD (Twelve Data)', get: () => fetchTwelveDataPrice('XAU/USD') },
    { source: 'XAU/USD (Tiingo)', get: () => fetchTiingoPrice('xauusd') },
  ],
  XAG: [
    { source: 'XAG/USD (Tiingo)', get: () => fetchTiingoPrice('xagusd') },
    { source: 'XAG/USD (Twelve Data)', get: () => fetchTwelveDataPrice('XAG/USD') },
  ],
};

/**
 * Güncel spot (60 sn önbellekli). Sıra: gerçek-spot sağlayıcılar → token/vadeli vekiller →
 * süresi geçmiş önbellek. Hepsi düşerse null (çağıran taraf kendi fallback'ini uygular).
 * Dönen `source` hangi basamağa inildiğini söyler; ekran rozeti bunu etiketler.
 */
export async function getSpot(product: string): Promise<{ price: number; at: number; source: string } | null> {
  const key = product.toUpperCase();
  const cached = spotCache[key];
  if (cached && Date.now() - cached.at < SPOT_TTL_MS) return cached;

  const remember = (price: number, source: string) => {
    const entry = { price, at: Date.now(), source };
    spotCache[key] = entry;
    return entry;
  };

  for (const p of SPOT_PROVIDERS[key] ?? []) {
    const price = await p.get();
    if (price != null) return remember(price, p.source);
  }

  // Vekil: token (PAXG/XAGX) ya da vadeli (=F). Gerçek spot DEĞİL — ekranda etiketiyle belli.
  for (const sym of SPOT_SYMBOLS[key] || [key]) {
    const price = await fetchChartPrice(sym);
    if (price != null) {
      console.warn(`[spot] ${key}: gerçek-spot sağlayıcıları düştü, vekile inildi (${sym})`);
      return remember(price, sym);
    }
  }

  if (cached) console.warn(`[spot] ${key}: tüm kaynaklar düştü, süresi geçmiş önbellek kullanılıyor`);
  return cached || null;
}

/**
 * USD/TRY kuru — teminat motorunun 1.000.000 TL onay eşiği (Şube Müdürü vs Genel Müdür) bu kuru
 * kullanır. `kv` tablosunda saklanır ki Ayarlar sayfasından (server-side) güncellenebilsin;
 * store/marketData.ts'teki `usdtry` yalnızca tarayıcıda tutulur ve sunucu tarafı hesaplara hiç
 * ulaşmaz — o yüzden eşik hesabı için ayrı bir kalıcı değer gerekiyor.
 */
export async function getUsdTryRate(): Promise<number> {
  try {
    const c = await dbc();
    const r = await c.execute("SELECT v FROM kv WHERE k = 'usdtry_rate'");
    if (r.rows.length) {
      const v = Number(r.rows[0].v);
      if (Number.isFinite(v) && v > 0) return v;
    }
  } catch { /* db yoksa varsayılana düş */ }
  return 35.0;
}

export async function setUsdTryRate(rate: number): Promise<void> {
  const c = await dbc();
  await c.execute({
    sql: "INSERT INTO kv (k, v) VALUES ('usdtry_rate', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    args: [rate.toString()],
  });
}

/** Global risksiz faiz oranı — gece yüzey kurulurken bu kullanılır. */
export async function getInterestRate(): Promise<number> {
  try {
    const c = await dbc();
    const r = await c.execute("SELECT v FROM kv WHERE k = 'interest_rate'");
    if (r.rows.length) {
      const v = Number(r.rows[0].v);
      if (Number.isFinite(v) && v >= 0) return v;
    }
  } catch { /* db yoksa varsayılan 5% */ }
  return 0.05;
}

export async function setInterestRate(rate: number): Promise<void> {
  const c = await dbc();
  await c.execute({
    sql: "INSERT INTO kv (k, v) VALUES ('interest_rate', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    args: [rate.toString()],
  });
}

/**
 * Yahoo snapshot'ı — TEK kaynak: veritabanı (kv).
 * Dosya yedeği (data/yahoo_snapshot.json) bilinçli olarak KALDIRILDI: repoyla gelen
 * bayat bir kopya, DB'ye ulaşılamadığında sessizce devreye girip "güncel veri okuyorum"
 * yanılsaması yaratıyordu. Artık veri yoksa null döner ve ekran bunu açıkça söyler.
 */
export async function loadSnapshot(): Promise<YahooSnapshot | null> {
  if (snapshotMem) return snapshotMem;
  const c = await dbc();
  const r = await c.execute("SELECT v FROM kv WHERE k = 'yahoo_snapshot'");
  if (!r.rows.length) return null;
  snapshotMem = JSON.parse(String(r.rows[0].v)) as YahooSnapshot;
  return snapshotMem;
}

export async function saveSnapshot(snap: YahooSnapshot): Promise<void> {
  snapshotMem = snap;
  Object.keys(surfaceMem).forEach(k => delete surfaceMem[k]);
  const c = await dbc();
  await c.execute({
    sql: "INSERT INTO kv (k, v) VALUES ('yahoo_snapshot', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    args: [JSON.stringify(snap)],
  });
}

/** Kurulmuş Yahoo/ETF yüzeyini kalıcı yazar (ham zincirlerin yanına, ayrı anahtara). */
async function saveYahooSurface(sym: string, surface: VolSurface): Promise<void> {
  surfaceMem[sym] = { at: Date.now(), val: surface };
  const c = await dbc();
  await c.execute({
    sql: 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
    args: [ySurfKey(sym), JSON.stringify(surface)],
  });
}

async function loadYahooSurface(sym: string): Promise<VolSurface | null> {
  const hit = surfaceMem[sym];
  if (hit && Date.now() - hit.at < SURFACE_TTL_MS) return hit.val;

  const c = await dbc();
  const r = await c.execute({ sql: 'SELECT v FROM kv WHERE k = ?', args: [ySurfKey(sym)] });
  if (!r.rows.length) return null;
  const val = JSON.parse(String(r.rows[0].v)) as VolSurface;
  surfaceMem[sym] = { at: Date.now(), val };
  return val;
}

/**
 * Ürün için de-Amerikanize IV yüzeyi. HER İKİ kaynakta da yüzey ÖNCEDEN KURULMUŞTUR;
 * burada ağır hesap yapılmaz — istek yolunda yalnız okuma vardır.
 *
 * Neden: Yahoo yüzeyi eskiden her istekte sıfırdan kuruluyordu. Amerikan opsiyonlarının
 * de-Amerikanizasyonu (200 adımlı binom + bisection, ~1900 kotasyon) ÖLÇÜLDÜ: GLD 11.3 sn,
 * SLV 5.4 sn. Üstelik önbellek anahtarı faiz içerdiği için faiz alanında tek rakam
 * değiştirmek bunu baştan tetikliyordu. Artık yüzey yenileme anında bir kez kurulup
 * `yahoo_surface_<SEMBOL>` anahtarına yazılıyor; okuma milisaniyeler sürüyor.
 *
 * `r` yalnızca eski veriden (bu değişiklikten önce alınmış snapshot) yüzey kurmak
 * gerekirse kullanılır. Kurulu yüzeyin faizi `builtWithR`'da taşınır ve ekranda girili
 * faizle uyuşmuyorsa /api/market bunu `rateNote` olarak bildirir.
 */
export async function getSurface(product: string, r: number): Promise<VolSurface | null> {
  const key = product.toUpperCase();
  if ((await getDataSource(key)) === 'cme') {
    return loadCmeSurface(key);
  }

  const sym = PRODUCT_SURFACE_MAP[key];
  if (!sym) return null;

  const stored = await loadYahooSurface(sym);
  if (stored) return stored;

  // Kurulu yüzey yok (bu değişiklikten önce çekilmiş snapshot). Bir kez kurulur ve
  // KALICI olarak yazılır — sonraki açılışlar yeniden beklemez.
  const snap = await loadSnapshot();
  const prod = snap?.products?.[sym];
  if (!snap || !prod) return null;

  const surface = buildSurface(prod, r, snap.fetchedISO);
  await saveYahooSurface(sym, surface);
  return surface;
}

/* ------------------------------------------------------------------ */
/* Snapshot yenileme — fetch_yahoo.py'nin TypeScript portu             */
/* ------------------------------------------------------------------ */

const MAX_DAYS = 420;
const MONEY_LO = 0.72, MONEY_HI = 1.35;

async function yahooGet(url: string, cookie: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}) },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

export async function refreshSnapshot(): Promise<YahooSnapshot> {
  // 1. Cookie al
  let cookie = '';
  try {
    const res = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
      cache: 'no-store',
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
  } catch { /* 404 döner ama cookie bırakabilir */ }

  // 2. Crumb al
  const crumb = await yahooGet('https://query1.finance.yahoo.com/v1/test/getcrumb', cookie);
  if (!crumb || crumb.includes('<')) throw new Error('Geçersiz crumb (Yahoo rate-limit olabilir, biraz bekleyip tekrar deneyin)');

  const now = Math.floor(Date.now() / 1000);
  const out: YahooSnapshot = {
    fetched: now,
    fetchedISO: new Date(now * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    products: {},
  };

  for (const [sym, label] of [['GLD', 'GLD (Altın ETF)'], ['SLV', 'SLV (Gümüş ETF)']] as const) {
    const base = `https://query1.finance.yahoo.com/v7/finance/options/${sym}?crumb=${encodeURIComponent(crumb)}`;
    const d = JSON.parse(await yahooGet(base, cookie)).optionChain.result[0];
    const spot: number = d.quote.regularMarketPrice;
    const expiries: number[] = (d.expirationDates as number[]).filter(
      e => (e - now) / 86400 <= MAX_DAYS && e > now
    );

    const prod: SnapshotProduct = { symbol: sym, label, spot, expiries: [] };

    for (const exp of expiries) {
      await new Promise(r => setTimeout(r, 400)); // rate-limit nezaketi
      let dd;
      try {
        dd = JSON.parse(await yahooGet(`${base}&date=${exp}`, cookie)).optionChain.result[0];
      } catch { continue; }
      const opts = dd.options[0];
      const days = Math.round(((exp - now) / 86400) * 10) / 10;
      const calls = new Map<number, Record<string, number>>((opts.calls || []).map((c: Record<string, number>) => [c.strike, c]));
      const puts = new Map<number, Record<string, number>>((opts.puts || []).map((p: Record<string, number>) => [p.strike, p]));
      const strikes = [...new Set([...calls.keys(), ...puts.keys()])].sort((a, b) => a - b);

      const f = (o: Record<string, number> | undefined, fld: string): number | null => {
        const v = o?.[fld];
        return typeof v === 'number' ? Math.round(v * 10000) / 10000 : null;
      };

      const rows = strikes
        .filter(k => k / spot >= MONEY_LO && k / spot <= MONEY_HI)
        .map(k => {
          const c = calls.get(k), p = puts.get(k);
          return [
            k,
            f(c, 'bid'), f(c, 'ask'), f(c, 'lastPrice'), f(c, 'impliedVolatility'),
            f(p, 'bid'), f(p, 'ask'), f(p, 'lastPrice'), f(p, 'impliedVolatility'),
            c?.openInterest ?? null, p?.openInterest ?? null,
          ];
        });

      if (rows.length) {
        prod.expiries.push({
          exp, days,
          date: new Date(exp * 1000).toISOString().slice(0, 10),
          rows,
        });
      }
    }
    out.products[sym] = prod;
  }

  await saveSnapshot(out);

  // Ağır iş BURADA yapılır, kullanıcının önünde değil: de-Amerikanize yüzeyler yenileme
  // anında bir kez kurulup kalıcı yazılır (CME yolundaki modelin aynısı). Bir sembol
  // kurulamazsa diğeri yine de yazılır — yenilemenin tamamı çöpe gitmez.
  for (const [sym, prod] of Object.entries(out.products)) {
    try {
      await saveYahooSurface(sym, buildSurface(prod, REF_RATE, out.fetchedISO));
    } catch { /* bu sembolde yüzey kurulamadı; getSurface gerekirse tekrar dener */ }
  }

  return out;
}
