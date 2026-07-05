"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type PositionType = "Long Call" | "Short Call" | "Long Put" | "Short Put";

interface PositionCardProps {
  spot: number;
  strike: number;
  callPremium: number;
  putPremium: number;
  contractSize: number;
}

export function PositionCard({ spot, strike, callPremium, putPremium, contractSize }: PositionCardProps) {
  const [selected, setSelected] = useState<PositionType>("Long Call");

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  const formatPercent = (val: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(val * 100);

  const callTotal = callPremium * contractSize;
  const putTotal = putPremium * contractSize;

  const getPositionDetails = (pos: PositionType, isBank: boolean) => {
    let premium = 0;
    let maxProfit = "";
    let maxLoss = "";
    let posName = "";

    // Müşteri pozisyonu bankanın tersidir
    const effectivePos = isBank ? pos : (
      pos === "Long Call" ? "Short Call" :
      pos === "Short Call" ? "Long Call" :
      pos === "Long Put" ? "Short Put" :
      "Long Put"
    );

    switch (effectivePos) {
      case "Long Call":
        posName = "Alış Ops. Al (Long Call)";
        premium = -callTotal;
        maxProfit = "Sınırsız";
        maxLoss = `$ ${formatCurrency(callTotal)}`;
        break;
      case "Short Call":
        posName = "Alış Ops. Sat (Short Call)";
        premium = callTotal;
        maxProfit = `$ ${formatCurrency(callTotal)}`;
        maxLoss = "Sınırsız";
        break;
      case "Long Put":
        posName = "Satış Ops. Al (Long Put)";
        premium = -putTotal;
        maxProfit = `Sınırlı ($ ${formatCurrency(strike * contractSize - putTotal)})`;
        maxLoss = `$ ${formatCurrency(putTotal)}`;
        break;
      case "Short Put":
        posName = "Satış Ops. Sat (Short Put)";
        premium = putTotal;
        maxProfit = `$ ${formatCurrency(putTotal)}`;
        maxLoss = `Sınırlı ($ ${formatCurrency(strike * contractSize - putTotal)})`;
        break;
    }

    const premiumPercent = (Math.abs(premium) / (spot * contractSize));

    return { posName, premium, premiumPercent, maxProfit, maxLoss };
  };

  const bank = getPositionDetails(selected, true);
  const customer = getPositionDetails(selected, false);

  const renderPanel = (title: string, data: any, borderColor: string, titleColor: string) => (
    <div className={cn("border rounded-md p-5 space-y-5", borderColor)}>
      <h3 className={cn("font-bold text-sm tracking-wide", titleColor)}>{title}</h3>
      <div className="space-y-3.5 text-sm">
        <div className="flex justify-between items-center pb-2 border-b border-border/10">
          <span className="text-muted-foreground">Pozisyon</span>
          <span className="font-semibold text-right">{data.posName}</span>
        </div>
        <div className="flex justify-between items-start pb-2 border-b border-border/10">
          <span className="text-muted-foreground mt-1">Prim (nakit akış)</span>
          <div className="text-right">
            <span className={cn("font-bold block", data.premium < 0 ? "text-rose-400" : "text-emerald-400")}>
              {data.premium < 0 ? "-$" : "+$"} {formatCurrency(Math.abs(data.premium))}
            </span>
            <span className="text-xs text-muted-foreground font-mono">({formatPercent(data.premiumPercent)}%)</span>
          </div>
        </div>
        <div className="flex justify-between items-center pb-2 border-b border-border/10">
          <span className="text-muted-foreground">Azami Kazanç</span>
          <span className="font-semibold">{data.maxProfit}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Azami Kayıp</span>
          <span className="font-semibold">{data.maxLoss}</span>
        </div>
      </div>
    </div>
  );

  return (
    <Card className="bg-[#0b1120] border-slate-800 text-slate-100 shadow-xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-orange-500 uppercase text-xs font-bold tracking-widest">Pozisyon</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { id: "Long Call", label: "ALIŞ OPS. AL", sub: "Long Call" },
            { id: "Short Call", label: "ALIŞ OPS. SAT", sub: "Short Call" },
            { id: "Long Put", label: "SATIŞ OPS. AL", sub: "Long Put" },
            { id: "Short Put", label: "SATIŞ OPS. SAT", sub: "Short Put" },
          ].map((btn) => (
            <button
              key={btn.id}
              onClick={() => setSelected(btn.id as PositionType)}
              className={cn(
                "flex flex-col items-center justify-center py-4 px-2 rounded-md border transition-all duration-200",
                selected === btn.id 
                  ? "border-orange-500 bg-orange-500/5 ring-1 ring-orange-500/20" 
                  : "border-slate-800 hover:border-slate-700 bg-slate-900/30"
              )}
            >
              <span className={cn("text-[11px] font-bold tracking-wide", selected === btn.id ? "text-orange-500" : "text-slate-300")}>{btn.label}</span>
              <span className="text-[10px] text-slate-500 mt-1.5">{btn.sub}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {renderPanel("BİZ (Banka / Hazine)", bank, "border-cyan-900/60 bg-cyan-950/10", "text-cyan-400")}
          {renderPanel("MÜŞTERİ", customer, "border-purple-900/60 bg-purple-950/10", "text-purple-400")}
        </div>
      </CardContent>
    </Card>
  );
}
