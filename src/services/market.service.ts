import fs from 'fs';
import path from 'path';
import { dbc } from '@/lib/db';
import { YahooSnapshot, SnapshotProduct, VolSurface, buildSurface, PRODUCT_SURFACE_MAP } from '@/lib/vol/surface';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const SPOT_TTL_MS = 5 * 60 * 1000; // 5 dakika önbellek — sayfa açıkken tekrar tekrar Yahoo'ya gidilmez
const SNAPSHOT_FILE = path.join(process.cwd(), 'data', 'yahoo_snapshot.json');

// Ürün -> Yahoo spot sembolleri (sırayla denenir).
// Öncelik: gerçek spot (=X) -> fiziksel teminatlı token (-USD) -> vadeli (=F).
// Not: XAUUSD=X / XAGUSD=X Yahoo'da sık 404 döner; o durumda ons-bazlı token
// (PAXG = PAX Gold, XAGX = Silver Token) spota en yakın vekildir, futures ise
// carry yüzünden sapar. Kaynak tipi ekranda etiketlenir (=X spot, -USD token, =F vadeli).
const SPOT_SYMBOLS: Record<string, string[]> = {
  XAU: ['XAUUSD=X', 'PAXG-USD', 'GC=F'],
  XAG: ['XAGUSD=X', 'XAGX-USD', 'SI=F'],
  GLD: ['GLD'],
  SLV: ['SLV'],
};

interface SpotCacheEntry { price: number; at: number; source: string }
const spotCache: Record<string, SpotCacheEntry> = {};

let snapshotMem: YahooSnapshot | null = null;
const surfaceMem: Record<string, VolSurface> = {};

async function fetchChartPrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
    if (!res.ok) return null;
    const j = await res.json();
    const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof p === 'number' && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/** Güncel spot — 5 dk önbellekli. Başarısız olursa null (çağıran taraf fallback uygular). */
export async function getSpot(product: string): Promise<{ price: number; at: number; source: string } | null> {
  const key = product.toUpperCase();
  const cached = spotCache[key];
  if (cached && Date.now() - cached.at < SPOT_TTL_MS) return cached;

  for (const sym of SPOT_SYMBOLS[key] || [key]) {
    const p = await fetchChartPrice(sym);
    if (p != null) {
      const entry = { price: p, at: Date.now(), source: sym };
      spotCache[key] = entry;
      return entry;
    }
  }
  return cached || null; // eski önbellek varsa onu döndür
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
    args: [String(rate)],
  });
}

export async function loadSnapshot(): Promise<YahooSnapshot | null> {
  if (snapshotMem) return snapshotMem;
  // 1) Veritabanı (Vercel'de kalıcı olan tek yer)
  try {
    const c = await dbc();
    const r = await c.execute("SELECT v FROM kv WHERE k = 'yahoo_snapshot'");
    if (r.rows.length) {
      snapshotMem = JSON.parse(String(r.rows[0].v)) as YahooSnapshot;
      return snapshotMem;
    }
  } catch { /* veritabanına ulaşılamazsa dosyaya düş */ }
  // 2) Depoyla gelen dosya (ilk kurulum / yerel geliştirme)
  try {
    const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf-8');
    snapshotMem = JSON.parse(raw) as YahooSnapshot;
    return snapshotMem;
  } catch {
    return null;
  }
}

export async function saveSnapshot(snap: YahooSnapshot): Promise<void> {
  snapshotMem = snap;
  Object.keys(surfaceMem).forEach(k => delete surfaceMem[k]);
  // Veritabanına yaz (kalıcı)
  try {
    const c = await dbc();
    await c.execute({
      sql: "INSERT INTO kv (k, v) VALUES ('yahoo_snapshot', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      args: [JSON.stringify(snap)],
    });
  } catch { /* db yoksa bellekte kalır */ }
  // Yerel geliştirmede dosyaya da yaz
  try {
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap));
  } catch { /* salt-okunur FS (Vercel) — sorun değil */ }
}

/** Ürün için de-Amerikanize IV yüzeyi (bellekte tutulur, snapshot değişince yenilenir). */
export async function getSurface(product: string, r: number): Promise<VolSurface | null> {
  const sym = PRODUCT_SURFACE_MAP[product.toUpperCase()];
  if (!sym) return null;
  const cacheKey = `${sym}@${r.toFixed(4)}`;
  if (surfaceMem[cacheKey]) return surfaceMem[cacheKey];

  const snap = await loadSnapshot();
  const prod = snap?.products?.[sym];
  if (!snap || !prod) return null;

  const surface = buildSurface(prod, r, snap.fetchedISO);
  surfaceMem[cacheKey] = surface;
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
  return out;
}
