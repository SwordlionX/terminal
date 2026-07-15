"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMarketData } from "@/store/marketData";
import { useMarketFeed } from "@/hooks/use-market-feed";
import { surfaceVol, surfaceForward, surfaceForwardCarry } from "@/lib/vol/surface";
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
  const prevProduct = useRef(md.product);

  // Canlı spot geldiğinde otomatik uygula (5 dk'da bir tazelenir).
  // "Manuel" tiki işaretliyse canlı veri kullanıcının girdiği spotu EZMEZ.
  // Ürün değişmişse (ör. XAU -> XAG) strike de yeni spota (ATM) çekilir — aksi halde
  // eski ürünün ölçeğinde kalan strike, forward-moneyness'i kote aralığın dışına
  // taşıyıp sessizce "kote opsiyon yok"a düşürüyordu (surface.ts ekstrapolasyon yapmaz).
  useEffect(() => {
    if (!md.manualSpot && feed.spot?.price) {
      const price = Math.round(feed.spot.price * 100) / 100;
      md.setField("spot", price);
      if (prevProduct.current !== md.product) {
        md.setField("strike", price);
      }
    }
    prevProduct.current = md.product;
    // Kasıtlı: md.product BURADA yok. Ürün değişince feed.spot bir an eski ürünün
    // (bayat) verisini tutar; efekt yalnızca feed.spot GERÇEKTEN değiştiğinde (yeni
    // ürünün fetch'i tamamlandığında) çalışmalı, md.product'ın kendisi değiştiğinde değil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.spot?.at, feed.spot?.price, md.manualSpot]);

  // Vade hesabı — geçersiz/silinmiş tarihte NaN'a düşmemek için son geçerli değer korunur
  const dayMs = 1000 * 3600 * 24;
  const rawDays = (new Date(md.expiryDate).getTime() - new Date(md.tradeDate).getTime()) / dayMs;
  const dateValid = isFinite(rawDays);
  const validDaysToExpiry = Math.max(rawDays, 0.5);
  const daysToExpiry = dateValid ? validDaysToExpiry : 90;
  const tYears = Math.max(daysToExpiry / md.basis, 0.001);

  // Fiyatlama forward'ı. CME yüzeyi vade-başına GÖZLEMLENEN futures forward'ı taşır (m = K/f);
  // varsa (ve kullanıcı spotu manuel sabitlememişse) forward doğrudan futures'tan alınır —
  // böylece bozuk spot proxy'sinin sapması ne vol seçimine ne prime girer. Yoksa forward
  // eskisi gibi spottan türetilir (Yahoo/ETF yolu birebir korunur).
  const carry = (md.rate - md.lease) / 100;
  const fwdExp = Math.exp(carry * (daysToExpiry / 365)); // yüzey konvansiyonuyla (365) aynı taban
  const cmeFwd = feed.surface && !md.manualSpot ? surfaceForward(feed.surface, daysToExpiry) : null;
  const usingCmeFwd = cmeFwd != null && cmeFwd > 0;
  const fwd = usingCmeFwd ? cmeFwd : md.spot * fwdExp;
  // gk/greeks spot-tabanlı çalışır. Futures forward'ıyla tutarlı "efektif spot":
  // pricingSpot·e^{(r−q)T} = fwd  ⇒  gk'nın kurduğu forward tam olarak futures forward olur.
  const pricingSpot = usingCmeFwd ? cmeFwd / fwdExp : md.spot;

  // Volatilite: manuel tik yoksa smile'dan (de-Amerikanize IV), tik varsa kullanıcı girer.
  // Sorgu forward-moneyness (m = K/fwd) ile yapılır; yukarıdaki forward çapasını kullanır.
  const smileIv = useMemo(() => {
    if (!feed.surface || fwd <= 0) return null;
    const iv = surfaceVol(feed.surface, md.strike / fwd, daysToExpiry);
    return iv != null && isFinite(iv) ? iv * 100 : null;
  }, [feed.surface, md.strike, fwd, daysToExpiry]);

  // Otomatik (smile) modda vol sadece kote strike/vade aralığında türetilir.
  // Aralık dışıysa smileIv null gelir; bu durumda fiyat UYDURULMAZ — kullanıcı
  // bilerek "Manuel vol" tikini açmadıkça prim/Greeks gösterilmez.
  const autoAvailable = smileIv != null;
  const priceable = md.manualVol || autoAvailable;

  // priceable=false iken effVol sadece hesap NaN'a düşmesin diye tutulur; ekranda gösterilmez.
  const effVol = md.manualVol ? md.vol : (smileIv ?? md.vol);

  const unpriceableReason = priceable
    ? null
    : !feed.surface
      ? "Smile verisi yok — opsiyon zincirini yenileyin veya manuel vol girin."
      : "Bu strike/vade için kote opsiyon yok — güvenilir vol türetilemiyor.";

  const result = gk(pricingSpot, md.strike, tYears, md.rate / 100, md.lease / 100, effVol / 100);
  const gr = greeks(pricingSpot, md.strike, tYears, md.rate / 100, md.lease / 100, effVol / 100, md.basis);

  // CME forward aktifken forward futures'tan gelir → kira prime girmez; piyasa carry'si
  // (forward eğrisinden) ekranda bilgi olarak gösterilir.
  const cmeCarry = usingCmeFwd && feed.surface ? surfaceForwardCarry(feed.surface) : null;

  return { md, feed, dateValid, daysToExpiry, tYears, smileIv, effVol, result, gr, autoAvailable, priceable, unpriceableReason, pricingSpot, fwd, usingCmeFwd, cmeCarry };
}

export const formatCurrency = (val: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

export const formatNumber = (val: number, dig = 4) =>
  Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: dig, maximumFractionDigits: dig });
