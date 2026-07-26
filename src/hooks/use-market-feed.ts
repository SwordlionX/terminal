"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { VolSurface } from '@/lib/vol/surface';

const REFRESH_MS = 5 * 60 * 1000; // sayfa açıkken 5 dakikada bir tazele

export interface MarketFeed {
  spot: { price: number; at: number; source: string } | null;
  surface: VolSurface | null;
  snapshotISO: string | null;
  /** Yüzey, ekranda girili olandan farklı bir faizle kurulduysa açıklama (yoksa null). */
  rateNote: string | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
  refreshChains: () => Promise<void>;
}

/** Sunucudan gelen besleme + hangi ürüne ait olduğu (sıra dışı cevapları elemek için). */
interface FeedData {
  product: string;
  spot: MarketFeed['spot'];
  surface: VolSurface | null;
  snapshotISO: string | null;
  rateNote: string | null;
}

/** Fiyatlama ekranı piyasa beslemesi: güncel spot + de-Amerikanize IV yüzeyi. */
export function useMarketFeed(product: string, rate: number): MarketFeed {
  // Besleme TEK parça tutulur ve hangi ürüne ait olduğu içinde taşınır. Böylece ürün
  // değişince eski ürünün spot'u/yüzeyi ekranda kalamaz: aşağıda `data.product !== product`
  // ise besleme yokmuş gibi davranılır (state sıfırlamak için ekstra efekt gerekmez).
  const [data, setData] = useState<FeedData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ product: string; message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Faiz gecikmeli izlenir: alandaki her tuş vuruşu ayrı bir istek açmasın. Faiz yüzeyi
  // artık yeniden kurmuyor (yüzey önceden kurulu gelir), yalnız "hangi faizle kuruldu"
  // uyarısının karşılaştırmasına giriyor — 400 ms beklemek bedelsiz.
  const [debouncedRate, setDebouncedRate] = useState(rate);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedRate(rate), 400);
    return () => clearTimeout(id);
  }, [rate]);

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch(`/api/market?product=${product}&rate=${debouncedRate}`, { cache: 'no-store' });
      const j = await res.json();
      // Cevap, isteği açan ürünle etiketlenerek saklanır. Geç dönen bir XAU cevabı artık
      // XAG ekranına sızamaz — eskiden bu yüzden gümüşteyken ekrana PAXG (altın) fiyatı
      // yazılıyordu. Etiket sunucunun döndürdüğü `product` alanından alınır.
      const forProduct = String(j.product ?? product).toUpperCase();
      setData({
        product: forProduct,
        spot: j.spot ?? null,
        surface: j.surface ?? null,
        snapshotISO: j.snapshotISO ?? null,
        rateNote: j.rateNote ?? null,
      });
      // Yüzey okunamadıysa (ör. veritabanına erişilemedi) sessizce geçilmez — spot yine
      // gösterilir ama sebep ekranda yazar. Bayat yedek veriye düşülmez.
      setError(j.dataError ? { product: forProduct, message: j.dataError } : null);
    } catch {
      setError({ product: product.toUpperCase(), message: 'Piyasa verisi alınamadı' });
    }
  }, [product, debouncedRate]);

  useEffect(() => {
    const initial = setTimeout(fetchFeed, 0);
    timer.current = setInterval(fetchFeed, REFRESH_MS);
    return () => {
      clearTimeout(initial);
      if (timer.current) clearInterval(timer.current);
    };
  }, [fetchFeed]);

  const refreshChains = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/market/refresh', { method: 'POST' });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      await fetchFeed();
      setError(null);
    } catch (e) {
      setError({
        product: product.toUpperCase(),
        message: e instanceof Error ? e.message : 'Zincir yenileme başarısız',
      });
    } finally {
      setRefreshing(false);
    }
  }, [fetchFeed, product]);

  // Ekrana yalnızca AKTİF ürünün verisi verilir; başka ürünün cevabı elde tutulsa bile
  // yok sayılır ve besleme "yükleniyor" olarak görünür.
  const fresh = data && data.product === product.toUpperCase() ? data : null;
  const activeError = error && error.product === product.toUpperCase() ? error.message : null;

  return {
    spot: fresh?.spot ?? null,
    surface: fresh?.surface ?? null,
    snapshotISO: fresh?.snapshotISO ?? null,
    rateNote: fresh?.rateNote ?? null,
    loading: !fresh && !activeError,
    refreshing,
    error: activeError,
    refetch: fetchFeed,
    refreshChains,
  };
}
