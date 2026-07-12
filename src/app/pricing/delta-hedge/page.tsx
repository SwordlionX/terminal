"use client";

import { useState } from "react";
import { usePricingModel } from "@/features/pricing/use-pricing-model";
import { PricingContextBar } from "@/features/pricing/pricing-context-bar";
import { HedgePanel } from "@/features/pricing/hedge-panel";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function DeltaHedgePricingPage() {
  const { md, feed, daysToExpiry, effVol, gr, priceable, unpriceableReason } = usePricingModel();

  // Müşterinin pozisyonu (fiyatlanan opsiyon üzerinden): tip + yön. Miktar = pricing kontrat büyüklüğü.
  const [optionType, setOptionType] = useState<"call" | "put">("call");
  const [direction, setDirection] = useState<"long" | "short">("long");

  // Kote strike/vade aralığı dışında (smile yok, manuel vol de kapalı) delta ÜRETİLMEZ — ana
  // fiyatlama sayfasıyla aynı kural: ekstrapolasyon yok, fallback vol ile hedge gösterilmez.
  const showHedge = priceable && gr != null;

  // Birim delta: Call 0..1 (pozitif), Put -1..0 (negatif). Yön Short ise işaret ters çevrilir.
  const unitDelta = showHedge ? (optionType === "call" ? gr.call.delta : gr.put.delta) : 0;
  const positionDelta = direction === "long" ? unitDelta : -unitDelta;
  const deltaExposure = positionDelta * md.contractSize;

  const posLabel = `${direction === "long" ? "Long (Alış)" : "Short (Satış)"} ${optionType === "call" ? "Call" : "Put"}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Delta Hedge</h1>
        <p className="text-sm text-muted-foreground mt-1">Müşteri pozisyonunu girin — deltasını ve onu nötrleyecek hedge büyüklüğünü gösterir</p>
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

      {/* Müşteri pozisyonu seçimi */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-lg border border-slate-800 bg-slate-900/30">
        <div className="space-y-2">
          <Label className="text-slate-400 text-xs uppercase tracking-wider">Opsiyon Tipi</Label>
          <Select value={optionType} onValueChange={(v) => setOptionType(v === "put" ? "put" : "call")}>
            <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="call">Alış (Call)</SelectItem>
              <SelectItem value="put">Satış (Put)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-400 text-xs uppercase tracking-wider">Müşteri Yönü</Label>
          <Select value={direction} onValueChange={(v) => setDirection(v === "short" ? "short" : "long")}>
            <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="long">Long (Alış / müşteri aldı)</SelectItem>
              <SelectItem value="short">Short (Satış / müşteri yazdı)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-400 text-xs uppercase tracking-wider">Miktar (Kontrat)</Label>
          <div className="h-9 flex items-center font-mono text-slate-200">{md.contractSize} ons</div>
          <p className="text-[11px] text-slate-500">Piyasa verilerinden (kontrat büyüklüğü)</p>
        </div>
      </div>

      {showHedge ? (
        <>
          <div className="p-4 rounded-lg border border-slate-800 bg-slate-900/30 text-sm text-slate-400">
            Pozisyon: <span className="font-mono text-slate-200">{posLabel}</span>
            {" · "}Birim Delta: <span className="font-mono text-slate-200">{unitDelta.toFixed(4)}</span>
            {" · "}Pozisyon Delta: <span className="font-mono text-slate-200">{positionDelta.toFixed(4)}</span>
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
