import { NextResponse } from 'next/server';
import { SYMBOL_RE, toYahooSymbol } from '@/lib/bist';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stocks?symbol=THYAO.IS — tek hissenin anlık fiyatı + önceki kapanış.
 *
 * Önbellek İSTEK YOLUNDA, süreç-içi tutulur (aşağıdaki QUOTE_TTL_MS). Eskiden fetch'in
 * `next: { revalidate: 60 }` seçeneği kullanılıyordu ama ekran 30 sn'de bir yeniliyordu:
 * yenilemelerin yarısı zaten önbellekten dönüyor, kullanıcı "yeniledim" sanıyordu. Artık
 * tazelik tek yerden (QUOTE_TTL_MS) yönetiliyor ve ekranın yenileme aralığıyla hizalı.
 * Ayrıca portföyde çok sembol olduğunda aynı sembolü kartlar arası tekrar tekrar çekmeyi
 * de bu önbellek engelliyor.
 */
const QUOTE_TTL_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 8000;

interface Quote { price: number; previousClose: number | null }
const quoteCache = new Map<string, { at: number; val: Quote }>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('symbol');

  if (!raw) {
    return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
  }

  // Sembol doğrudan URL YOLUNA giriyor; doğrulanmazsa "../.." gibi bir değer isteği
  // Yahoo'nun başka bir ucuna yönlendirebilirdi. Beyaz listeye uymayan reddedilir.
  const symbol = toYahooSymbol(raw);
  if (!SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: `Geçersiz sembol: ${raw}` }, { status: 400 });
  }

  const hit = quoteCache.get(symbol);
  if (hit && Date.now() - hit.at < QUOTE_TTL_MS) return NextResponse.json(hit.val);

  try {
    // PARAMETRESİZ çağrılır — bilinçli. Ölçüldü (THYAO.IS, 2026-08-08):
    //   (parametresiz)         -> previousClose 311.25  (bir önceki SEANS kapanışı, doğru)
    //   ?interval=1d&range=1d  -> previousClose boş, chartPreviousClose 311.25
    //   ?interval=1d&range=5d  -> previousClose boş, chartPreviousClose 317.0  ← 5 GÜN öncesi
    // range verildiğinde chartPreviousClose pencerenin BAŞINDAN önceki kapanışa kayıyor;
    // yüzde değişim günlük olmaktan çıkıp dönemsel oluyordu.
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      return NextResponse.json({ error: `Yahoo yanıt vermedi (HTTP ${res.status})` }, { status: 502 });
    }

    // Yahoo geçersiz sembolde de 200 + hata gövdesi dönebiliyor; alanlar körlemesine
    // okunduğunda TypeError'a düşüp 500 üretiyordu. Artık yapı doğrulanıp 502 dönüyor.
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== 'number' || !(price > 0)) {
      const why = data?.chart?.error?.description ?? 'fiyat alanı yok';
      return NextResponse.json({ error: `${symbol} için fiyat alınamadı (${why})` }, { status: 502 });
    }

    // previousClose seans dışında/yeni sembollerde gelmeyebilir; chartPreviousClose yedeği
    // de yoksa null döner ve ekran yüzde değişimini "—" gösterir (NaN% yazmaz).
    const prevRaw = meta.previousClose ?? meta.chartPreviousClose;
    const previousClose = typeof prevRaw === 'number' && prevRaw > 0 ? prevRaw : null;

    const val: Quote = { price, previousClose };
    quoteCache.set(symbol, { at: Date.now(), val });
    return NextResponse.json(val);
  } catch (error) {
    console.error(`[stocks] ${symbol}:`, error);
    return NextResponse.json({ error: 'Fiyat servisine ulaşılamadı' }, { status: 502 });
  }
}
