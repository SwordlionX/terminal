"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface HedgePanelProps {
  spot: number;
  usdTryRate: number;
  deltaExposure: number; // Ons cinsinden delta
}

export function HedgePanel({ spot, usdTryRate, deltaExposure }: HedgePanelProps) {
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);

  const hedgeNeeded = -deltaExposure;
  const isBuy = hedgeNeeded >= 0;
  const usdHedge = Math.abs(hedgeNeeded * spot);
  const tryHedge = usdHedge * usdTryRate;

  return (
    <Card className="bg-[#0b1120] border-slate-800 text-slate-100 mt-6 shadow-xl">
      <CardHeader className="pb-3 border-b border-slate-800">
        <CardTitle className="text-zinc-300 uppercase text-xs font-bold tracking-widest">Riskten Korunma (Delta Hedge) Paneli</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="p-4 rounded-lg bg-slate-900/50 border border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-6 shadow-inner">
          <div className="space-y-1">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Hedge İşlemi (Delta Nötr İçin)</div>
            <div className="text-2xl font-bold font-mono flex items-center gap-2">
              <span className={cn(isBuy ? "text-emerald-400" : "text-rose-400")}>
                {hedgeNeeded === 0 ? "NÖTR" : (isBuy ? "AL" : "SAT")}
              </span>
              {hedgeNeeded !== 0 && (
                <span className="text-slate-200">{Math.abs(hedgeNeeded).toFixed(3)} <span className="text-sm font-sans text-slate-500">ons</span></span>
              )}
            </div>
          </div>
          
          <div className="space-y-1 border-l border-slate-800 pl-6">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Nakit Büyüklük (USD)</div>
            <div className="text-xl font-bold font-mono text-slate-300">
              ${formatCurrency(usdHedge)}
            </div>
          </div>
          
          <div className="space-y-1 border-l border-slate-800 pl-6">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Nakit Büyüklük (TRY)</div>
            <div className="text-xl font-bold font-mono text-slate-300">
              ₺{formatCurrency(tryHedge)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
