"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { VolSurface } from '@/lib/vol/surface';
import { MarketFeedSnapshot, mergeMarketFeed, markMarketFeedUnavailable } from '@/lib/market-feed-state';
import { cmeStatusText, refreshCme, type CmeRefreshStatus } from '@/lib/market-refresh';

const REFRESH_MS = 5 * 60 * 1000; // sayfa açıkken 5 dakikada bir tazele

export interface MarketFeed {
  spot: { price: number; at: number; source: string; stale?: boolean; quoteAt?: number | null } | null;
  surface: VolSurface | null;
  surfaceSource: string | null;
  snapshotISO: string | null;
  /** Yüzey, ekranda girili olandan farklı bir faizle kurulduysa açıklama (yoksa null). */
  rateNote: string | null;
  loading: boolean;
  refreshing: boolean;
  refreshStatus: string | null;
  error: string | null;
  quoteError: string | null;
  refetch: () => void;
  refreshChains: () => Promise<void>;
}

/** Sunucudan gelen besleme + hangi ürüne ait olduğu (sıra dışı cevapları elemek için). */
type FeedData = MarketFeedSnapshot<VolSurface>;

/** Fiyatlama ekranı piyasa beslemesi: güncel spot + doğrulanmış CME/SOFR IV yüzeyi. */
export function useMarketFeed(product: string): MarketFeed {
  // Besleme TEK parça tutulur ve hangi ürüne ait olduğu içinde taşınır. Böylece ürün
  // değişince eski ürünün spot'u/yüzeyi ekranda kalamaz: aşağıda `data.product !== product`
  // ise besleme yokmuş gibi davranılır (state sıfırlamak için ekstra efekt gerekmez).
  const [data, setData] = useState<FeedData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<{ product: string; text: string } | null>(null);
  const [error, setError] = useState<{ product: string; message: string } | null>(null);
  const requestId = useRef(0);
  const currentProduct = useRef(product.toUpperCase());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshFlight = useRef<Promise<void> | null>(null);
  const refreshController = useRef<AbortController | null>(null);

  useEffect(() => {
    currentProduct.current = product.toUpperCase();
    requestId.current += 1;
  }, [product]);

  const fetchFeed = useCallback(async () => {
    const id = ++requestId.current;
    const requestedProduct = product.toUpperCase();
    try {
      const res = await fetch(`/api/market?product=${product}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('Geçersiz piyasa yanıtı');
      // Cevap, isteği açan ürünle etiketlenerek saklanır. Geç dönen bir XAU cevabı artık
      // XAG ekranına sızamaz — eskiden bu yüzden gümüşteyken ekrana PAXG (altın) fiyatı
      // yazılıyordu. Etiket sunucunun döndürdüğü `product` alanından alınır.
      const forProduct = String(j.product ?? product).toUpperCase();
      if (id !== requestId.current || currentProduct.current !== requestedProduct || forProduct !== requestedProduct) return;
      const incoming: FeedData = {
        product: forProduct,
        spot: j.spot ?? null,
        surface: j.surface ?? null,
        surfaceSource: j.surfaceSource ?? null,
        snapshotISO: j.snapshotISO ?? null,
        rateNote: j.rateNote ?? null,
        dataError: j.dataError ?? (!j.surface ? 'Yüzey yenilenemedi; varsa aynı kaynaktan son alınan yüzey gösteriliyor.' : null),
        quoteError: j.spot?.stale || !j.spot ? 'Spot yenilenemedi; varsa son alınan fiyat korunuyor.' : null,
      };
      setData(previous => mergeMarketFeed(previous, incoming));
      // Yüzey okunamadıysa (ör. veritabanına erişilemedi) sessizce geçilmez — spot yine
      // gösterilir ama sebep ekranda yazar. Bayat yedek veriye düşülmez.
      setError(null);
    } catch {
      if (id !== requestId.current || currentProduct.current !== requestedProduct) return;
      setData(previous => markMarketFeedUnavailable(previous, requestedProduct, 'Piyasa verisi yenilenemedi; son alınan veri korunuyor.'));
      setError({ product: requestedProduct, message: 'Piyasa verisi yenilenemedi; son alınan veri korunuyor.' });
    }
  }, [product]);

  useEffect(() => {
    const initial = setTimeout(fetchFeed, 0);
    timer.current = setInterval(fetchFeed, REFRESH_MS);
    return () => {
      clearTimeout(initial);
      if (timer.current) clearInterval(timer.current);
    };
  }, [fetchFeed]);

  useEffect(() => () => refreshController.current?.abort(), []);

  const refreshChains = useCallback(async () => {
    if (refreshFlight.current) return refreshFlight.current;
    setRefreshing(true);
    setRefreshStatus(null);
    const controller = new AbortController();
    refreshController.current = controller;
    const task = (async () => {
      try {
        const status = await refreshCme(product, {
          signal: controller.signal,
          onStatus: (value: CmeRefreshStatus) => setRefreshStatus({ product: product.toUpperCase(), text: cmeStatusText[value] }),
        });
        if (status !== 'completed') throw new Error(status === 'failed' ? 'CME yenilemesi başarısız oldu.' : 'CME yenileme sonucu doğrulanamadı.');
        await fetchFeed();
      } catch (e) {
        if (controller.signal.aborted) return;
        setError({ product: product.toUpperCase(), message: e instanceof Error ? e.message : 'Zincir yenileme başarısız' });
      } finally {
        if (refreshController.current === controller) refreshController.current = null;
        refreshFlight.current = null;
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
    refreshFlight.current = task;
    return task;
  }, [fetchFeed, product]);

  // Ekrana yalnızca AKTİF ürünün verisi verilir; başka ürünün cevabı elde tutulsa bile
  // yok sayılır ve besleme "yükleniyor" olarak görünür.
  const fresh = data && data.product === product.toUpperCase() ? data : null;
  const activeError = error && error.product === product.toUpperCase() ? error.message : null;
  const quoteError = fresh?.quoteError ?? activeError;

  return {
    spot: fresh?.spot ?? null,
    surface: fresh?.surface ?? null,
    surfaceSource: fresh?.surfaceSource ?? null,
    snapshotISO: fresh?.snapshotISO ?? null,
    rateNote: fresh?.rateNote ?? null,
    loading: !fresh && !activeError,
    refreshing,
    error: activeError ?? fresh?.dataError ?? null,
    quoteError,
    refreshStatus: refreshStatus?.product === product.toUpperCase() ? refreshStatus.text : null,
    refetch: fetchFeed,
    refreshChains,
  };
}
