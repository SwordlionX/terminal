import { dbc } from '../lib/db';
import type { VolSurface } from '../lib/vol/surface';
import type { SofrProjection } from '../lib/market/sofr';
import { factorAt } from '../lib/market/factors';
export interface PricingBundle {
  version: 2;
  id: string;
  sessionDate: string;
  builtAt: string;
  usd: SofrProjection;
  surfaces: Record<'XAU' | 'XAG', VolSurface>;
}
export function validatePricingBundle(bundle: PricingBundle): void {
  if (
    bundle.version !== 2 ||
    !bundle.id ||
    bundle.usd?.asOfDate !== bundle.sessionDate ||
    factorAt(bundle.usd?.nodes ?? [], Date.parse(bundle.sessionDate + 'T00:00:00Z')) !== 1
  )
    throw new Error('USD eğri sürümü/seansı geçersiz.');
  for (const product of ['XAU', 'XAG'] as const) {
    const surface = bundle.surfaces?.[product],
      c = surface?.curves;
    if (
      !surface?.expiries?.length ||
      surface.symbol !== product ||
      !c ||
      c.version !== 2 ||
      c.id !== bundle.id ||
      c.method !== 'CME-SOFR-indicative-proxy' ||
      c.asOf.slice(0, 10) !== bundle.sessionDate ||
      c.referenceSpot.at !== c.asOf ||
      !(c.referenceSpot.price > 0) ||
      !Number.isFinite(c.referenceSpot.price) ||
      factorAt(c.usd, Date.parse(c.asOf)) !== 1 ||
      factorAt(c.metal, Date.parse(c.asOf)) !== 1 ||
      surface.expiries.some(
        e =>
          !e.expiryAt ||
          !Number.isFinite(Date.parse(e.expiryAt)) ||
          !e.underlyingId ||
          !e.underlyingLastTradeTime ||
          !Number.isFinite(Date.parse(e.underlyingLastTradeTime)) ||
          e.points.length < 3 ||
          e.points.some(
            (p, i) =>
              !Number.isFinite(p.m) ||
              !(p.m > 0) ||
              !Number.isFinite(p.iv) ||
              !(p.iv > 0) ||
              (i > 0 && p.m <= e.points[i - 1].m),
          ),
      )
    )
      throw new Error('Faiz, taşıma ve IV aynı geçerli eğri sürümüne ait değil.');
  }
}
export async function loadPricingBundle(): Promise<PricingBundle | null> {
  const db = await dbc();
  const result = await db.execute({ sql: 'SELECT v FROM kv WHERE k=?', args: ['pricing_bundle_v2:latest'] });
  if (!result.rows.length) return null;
  const bundle = JSON.parse(String(result.rows[0].v)) as PricingBundle;
  validatePricingBundle(bundle);
  return bundle;
}
