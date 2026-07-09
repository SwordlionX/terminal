"use client";

import { usePricingModel } from "@/features/pricing/use-pricing-model";
import { PricingContextBar } from "@/features/pricing/pricing-context-bar";
import { ReverseEngineering } from "@/features/pricing/reverse-engineering";

export default function ReverseEngineeringPricingPage() {
  const { md, feed, daysToExpiry, tYears, effVol } = usePricingModel();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tersine Mühendislik</h1>
        <p className="text-sm text-muted-foreground mt-1">Hedef primden zımni volatilite (implied volatility) çözümü</p>
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

      <ReverseEngineering
        spot={md.spot}
        strike={md.strike}
        tYears={tYears}
        rate={md.rate}
        lease={md.lease}
        contractSize={md.contractSize}
      />
    </div>
  );
}
