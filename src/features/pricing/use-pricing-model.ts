"use client";

import { useEffect, useMemo } from "react";
import { useMarketData } from "@/store/marketData";
import { useMarketFeed } from "@/hooks/use-market-feed";
import { surfaceVol } from "@/lib/vol/surface";
import { gk, greeks } from "@/lib/math";

/**
 * Fiyatlama ekranları arasında paylaşılan piyasa verisi + türetilmiş hesap mantığı.
 * useMarketData zaten global (Zustand) bir store olduğundan, bu hook'u ana Fiyatlama
 * sayfası ile Bariyer / Tersine Mühendislik / Delta Hedge alt sayfalarının hepsi
 * kullanabilir; girdiler (spot, strike, vade, vol...) sayfalar arasında senkron kalır.
 */
export function usePricingModel() {
  const md = useMarketData();
  const feed = useMarketFeed(md.product, md.rate / 100);

  // Canlı spot geldiğinde otomatik uygula (5 dk'da bir tazelenir).
  // "Manuel" tiki işaretliyse canlı veri kullanıcının girdiği spotu EZMEZ.
  useEffect(() => {
    if (!md.manualSpot && feed.spot?.price) {
      md.setField("spot", Math.round(feed.spot.price * 100) / 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.spot?.at, feed.spot?.price, md.manualSpot]);

  // Vade hesabı — geçersiz/silinmiş tarihte NaN'a düşmemek için son geçerli değer korunur
  const dayMs = 1000 * 3600 * 24;
  const rawDays = (new Date(md.expiryDate).getTime() - new Date(md.tradeDate).getTime()) / dayMs;
  const dateValid = isFinite(rawDays);
  const validDaysToExpiry = Math.max(rawDays, 0.5);
  const daysToExpiry = dateValid ? validDaysToExpiry : 90;
  const tYears = Math.max(daysToExpiry / md.basis, 0.001);

  // Volatilite: manuel tik yoksa smile'dan (de-Amerikanize IV), tik varsa kullanıcı girer
  const smileIv = useMemo(() => {
    if (!feed.surface || md.spot <= 0) return null;
    const iv = surfaceVol(feed.surface, md.strike / md.spot, daysToExpiry);
    return iv != null && isFinite(iv) ? iv * 100 : null;
  }, [feed.surface, md.strike, md.spot, daysToExpiry]);

  const effVol = md.manualVol ? md.vol : (smileIv ?? md.vol);

  const result = gk(md.spot, md.strike, tYears, md.rate / 100, md.lease / 100, effVol / 100);
  const gr = greeks(md.spot, md.strike, tYears, md.rate / 100, md.lease / 100, effVol / 100, md.basis);

  return { md, feed, dateValid, daysToExpiry, tYears, smileIv, effVol, result, gr };
}

export const formatCurrency = (val: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

export const formatNumber = (val: number, dig = 4) =>
  Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: dig, maximumFractionDigits: dig });
