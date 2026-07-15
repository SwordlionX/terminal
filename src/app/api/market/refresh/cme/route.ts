import { NextRequest, NextResponse } from 'next/server';
import { refreshCmeSurface, getDataSource } from '@/services/cme.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function doRefresh(product: string) {
  try {
    const surface = await refreshCmeSurface(product);
    return NextResponse.json({
      ok: true,
      product: surface.symbol,
      fetchedISO: surface.fetchedISO,
      expiries: surface.expiries.length,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Bilinmeyen hata' },
      { status: 502 }
    );
  }
}

/** POST /api/market/refresh/cme?product=XAG — Ayarlar'daki "CME'den Yenile" butonu. */
export async function POST(req: NextRequest) {
  const product = (new URL(req.url).searchParams.get('product') || 'XAG').toUpperCase();
  return doRefresh(product);
}

// Cron kredi harcamasın: yalnızca aktif kaynağı CME olan ürün yenilenir.
async function doRefreshIfActive(product: string) {
  if ((await getDataSource(product)) !== 'cme') {
    return NextResponse.json({ ok: true, skipped: true, product, reason: 'kaynak cme değil' });
  }
  return doRefresh(product);
}

/**
 * GET /api/market/refresh/cme — Vercel Cron için. CME COMEX metaller ~13:25 CT settle olur;
 * cron güvenli tarafta akşam UTC'ye ayarlanır (vercel.json). CRON_SECRET tanımlıysa
 * Vercel'in eklediği Authorization header'ı doğrulanır.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }
  const product = (new URL(req.url).searchParams.get('product') || 'XAG').toUpperCase();
  return doRefreshIfActive(product);
}
