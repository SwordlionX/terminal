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

  const [spot, surface, snap] = await Promise.all([
    getSpot(product),
    getSurface(product, isFinite(rate) ? rate : 0.05),
    loadSnapshot(),
  ]);

  return NextResponse.json({
    product,
    spot,
    surface,
    // CME kaynağında yüzeyin kendi settlement tarihi geçerli etikettir; yoksa Yahoo snapshot'ı.
    snapshotISO: surface?.fetchedISO || snap?.fetchedISO || null,
  });
}
