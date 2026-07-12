"use client";

import { usePricingModel } from "@/features/pricing/use-pricing-model";
import { PricingContextBar } from "@/features/pricing/pricing-context-bar";
import { HedgePanel } from "@/features/pricing/hedge-panel";

export default function DeltaHedgePricingPage() {
  const { md, feed, daysToExpiry, effVol, gr, priceable, unpriceableReason } = usePricingModel();
  // Kote strike/vade aralığı dışında (smile yok, manuel vol de kapalı) delta ÜRETİLMEZ — ana
  // fiyatlama sayfasıyla aynı kural: ekstrapolasyon yok, fallback vol ile hedge gösterilmez.
  const showHedge = priceable && gr != null;
  const deltaExposure = showHedge ? gr.call.delta * md.contractSize : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Delta Hedge</h1>
        <p className="text-sm text-muted-foreground mt-1">Delta nötr pozisyon için hedge büyüklüğü hesaplayıcı</p>
      </div>

      <PricingContextBar
        product={md.product}
        spot={md.spot}
        strike={md.strike}
        daysToExpiry={daysToExpiry}
        effVol={effVol}
        manualVol={md.manualVol}
        liveSource={feed.spot?.source}
        livePrice={feed.spot?.price}
      />

      {showHedge ? (
        <>
          <div className="p-4 rounded-lg border border-slate-800 bg-slate-900/30 text-sm text-slate-400">
            Call Delta: <span className="font-mono text-slate-200">{gr.call.delta.toFixed(4)}</span>
            {" · "}Kontrat: <span className="font-mono text-slate-200">{md.contractSize} ons</span>
            {" · "}Toplam Delta Exposure: <span className="font-mono text-slate-200">{deltaExposure.toFixed(3)} ons</span>
          </div>

          <HedgePanel
            spot={md.spot}
            usdTryRate={md.usdtry}
            deltaExposure={deltaExposure}
          />
        </>
      ) : (
        <div className="p-4 rounded-lg border border-amber-500/40 bg-amber-500/10 text-sm text-amber-400">
          Delta / hedge hesaplanamıyor: {unpriceableReason ?? "Greeks hesaplanamadı."}
        </div>
      )}
    </div>
  );
}
