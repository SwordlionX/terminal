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
        // CME yüzeyi yenileme anında SABİT bir faizle kurulur ve istek anında yeniden
        // kurulamaz (ham settlement verisi saklanmıyor). Kullanıcı faizi değiştirdiğinde
        // Yahoo yolu yeniden kurar, CME yolu kuramaz — bu fark artık YUTULMUYOR, ekrana
        // taşınıyor. IV'ler yüzeyin kendi faiziyle çözüldü; sapma küçük ama gerçektir.
        const builtR = surface?.builtWithR;
        const rateNote = builtR != null && Math.abs(builtR - r) > 0.0025
          ? `Bu vol yüzeyi %${(builtR * 100).toFixed(2)} faizle kuruldu; ekranda %${(r * 100).toFixed(2)} girili. IV'ler yüzeyin faiziyle çözülmüştür (yüzey istek anında yeniden kurulamaz).`
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
