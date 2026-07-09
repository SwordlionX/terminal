"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PortfolioSummaryProps {
  totalNotional: number;
  totalPnl: number;
  totalMargin: number;
  totalCollateral: number;
}

export function PortfolioSummary({ totalNotional, totalPnl, totalMargin, totalCollateral }: PortfolioSummaryProps) {
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
  const marginUtil = totalCollateral > 0 ? (totalMargin / totalCollateral) * 100 : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card className="bg-[#0b1120] border-slate-800 shadow-lg">
        <CardHeader className="pb-2"><CardTitle className="text-xs text-slate-400 uppercase tracking-wider">Toplam Portföy Büyüklüğü</CardTitle></CardHeader>
        <CardContent><div className="text-2xl font-bold font-mono text-slate-100">{formatCurrency(totalNotional)}</div></CardContent>
      </Card>
      <Card className="bg-[#0b1120] border-slate-800 shadow-lg">
        <CardHeader className="pb-2"><CardTitle className="text-xs text-slate-400 uppercase tracking-wider">Net K/Z (Açık Pozisyonlar)</CardTitle></CardHeader>
        <CardContent><div className={cn("text-2xl font-bold font-mono", totalPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{totalPnl >= 0 ? "+" : ""}{formatCurrency(totalPnl)}</div></CardContent>
      </Card>
      <Card className="bg-[#0b1120] border-slate-800 shadow-lg">
        <CardHeader className="pb-2"><CardTitle className="text-xs text-slate-400 uppercase tracking-wider">Gereken Toplam Teminat</CardTitle></CardHeader>
        <CardContent><div className="text-2xl font-bold font-mono text-slate-100">{formatCurrency(totalMargin)}</div></CardContent>
      </Card>
      <Card className="bg-[#0b1120] border-slate-800 shadow-lg">
        <CardHeader className="pb-2"><CardTitle className="text-xs text-slate-400 uppercase tracking-wider">Teminat Kullanımı</CardTitle></CardHeader>
        <CardContent>
          <div className="text-2xl font-bold font-mono text-slate-100">{marginUtil.toFixed(1)}%</div>
          <div className="w-full bg-slate-800 h-1.5 mt-2 rounded-full overflow-hidden">
            <div className={cn("h-full", marginUtil > 80 ? "bg-rose-500" : marginUtil > 60 ? "bg-orange-500" : marginUtil > 40 ? "bg-yellow-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, marginUtil)}%` }} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
