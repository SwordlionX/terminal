'use client';

import { useEffect, useMemo } from 'react';
import { useMarketData } from '@/store/marketData';
import { useMarketFeed } from '@/hooks/use-market-feed';
import { surfaceVolEstimate } from '@/lib/vol/surface';
import { calculatePricing } from '@/lib/pricing/engine';

/**
 * Fiyatlama ekranları arasında paylaşılan piyasa verisi + türetilmiş hesap mantığı.
 * useMarketData zaten global (Zustand) bir store olduğundan, bu hook'u ana Fiyatlama
 * sayfası ile Bariyer / Tersine Mühendislik / Delta Hedge alt sayfalarının hepsi
 * kullanabilir; girdiler (spot, strike, vade, vol...) sayfalar arasında senkron kalır.
 */
export function usePricingModel() {
  const md = useMarketData();
  const feed = useMarketFeed(md.product);
  // İlk ATM ayarı store'da tutulur; hook yeniden bağlanınca seçilmiş strike silinmez.
  const { applyLiveSpot, product, manualSpot, syncToday } = md;
  useEffect(() => {
    // Her besleme yenilemesinde gün dönümü kontrol edilir; elle seçilmiş tarih korunur.
    syncToday();
    if (!manualSpot && feed.spot?.price) {
      const price = Math.round(feed.spot.price * 100) / 100;
      applyLiveSpot(product, price);
    }
  }, [feed.spot?.at, feed.spot?.price, manualSpot, product, applyLiveSpot, syncToday]);

  // Rates are derived per maturity from factor curves, never written back as editable assumptions.
  const resolved = useMemo(() => calculatePricing(md, feed.surface), [md, feed.surface]);
  const {
    dateValid,
    daysToExpiry,
    tYears,
    fwd,
    pricingSpot,
    smileEstimate,
    smileIv,
    numericInputsValid,
    effVol,
    result,
    gr,
    autoAvailable,
    priceable,
    unpriceableReason,
  } = resolved;
  const usingCmeFwd = false;

  // The requested maturity uses USD and metal factor ratios from one market bundle.

  /**
   * Herhangi bir FİYAT SEVİYESİ için smile vol'ü (%). Bariyer paneli bunu bariyer
   * seviyesinin (H) vol'ünü öğrenmek için kullanır: bariyerli opsiyonun değeri yalnız
   * strike'ın değil, bariyer civarındaki oynaklığın da fonksiyonudur (skew). Kote
   * sınırlı SSVI kanadının da dışındaysa null döner.
   */
  const volAtLevel = (level: number): number | null => {
    if (!feed.surface || !(level > 0) || !numericInputsValid) return null;
    const iv = surfaceVolEstimate(feed.surface, level / fwd, daysToExpiry, md.tradeDate).vol;
    return iv != null && isFinite(iv) ? iv * 100 : null;
  };
  const volModeAtLevel = (level: number) => {
    if (!feed.surface || !(level > 0) || !numericInputsValid) return 'unavailable' as const;
    return surfaceVolEstimate(feed.surface, level / fwd, daysToExpiry, md.tradeDate).mode;
  };

  const surfaceSourceLabel = feed.surface ? `CME COMEX ${feed.surface.symbol} settlement` : undefined;

  // Barrier closed form uses maturity-equivalent constants: explicitly an approximation.
  const barrierSpot = md.spot;
  const barrierLease = resolved.effectiveLease;
  const hasCurves = Boolean(feed.surface?.curves);
  const effectiveMd = useMemo(
    () => (hasCurves ? { ...md, rate: resolved.effectiveRate, lease: resolved.effectiveLease } : md),
    [hasCurves, md, resolved.effectiveRate, resolved.effectiveLease],
  );

  return {
    md: effectiveMd,
    feed,
    dateValid,
    daysToExpiry,
    tYears,
    smileIv,
    smileEstimate,
    effVol,
    result,
    gr,
    autoAvailable,
    priceable,
    unpriceableReason,
    pricingSpot,
    fwd,
    usingCmeFwd,
    volAtLevel,
    volModeAtLevel,
    barrierSpot,
    barrierLease,
    surfaceSourceLabel,
    displayRate: resolved.displayRate,
    displayLease: resolved.displayLease,
  };
}
