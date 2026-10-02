import type { VolSurface } from '@/lib/vol/surface';
import type { MarketFeed } from '@/hooks/use-market-feed';

function receivedAt(at: number): string {
  return Number.isFinite(at) ? new Date(at).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : 'bilinmiyor';
}

/** Honest quote and surface timestamps shared by pricing screens. */
export function FeedStatus({ feed }: { feed: Pick<MarketFeed, 'spot' | 'surface' | 'surfaceSource' | 'snapshotISO' | 'error' | 'quoteError' | 'loading' | 'refreshStatus'> }) {
  const quote = feed.spot;
  const surface = feed.surface as VolSurface | null;
  return (
    <section className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>Fiyat kaynağı: {quote?.source ?? 'yok'}</span>
        <span>Son alım (TR): {quote ? receivedAt(quote.at) : 'yok'}</span>
        <span>Fiyatın zamanı (TR): {quote?.quoteAt ? receivedAt(quote.quoteAt) : 'sağlayıcı bildirmiyor'}</span>
        <span>Yüzey kaynağı: {feed.surfaceSource ?? 'yok'}</span>
        <span>Yüzey veri tarihi: {feed.snapshotISO ?? surface?.fetchedISO ?? 'yok'}</span>
      </div>
      {feed.loading && !quote && <p className="mt-1">Piyasa verisi yükleniyor…</p>}
      {feed.refreshStatus && <p className="mt-1">CME yenilemesi: {feed.refreshStatus}.</p>}
      {quote?.stale && <p className="mt-1 text-amber-400">Son alınan fiyat gösteriliyor; güncelliği doğrulanamadı.</p>}
      {feed.quoteError && <p className="mt-1 text-amber-400">Fiyat güncellemesi: {feed.quoteError}</p>}
      {feed.error && <p className="mt-1 text-amber-400">Veri durumu: {feed.error}</p>}
    </section>
  );
}
