"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface HeatMapCustomer {
  id: string;
  name: string;
  marginUtil: number; // percentage
  pnl: number;
}

interface HeatMapProps {
  customers: HeatMapCustomer[];
}

export function HeatMap({ customers }: HeatMapProps) {
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

  const getRiskLevel = (util: number) => {
    if (util > 80) return "Critical";
    if (util > 60) return "High";
    if (util > 40) return "Medium";
    return "Low";
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case "Critical": return "bg-rose-500/20 border-rose-500/50 text-rose-500 hover:bg-rose-500/30";
      case "High": return "bg-orange-500/20 border-orange-500/50 text-orange-500 hover:bg-orange-500/30";
      case "Medium": return "bg-yellow-500/20 border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/30";
      case "Low": return "bg-emerald-500/20 border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/30";
      default: return "";
    }
  };

  const sorted = [...customers].sort((a, b) => b.marginUtil - a.marginUtil);

  return (
    <Card className="bg-[#09090b] border-zinc-800 shadow-xl">
      <CardHeader>
        <CardTitle className="text-zinc-300 uppercase text-xs font-bold tracking-widest flex items-center gap-2">
          Risk Isı Haritası (Müşteri Limitleri)
          <div className="flex gap-2 ml-auto text-[10px] font-normal tracking-normal text-zinc-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span>Düşük (&lt;40%)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500"></span>Orta (40-60%)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500"></span>Yüksek (60-80%)</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500"></span>Kritik (&gt;80%)</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {sorted.map((c) => {
            const level = getRiskLevel(c.marginUtil);
            return (
              <a href={`/customers/${c.id}/margin`} key={c.id} className={cn("block p-3 rounded-md border transition-all cursor-pointer", getRiskColor(level))}>
                <div className="font-bold text-sm truncate" title={c.name}>{c.name}</div>
                <div className="flex justify-between items-end mt-2">
                  <div className="text-xs opacity-80">Util: <span className="font-mono font-bold text-sm">{c.marginUtil.toFixed(1)}%</span></div>
                </div>
                <div className="text-xs opacity-80 mt-1">K/Z: <span className="font-mono">{formatCurrency(c.pnl)}</span></div>
              </a>
            );
          })}
        </div>
        {sorted.length === 0 && (
          <div className="text-sm text-zinc-500 text-center py-6">Müşteri verisi bulunamadı.</div>
        )}
      </CardContent>
    </Card>
  );
}
