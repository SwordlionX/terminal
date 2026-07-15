import { NextResponse } from 'next/server';
import { getDataSource, setDataSource, cmeSupported, loadCmeSurface } from '@/services/cme.service';

export const dynamic = 'force-dynamic';

// Faz 1: yalnız gümüş CME'ye geçebilir. İleride altın (XAU) eklenince bu listeye girer.
const PRODUCTS = ['XAG'];

/** GET /api/settings/datasource — ürün başına aktif kaynak + CME yüzey durumu. */
export async function GET() {
  const items = await Promise.all(PRODUCTS.map(async (p) => {
    const source = await getDataSource(p);
    const surf = await loadCmeSurface(p);
    return {
      product: p,
      source,
      cmeSupported: cmeSupported(p),
      cmeFetchedISO: surf?.fetchedISO ?? null,
      cmeExpiries: surf?.expiries.length ?? 0,
    };
  }));
  return NextResponse.json({ items });
}

/** POST /api/settings/datasource { product, source } — kaynağı değiştirir. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const product = String(body.product || '').toUpperCase();
  const source = body.source === 'cme' ? 'cme' : 'yahoo';
  if (!PRODUCTS.includes(product)) {
    return NextResponse.json({ ok: false, error: 'Geçersiz ürün' }, { status: 400 });
  }
  if (source === 'cme' && !cmeSupported(product)) {
    return NextResponse.json({ ok: false, error: 'Bu ürün için CME kaynağı yok' }, { status: 400 });
  }
  await setDataSource(product, source);
  return NextResponse.json({ ok: true, product, source });
}
