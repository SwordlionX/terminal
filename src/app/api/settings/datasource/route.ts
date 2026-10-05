import { NextResponse } from 'next/server';
import { loadPricingBundle } from '@/services/pricing-bundle.service';
import { dbc } from '@/lib/db';
import type { PricingRefreshStatus } from '@/lib/market-refresh';

export const dynamic = 'force-dynamic';

const PRODUCTS = ['XAU', 'XAG'] as const;

async function readRefreshStatus(): Promise<PricingRefreshStatus | null> {
  const db = await dbc();
  const result = await db.execute({ sql: 'SELECT v FROM kv WHERE k=?', args: ['pricing_refresh_status'] });
  return result.rows.length ? (JSON.parse(String(result.rows[0].v)) as PricingRefreshStatus) : null;
}

/** GET /api/settings/datasource — etkin CME/SOFR paketi ve son otomatik kontrolün durumu (salt okunur). */
export async function GET() {
  const [bundle, refresh] = await Promise.all([
    loadPricingBundle().catch(() => null),
    readRefreshStatus().catch(() => null),
  ]);
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
  const usd = bundle
    ? {
        sessionDate: bundle.sessionDate,
        sofrSession: bundle.inputs?.sofrSession ?? bundle.usd.asOfDate,
        degraded: bundle.inputs?.degraded ?? false,
        // The standing model caveats are on the curves page; only session-specific notes here.
        warnings: bundle.usd.warnings.filter(w => !/^(Endikatif SOFR|Ayın bilinmeyen)/.test(w)),
      }
    : null;
  return NextResponse.json({ items, usd, refresh });
}
