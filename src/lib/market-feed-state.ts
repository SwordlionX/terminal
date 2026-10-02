export interface MarketFeedSpot {
  price: number;
  at: number;
  source: string;
  stale?: boolean;
  quoteAt?: number | null;
}

export interface MarketFeedSnapshot<TSurface> {
  product: string;
  spot: MarketFeedSpot | null;
  surface: TSurface | null;
  surfaceSource: string | null;
  snapshotISO: string | null;
  rateNote: string | null;
  dataError: string | null;
  quoteError: string | null;
}

/** Retain only same-product quote data and same-source surfaces across partial responses. */
export function mergeMarketFeed<TSurface>(
  previous: MarketFeedSnapshot<TSurface> | null,
  incoming: MarketFeedSnapshot<TSurface>,
): MarketFeedSnapshot<TSurface> {
  const sameProduct = previous?.product === incoming.product;
  const sameSurfaceSource = sameProduct && previous?.surfaceSource === incoming.surfaceSource;
  const spot = incoming.spot
    ? incoming.spot
    : sameProduct && previous?.spot
      ? { ...previous.spot, stale: true }
      : null;
  const surface = incoming.surface ?? (sameSurfaceSource ? previous?.surface ?? null : null);
  const snapshotISO = incoming.surface
    ? incoming.snapshotISO
    : surface && sameSurfaceSource
      ? previous?.snapshotISO ?? incoming.snapshotISO
      : incoming.snapshotISO;
  return { ...incoming, spot, surface, snapshotISO };
}

export function markMarketFeedUnavailable<TSurface>(
  previous: MarketFeedSnapshot<TSurface> | null,
  product: string,
  message: string,
): MarketFeedSnapshot<TSurface> | null {
  if (!previous || previous.product !== product) return null;
  return {
    ...previous,
    spot: previous.spot ? { ...previous.spot, stale: true } : null,
    quoteError: message,
  };
}
