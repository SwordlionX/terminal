import { getSpot, getSurface } from '../../services/market.service';
import { getDataSource } from '../../services/cme.service';
import type { MarketSnapshot, Product } from './types';

export async function terminalMarket(product: Product): Promise<MarketSnapshot> {
  const [spot, surface] = await Promise.all([
    getSpot(product).catch(() => null),
    (async () => {
      try { return { value: await getSurface(product, 0, true), source: await getDataSource(product), error: undefined }; }
      catch { return { value: null, source: null, error: 'Terminalin volatilite yüzeyi okunamadı.' }; }
    })(),
  ]);
  return { product, spot: spot?.price ?? null, spotSource: spot?.source ?? 'Veri yok',
    spotAt: spot ? new Date(spot.quoteAt ?? spot.at).toISOString() : null,
    spotStale: spot?.stale ?? false,
    surface: surface.value, surfaceSource: surface.source, error: surface.error };
}
