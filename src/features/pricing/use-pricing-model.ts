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
  // İlk ATM ayarı store'da tutulur; hook yeniden bağlanınca seçilmiş strike silinmez.
  const { applyLiveSpot, product, manualSpot } = md;
  useEffect(() => {
    if (!manualSpot && feed.spot?.price) {
      const price = Math.round(feed.spot.price * 100) / 100;
      applyLiveSpot(product, price);
    }
  }, [feed.spot?.at, feed.spot?.price, manualSpot, product, applyLiveSpot]);

  // CME Yüzeyinden Zımni Kira (Implied Lease Rate) geldiğinde bunu otomatik olarak
  // ekrandaki Kira kutusuna yansıt. Böylece kullanıcı güncel piyasa kirasını doğrudan görür
  // ve dilerse üzerine yazabilir (manuel değiştirebilir).
  useEffect(() => {
    if (feed.surface?.impliedLeaseRate != null) {
      const impliedPct = Number((feed.surface.impliedLeaseRate * 100).toFixed(4));
      // Gereksiz re-render'ı önlemek için sadece farklıysa set et
      if (Math.abs(md.lease - impliedPct) > 0.0001) {
        md.setField("lease", impliedPct);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.surface?.fetchedISO]);

  // Yüzeyin faiz oranıyla (builtWithR) ekranı senkronize et
  useEffect(() => {
    if (feed.surface?.builtWithR != null) {
      const surfaceR = Number((feed.surface.builtWithR * 100).toFixed(4));
      if (Math.abs(md.rate - surfaceR) > 0.0001) {
        md.setField("rate", surfaceR);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.surface?.fetchedISO]);

  // Vade hesabı — geçersiz/silinmiş tarihte NaN'a düşmemek için son geçerli değer korunur
  const dayMs = 1000 * 3600 * 24;
  const rawDays = (new Date(md.expiryDate).getTime() - new Date(md.tradeDate).getTime()) / dayMs;
  const dateValid = isFinite(rawDays);
  const validDaysToExpiry = Math.max(rawDays, 0.5);
  const daysToExpiry = dateValid ? validDaysToExpiry : 90;
  const tYears = Math.max(daysToExpiry / md.basis, 0.001);

  // Fiyatlama forward'ı. 
  // Eskiden CME futures forward'ı (cmeFwd) doğrudan kullanılıyordu, ancak bu durum
  // spot zıpladığında fiyatlamanın dünkü fiyata kilitlenmesine yol açıyordu.
  // Artık Databento'dan hesaplanıp ekrana basılan Kira (md.lease) kullanılarak,
  // kusursuz ve anında tepki veren Canlı Forward üretiliyor.
  const carry = (md.rate - md.lease) / 100;
  const fwdExp = Math.exp(carry * (daysToExpiry / 365));
  
  const usingCmeFwd = false;
  const fwd = md.spot * fwdExp;
  const pricingSpot = md.spot;

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
  // NOT: "piyasa carry'si" gösterimi kaldırıldı — metallerde birden çok opsiyon vadesi aynı
  // futures'a yazıldığı için opsiyon vadelerinden ölçülen carry sistematik olarak şişiyor
  // (bkz. surfaceForwardCarry). Forward zaten futures'tan geldiğinden fiyata etkisi yok.

  /**
   * Herhangi bir FİYAT SEVİYESİ için smile vol'ü (%). Bariyer paneli bunu bariyer
   * seviyesinin (H) vol'ünü öğrenmek için kullanır: bariyerli opsiyonun değeri yalnız
   * strike'ın değil, bariyer civarındaki oynaklığın da fonksiyonudur (skew). Kote
   * aralığın dışındaysa null döner.
   */
  const volAtLevel = (level: number): number | null => {
    if (!feed.surface || !(level > 0) || fwd <= 0) return null;
    const iv = surfaceVol(feed.surface, level / fwd, daysToExpiry);
    return iv != null && isFinite(iv) ? iv * 100 : null;
  };

  /**
   * Yüzeyin hangi kaynaktan geldiği (ekranda smile başlığında gösterilir). Gözlemlenen
   * futures forward'ı (`f`) YALNIZ CME yüzeyinde bulunur — ayrı bir alan/istek
   * gerektirmeden güvenilir ayırt edici budur.
   */
  const surfaceIsCme = !!feed.surface?.expiries?.[0]?.f;
  const surfaceSourceLabel = feed.surface
    ? (surfaceIsCme ? `CME COMEX ${feed.surface.symbol} settlement` : `Yahoo ${feed.surface.symbol} (ETF) yüzeyi`)
    : undefined;

  /**
   * BARİYER için spot/carry. Vanilyada forward'ı sentetik spotla (pricingSpot) kurmak
   * zararsızdır — fiyat yalnız forward'a bakar. Bariyer ise GERÇEK spot yolunu izler:
   * hem "bariyere değdi mi" eşiği hem de bariyere olan mesafe gerçek seviyeyle ölçülür.
   * Sentetik spot gerçek spottan ~%0.3 sapıyordu ve bu sapma bariyere yaklaştıkça
   * primde %1–9'a kadar büyüyordu.
   *
   * Çözüm: spot GERÇEK kalır, carry forward'dan ima edilir — q = r − ln(F/S)/T. Bu, aynı
   * forward'ı (dolayısıyla aynı vanilya fiyatını) verirken bariyer mesafesini bozmaz.
   * CME forward'ı yoksa ima edilen q zaten kullanıcının girdiği kiraya eşit çıkar.
   */
  const barrierSpot = md.spot;
  const barrierLease = md.lease; // Artık doğrudan yüzeyden gelen veya kullanıcının girdiği kira geçerli

  return { md, feed, dateValid, daysToExpiry, tYears, smileIv, effVol, result, gr, autoAvailable, priceable, unpriceableReason, pricingSpot, fwd, usingCmeFwd, volAtLevel, barrierSpot, barrierLease, surfaceSourceLabel };
}

export const formatCurrency = (val: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

export const formatNumber = (val: number, dig = 4) =>
  Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: dig, maximumFractionDigits: dig });
