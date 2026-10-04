import { NextResponse } from 'next/server';
import { getSpot, getSurface } from '@/services/market.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/market?product=XAU
 * Fiyatlama ekranının tek çağrıda ihtiyacı olan her şey: güncel spot (60 sn önbellek) +
 * doğrulanmış ortak faiz/taşıma/IV paketinden metal yüzeyi.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const product = (searchParams.get('product') || 'XAU').toUpperCase();

  // Spot ile yüzey BİRBİRİNDEN BAĞIMSIZ çekilir: veritabanı geçici erişilemez olduğunda spot'u
  // da kaybetmemek için yüzey hatası ayrıca yakalanır ve `dataError` olarak ekrana taşınır.
  const [spot, surfaceRes] = await Promise.all([
    getSpot(product),
    (async () => {
      try {
        const surface = await getSurface(product);
        return { surface, dataError: null as string | null };
      } catch (e) {
        return { surface: null, dataError: e instanceof Error ? e.message : 'Yüzey verisi okunamadı' };
      }
    })(),
  ]);

  return NextResponse.json({
    product,
    spot,
    surface: surfaceRes.surface,
    surfaceSource: surfaceRes.surface ? 'cme' : null,
    snapshotISO: surfaceRes.surface?.fetchedISO ?? null,
    dataError: surfaceRes.dataError,
    rateNote: surfaceRes.surface?.curves
      ? `Vade bazlı CME/SOFR endikatif proxy · ${surfaceRes.surface.curves.id.slice(0, 12)} · Manuel faiz kullanılmaz.`
      : null,
  });
}
