import { NextResponse } from 'next/server';
import { getSpot, getSurface, loadSnapshot } from '@/services/market.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/market?product=XAU&rate=0.05
 * Fiyatlama ekranının tek çağrıda ihtiyacı olan her şey:
 * güncel spot (5 dk önbellek) + de-Amerikanize IV yüzeyi.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const product = (searchParams.get('product') || 'XAU').toUpperCase();
  const rate = parseFloat(searchParams.get('rate') || '0.05');

  // Spot (Yahoo) ile yüzey (veritabanı) BİRBİRİNDEN BAĞIMSIZ çekilir: veritabanı geçici
  // erişilemez olduğunda spot'u da kaybetmemek için yüzey hatası ayrıca yakalanır.
  // Hata YUTULMAZ — `dataError` olarak ekrana taşınır (bayat yedek veriye düşmek yok).
  const [spot, surfaceRes] = await Promise.all([
    getSpot(product),
    (async () => {
      try {
        const surface = await getSurface(product, isFinite(rate) ? rate : 0.05);
        const snap = await loadSnapshot();
        return { surface, snapshotISO: surface?.fetchedISO || snap?.fetchedISO || null, dataError: null as string | null };
      } catch (e) {
        return {
          surface: null,
          snapshotISO: null,
          dataError: e instanceof Error ? e.message : 'Yüzey verisi okunamadı',
        };
      }
    })(),
  ]);

  return NextResponse.json({
    product,
    spot,
    surface: surfaceRes.surface,
    // CME kaynağında yüzeyin kendi settlement tarihi geçerli etikettir; yoksa Yahoo snapshot'ı.
    snapshotISO: surfaceRes.snapshotISO,
    dataError: surfaceRes.dataError,
  });
}
