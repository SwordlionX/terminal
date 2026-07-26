"use client";

import { usePricingModel } from "@/features/pricing/use-pricing-model";
import { PricingContextBar } from "@/features/pricing/pricing-context-bar";
import { BarrierOptions } from "@/features/pricing/barrier-options";

export default function BarrierPricingPage() {
  const { md, feed, daysToExpiry, tYears, effVol, volAtLevel, barrierSpot, barrierLease } = usePricingModel();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bariyer Opsiyonlar</h1>
        <p className="text-sm text-muted-foreground mt-1">Knock-In / Knock-Out bariyer opsiyon fiyatlama ve Greeks</p>
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

      {/* Girdiler ana Fiyatlama ekranıyla BİREBİR aynı olmalı: aynı bariyer iki ekranda
          iki farklı prim veremez. Önceden burada ham kira + smile'sız (düz BS) yol
          kullanılıyordu; artık ikisi de gerçek spot + ima edilen carry + Vanna-Volga. */}
      <BarrierOptions
        spot={barrierSpot}
        strike={md.strike}
        tYears={tYears}
        rate={md.rate}
        lease={barrierLease}
        vol={effVol}
        volAtLevel={volAtLevel}
      />
    </div>
  );
}
