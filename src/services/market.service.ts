import type { VolSurface } from '@/lib/vol/surface';
import { loadPricingBundle } from './pricing-bundle.service';
import { factorAt } from '../lib/market/factors';
import { USD_TRY_RATE } from '../lib/margin/config';

// Dakikada bir tazeleme. 30 sn'deydi; süreç-içi önbellek her sunucu örneğinde ayrı
// sayıldığı için sağlayıcı kotasını (Twelve Data ücretsiz: 800 istek/gün) gereksiz yere
// zorluyordu. 60 sn hem ekran için yeterince canlı hem kota açısından rahat.
const SPOT_TTL_MS = 60 * 1000;

interface SpotCacheEntry {
  price: number;
  at: number;
  source: string;
  stale?: boolean;
  quoteAt?: number | null;
}
const spotCache: Record<string, SpotCacheEntry> = {};

// Sağlayıcı takılırsa /api/market isteği (dolayısıyla ekranın açılışı) beklemesin: sınır
// dolunca sıradaki sağlayıcıya, o da olmazsa eski önbelleğe düşülür.
const SPOT_TIMEOUT_MS = 4000;

interface ProviderQuote {
  price: number;
  quoteAt: number | null;
}

const TWELVEDATA_KEY = process.env.TWELVEDATA_API_KEY || 'f4289f23003940cfbf46c7825bd8ec3a';
export const TIINGO_KEY = process.env.TIINGO_API_KEY || 'af1224275560d5fb3e93aca2a0fa157da7cce183';

async function fetchTwelveDataPrice(symbol: string): Promise<ProviderQuote | null> {
  try {
    const res = await fetch(
      `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${TWELVEDATA_KEY}`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(SPOT_TIMEOUT_MS),
      },
    );
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
    const p = typeof j.price === 'number' || typeof j.price === 'string' ? Number(j.price) : NaN;
    return Number.isFinite(p) && p > 0 ? { price: p, quoteAt: null } : null;
  } catch {
    return null;
  }
}

async function fetchTiingoPrice(symbol: string): Promise<ProviderQuote | null> {
  try {
    const res = await fetch(
      `https://api.tiingo.com/tiingo/fx/top?tickers=${encodeURIComponent(symbol)}&token=${TIINGO_KEY}`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(SPOT_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      console.warn(`[spot] Tiingo ${symbol}: HTTP ${res.status}`);
      return null;
    }
    const j = await res.json();
    const quote = j?.[0];
    const p = quote?.midPrice;
    const parsedTime = typeof quote?.quoteTimestamp === 'string' ? Date.parse(quote.quoteTimestamp) : NaN;
    return typeof p === 'number' && Number.isFinite(p) && p > 0
      ? { price: p, quoteAt: Number.isFinite(parsedTime) ? parsedTime : null }
      : null;
  } catch {
    return null;
  }
}

/**
 * GERÇEK SPOT sağlayıcı zinciri — ürün başına sırayla denenir, ilk geçerli fiyat kazanır.
 * Bir sağlayıcı düşerse (kota, kesinti, geçici hata) diğeri devreye girer; ikisi de düşerse
 * vekil fiyat kullanılmaz, son alınan fiyat eski olarak işaretlenir.
 *
 * Sıra 2026-08-08'de ölçülerek belirlendi:
 *  - Twelve Data ücretsiz planda XAU/USD var, XAG/USD YOK (HTTP 404) → altın onunla başlar.
 *  - Tiingo'da hem xauusd hem xagusd var → gümüşün birincil kaynağı, altının yedeği.
 * Gümüşte Twelve Data yine de ikinci sırada duruyor: mutlu yolda hiç çağrılmıyor (yalnız
 * Tiingo düşerse denenir), plan yükseltilirse kendiliğinden devreye girer.
 * İki kaynak çapraz doğrulandı: XAU 4342.35 (TD) vs 4341.48 (Tiingo) — %0.02 fark.
 */
const SPOT_PROVIDERS: Record<string, { source: string; get: () => Promise<ProviderQuote | null> }[]> = {
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
 * Güncel spot (60 sn önbellekli). Sıra: Twelve Data/Tiingo →
 * süresi geçmiş önbellek. Süresi geçmiş fiyat, ilk alındığı zaman korunarak stale işaretlenir.
 * Dönen `source` hangi basamağa inildiğini söyler; ekran rozeti bunu etiketler.
 */
export async function getSpot(
  product: string,
): Promise<{ price: number; at: number; source: string; stale?: boolean; quoteAt?: number | null } | null> {
  const key = product.toUpperCase();
  const cached = spotCache[key];
  if (cached && Date.now() - cached.at < SPOT_TTL_MS) return cached;

  const remember = (quote: ProviderQuote, source: string) => {
    const entry = { price: quote.price, at: Date.now(), source, stale: false, quoteAt: quote.quoteAt };
    spotCache[key] = entry;
    return entry;
  };

  for (const p of SPOT_PROVIDERS[key] ?? []) {
    const quote = await p.get();
    if (quote != null) return remember(quote, p.source);
  }

  if (cached) console.warn(`[spot] ${key}: tüm kaynaklar düştü, süresi geçmiş önbellek kullanılıyor`);
  return cached ? { ...cached, stale: true } : null;
}

/** USD/TRY sabit kurdur (50); veritabanından okunmaz veya ekrandan değiştirilmez. */
export async function getUsdTryRate(): Promise<number> {
  return USD_TRY_RATE;
}

/** Read-only 90-day ACT/365 equivalent; pricing itself uses dated factors. */
export async function getInterestRate(): Promise<number> {
  const bundle = await loadPricingBundle();
  if (!bundle) throw new Error('USD vade eğrisi yok; varsayılan faiz kullanılmaz.');
  const from = Date.parse(bundle.sessionDate + 'T00:00:00Z'),
    days = 90;
  const discount = factorAt(bundle.usd.nodes, from + days * 86400000);
  if (discount == null) throw new Error('USD faiz eğrisinin kapsamı eksik.');
  return -Math.log(discount) / (days / 365);
}

export async function setInterestRate(rate: number): Promise<void> {
  void rate;
  throw new Error('Manuel faiz girişi eğri–fiyat tutarlılığını bozar; USD eğrisini yeniden kurun.');
}

/**
 * Metal IV yüzeyi — yalnız doğrulanmış ortak faiz/taşıma/IV paketinden okunur. İstek yolunda
 * hesap yapılmaz; paket yoksa fiyatlama durur (eski kira hesabına veya varsayılan faize dönülmez).
 */
export async function getSurface(product: string): Promise<VolSurface> {
  const key = product.toUpperCase();
  if (key !== 'XAU' && key !== 'XAG') throw new Error('Yalnız XAU ve XAG fiyatlanır.');
  const bundle = await loadPricingBundle();
  if (!bundle)
    throw new Error('Faiz, taşıma ve IV yeni sürümde birlikte kurulmalı; eski kira hesabıyla fiyatlama yapılmaz.');
  return bundle.surfaces[key];
}
