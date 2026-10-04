import { NextResponse } from 'next/server';
import { loadPricingBundle } from '@/services/pricing-bundle.service';

export const dynamic = 'force-dynamic';

const PRODUCTS = ['XAU', 'XAG'] as const;

/** GET /api/settings/datasource — ürün başına etkin CME/SOFR paketinin durumu (salt okunur). */
export async function GET() {
  const bundle = await loadPricingBundle().catch(() => null);
  const items = PRODUCTS.map(product => {
    const surface = bundle?.surfaces[product] ?? null;
    return {
      product,
      fetchedISO: surface?.fetchedISO ?? null,
      expiries: surface?.expiries.length ?? 0,
      bundleId: surface?.curves?.id ?? null,
      notes: surface?.notes ?? null,
    };
  });
  return NextResponse.json({ items });
}
