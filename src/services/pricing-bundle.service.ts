import { dbc } from '../lib/db';
import type { VolSurface } from '../lib/vol/surface';
import type { SofrProjection } from '../lib/market/sofr';
import { factorAt } from '../lib/market/factors';
export interface PricingBundle {
  version: 2 | 3;
  id: string;
  sessionDate: string;
  builtAt: string;
  usd: SofrProjection;
  surfaces: Record<'XAU' | 'XAG', VolSurface>;
  /** Which inputs built this bundle; degraded means a SOFR fallback was used and a later run may improve it. */
  inputs?: { curveRawHash: string; sofrSession: string; degraded: boolean };
}
export function validatePricingBundle(bundle: PricingBundle): void {
  if (
    (bundle.version !== 2 && bundle.version !== 3) ||
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
    // V2 readers do not understand quarantine boundaries. Never label a partial surface
    // as V2, even when there are enough healthy expiries to build the newer format.
    if (bundle.version === 2 && surface.quarantinedExpiries !== undefined)
      throw new Error('Karantina bilgisi için fiyatlama paketi sürüm 3 gerekli.');
    if (bundle.version === 3) validateSurfaceCoverage(surface);
  }
}

function validateSurfaceCoverage(surface: VolSurface): void {
  const reference = Date.parse(surface.fetchedISO);
  const validCoordinates = (expiry: { expiryAt?: string; days: number; date: string }) => {
    const at = Date.parse(expiry.expiryAt ?? '');
    return (
      Number.isFinite(at) &&
      expiry.date === new Date(at).toISOString().slice(0, 10) &&
      Number.isFinite(expiry.days) &&
      expiry.days >= 1 &&
      expiry.days <= 400 &&
      Math.abs(expiry.days - Math.round(((at - reference) / 86400000) * 10) / 10) < 1e-8
    );
  };
  if (
    !Number.isFinite(reference) ||
    surface.fetchedISO !== surface.curves?.asOf ||
    surface.expiries.length < 3 ||
    surface.expiries.some(
      (expiry, i) =>
        !validCoordinates(expiry) ||
        !Number.isFinite(expiry.f) ||
        !(expiry.f! > 0) ||
        expiry.points[0].m > 1 ||
        expiry.points.at(-1)!.m < 1 ||
        (i > 0 && Date.parse(expiry.expiryAt!) <= Date.parse(surface.expiries[i - 1].expiryAt!)),
    )
  )
    throw new Error('IV yüzeyinin geçerli vade kapsamı yetersiz veya tutarsız.');

  if (surface.quarantinedExpiries === undefined) return;
  if (!Array.isArray(surface.quarantinedExpiries)) throw new Error('IV karantina kayıtları geçersiz.');
  const occupied = new Set(surface.expiries.map(expiry => Date.parse(expiry.expiryAt!)));
  for (const expiry of surface.quarantinedExpiries) {
    if (
      !expiry ||
      !validCoordinates(expiry) ||
      occupied.has(Date.parse(expiry.expiryAt)) ||
      !['zero_calibration', 'zero_below_intrinsic', 'forward_vol_outlier'].includes(expiry.reason) ||
      !Array.isArray(expiry.instrumentIds) ||
      expiry.instrumentIds.length > 12 ||
      expiry.instrumentIds.some(id => typeof id !== 'string' || !id.trim()) ||
      new Set(expiry.instrumentIds).size !== expiry.instrumentIds.length ||
      !Number.isSafeInteger(expiry.issueCount) ||
      expiry.issueCount < expiry.instrumentIds.length ||
      (expiry.reason !== 'forward_vol_outlier' && (expiry.issueCount < 1 || expiry.instrumentIds.length < 1)) ||
      expiry.issueCount < 0
    )
      throw new Error('IV karantina kayıtları geçersiz veya kote vadeyle çakışıyor.');
    occupied.add(Date.parse(expiry.expiryAt));
  }
}

export async function loadPricingBundle(): Promise<PricingBundle | null> {
  const db = await dbc();
  // Separate keys keep older deployed readers on their last safe V2 surface. They
  // must never receive a V3 surface and interpolate across its unknown quarantine.
  for (const version of [3, 2] as const) {
    const result = await db.execute({ sql: 'SELECT v FROM kv WHERE k=?', args: [`pricing_bundle_v${version}:latest`] });
    if (!result.rows.length) continue;
    const bundle = JSON.parse(String(result.rows[0].v)) as PricingBundle;
    if (bundle.version !== version) throw new Error('Fiyatlama paketi anahtarı ve sürümü uyuşmuyor.');
    validatePricingBundle(bundle);
    return bundle;
  }
  return null;
}
