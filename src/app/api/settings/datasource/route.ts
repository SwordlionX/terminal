import { NextResponse } from 'next/server';
import { getDataSource, setDataSource, cmeSupported } from '@/services/cme.service';
import { loadSnapshot } from '@/services/market.service';
import { PRODUCT_SURFACE_MAP } from '@/lib/vol/surface';
import { readSettingsBody } from '@/lib/settings-validation';
import { loadPricingBundle } from '@/services/pricing-bundle.service';

export const dynamic = 'force-dynamic';

// Kaynak seçilebilen ürünler. İkisi de hem Yahoo (ETF) hem CME COMEX yüzeyi üretebilir.
const PRODUCTS = ['XAU', 'XAG'];

/**
 * GET /api/settings/datasource — ürün başına aktif kaynak + HER İKİ kaynağın durumu.
 * İki kaynak veritabanında AYRI saklanır (Yahoo: tek `yahoo_snapshot`, ETF zincirleri;
 * CME: ürün başına `cme_surface_<ÜRÜN>`), bu yüzden biri yenilenince diğeri bozulmaz ve
 * kaynak değiştirmek veri kaybettirmez.
 */
export async function GET() {
  // Yahoo tarafı tek snapshot'ta iki ETF'i birden taşır — bir kez okunur.
  const snap = await loadSnapshot().catch(() => null);
  const bundle = await loadPricingBundle().catch(() => null);

  const items = await Promise.all(PRODUCTS.map(async (p) => {
    const source = await getDataSource(p);
    const surf = bundle?.surfaces[p as 'XAU' | 'XAG'] ?? null;
    const etf = PRODUCT_SURFACE_MAP[p];
    const yProd = etf ? snap?.products?.[etf] : undefined;
    return {
      product: p,
      source,
      cmeSupported: cmeSupported(p),
      cmeFetchedISO: surf?.fetchedISO ?? null,
      cmeExpiries: surf?.expiries.length ?? 0,
      // Yüzey kurulurken atlanan günler vb. — tarih alanına karıştırılmaz (VolSurface.notes).
      cmeNotes: surf?.curves ? `CME/SOFR proxy · sürüm ${surf.curves.id.slice(0, 12)} · banka kira kotasyonu değildir.` : 'Ortak faiz/taşıma/IV sürümü henüz kurulmadı.',
      yahooSymbol: etf ?? null,
      yahooFetchedISO: yProd ? snap?.fetchedISO ?? null : null,
      yahooExpiries: yProd?.expiries.length ?? 0,
    };
  }));
  return NextResponse.json({ items });
}

/** POST /api/settings/datasource { product, source } — kaynağı değiştirir. */
export async function POST(request: Request) {
  const body = await readSettingsBody(request);
  if (!body || typeof body.product !== 'string' || typeof body.source !== 'string') {
    return NextResponse.json({ ok: false, error: 'Geçersiz istek' }, { status: 400 });
  }
  const product = body.product.toUpperCase();
  if (body.source !== 'cme' && body.source !== 'yahoo') {
    return NextResponse.json({ ok: false, error: 'Geçersiz kaynak' }, { status: 400 });
  }
  const source = body.source;
  if (!PRODUCTS.includes(product)) {
    return NextResponse.json({ ok: false, error: 'Geçersiz ürün' }, { status: 400 });
  }
  if (source === 'yahoo') return NextResponse.json({ ok: false, error: 'ETF yüzeyi metal faiz/taşıma eğrisiyle aynı sürümde değil; XAU/XAG için CME/SOFR kullanın.' }, { status: 409 });
  if (source === 'cme' && !cmeSupported(product)) {
    return NextResponse.json({ ok: false, error: 'Bu ürün için CME kaynağı yok' }, { status: 400 });
  }
  await setDataSource(product, source);
  return NextResponse.json({ ok: true, product, source });
}
