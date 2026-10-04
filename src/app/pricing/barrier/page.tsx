"use client";
import { TradeConditions } from '@/features/pricing/trade-conditions';
import { FeedStatus } from "@/features/pricing/feed-status";

import { usePricingModel } from "@/features/pricing/use-pricing-model";
import { PricingContextBar } from "@/features/pricing/pricing-context-bar";
import { BarrierOptions } from "@/features/pricing/barrier-options";

export default function BarrierPricingPage() {
  const { md, feed, daysToExpiry, tYears, effVol, volAtLevel, volModeAtLevel, barrierSpot, barrierLease, priceable, unpriceableReason } = usePricingModel();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bariyer Opsiyonlar</h1>
      </div>

      <TradeConditions />
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
      <FeedStatus feed={feed} />

      {/* Girdiler ana Fiyatlama ekranıyla BİREBİR aynı olmalı: aynı bariyer iki ekranda
          iki farklı prim veremez. Önceden burada ham kira + smile'sız (düz BS) yol
          kullanılıyordu; artık ikisi de gerçek spot + ima edilen carry + Vanna-Volga. */}
      {feed.surface?.curves && <p className="text-sm text-amber-400">Bariyer hesabı, vade-eşdeğer sabit faiz/taşıma yaklaşımıdır; dönemsel eğrinin tüm yolunu modellemez.</p>}
      {priceable ? <BarrierOptions
        spot={barrierSpot}
        strike={md.strike}
        tYears={tYears}
        rate={md.rate}
        lease={barrierLease}
        vol={effVol}
        volAtLevel={volAtLevel}
        volModeAtLevel={volModeAtLevel}
        contractSize={md.contractSize}
        detailed
      /> : <p className="rounded-lg border border-amber-500/30 p-4 text-sm text-amber-400">{unpriceableReason}</p>}
    </div>
  );
}
