"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { VolSurface } from '@/lib/vol/surface';

const REFRESH_MS = 5 * 60 * 1000; // sayfa açıkken 5 dakikada bir tazele

export interface MarketFeed {
  spot: { price: number; at: number; source: string } | null;
  surface: VolSurface | null;
  snapshotISO: string | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refetch: () => void;
  refreshChains: () => Promise<void>;
}

/** Fiyatlama ekranı piyasa beslemesi: güncel spot + de-Amerikanize IV yüzeyi. */
export function useMarketFeed(product: string, rate: number): MarketFeed {
  const [spot, setSpot] = useState<MarketFeed['spot']>(null);
  const [surface, setSurface] = useState<VolSurface | null>(null);
  const [snapshotISO, setSnapshotISO] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchFeed = useCallback(async () => {
    try {
      const res = await fetch(`/api/market?product=${product}&rate=${rate}`, { cache: 'no-store' });
      const j = await res.json();
      setSpot(j.spot);
      setSurface(j.surface);
      setSnapshotISO(j.snapshotISO);
      setError(null);
    } catch {
      setError('Piyasa verisi alınamadı');
    } finally {
      setLoading(false);
    }
  }, [product, rate]);

  useEffect(() => {
    setLoading(true);
    fetchFeed();
    timer.current = setInterval(fetchFeed, REFRESH_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
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
      setError(e instanceof Error ? e.message : 'Zincir yenileme başarısız');
    } finally {
      setRefreshing(false);
    }
  }, [fetchFeed]);

  return { spot, surface, snapshotISO, loading, refreshing, error, refetch: fetchFeed, refreshChains };
}
