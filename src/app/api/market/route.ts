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
        const r = isFinite(rate) ? rate : 0.05;
        const surface = await getSurface(product, r);
        const snap = await loadSnapshot();
        // Yüzeyler (HEM CME HEM Yahoo) yenileme anında sabit bir faizle kurulur; istek
        // yolunda yeniden kurulmazlar — o iş ölçülen 11 saniyeydi ve ekranın açılışını
        // bekletiyordu. Girili faiz farklıysa bu YUTULMAZ, ekrana taşınır: hem IV'ler hem
        // moneyness ekseninin forward'ı yüzeyin kendi faiziyle hesaplanmıştır.
        const builtR = surface?.builtWithR;
        const rateNote = builtR != null && Math.abs(builtR - r) > 0.0025
          ? `Bu vol yüzeyi %${(builtR * 100).toFixed(2)} faizle kuruldu; ekranda %${(r * 100).toFixed(2)} girili. IV'ler ve moneyness ekseni yüzeyin faiziyle hesaplandı — yüzey istek anında yeniden kurulmuyor (ekran açılışını 11 sn bekletiyordu).`
          : null;
        return { surface, snapshotISO: surface?.fetchedISO || snap?.fetchedISO || null, dataError: null as string | null, rateNote };
      } catch (e) {
        return {
          surface: null,
          snapshotISO: null,
          dataError: e instanceof Error ? e.message : 'Yüzey verisi okunamadı',
          rateNote: null as string | null,
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
    // Yüzeyin kurulduğu faiz ile istenen faiz uyuşmuyorsa açıklama (yoksa null).
    rateNote: surfaceRes.rateNote,
  });
}
