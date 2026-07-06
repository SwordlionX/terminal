"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface GreeksData {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
}

interface GreeksDashboardProps {
  portfolioGreeks: GreeksData;
  customerGreeks: { name: string; greeks: GreeksData }[];
}

export function GreeksDashboard({ portfolioGreeks, customerGreeks }: GreeksDashboardProps) {
  const formatNumber = (val: number, digits = 0) => new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(val);

  const renderBarChart = (title: string, value: number, maxValue: number, colorClass: string) => {
    // Normalization logic for dual-sided bar chart
    const safeMax = maxValue === 0 ? 1 : maxValue;
    const width = Math.min(100, Math.abs(value / safeMax) * 100);
    const isNegative = value < 0;

    return (
      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] items-center">
          <span className="text-slate-500 uppercase tracking-wider">{title}</span>
          <span className="font-mono font-bold text-slate-300">{formatNumber(value, 2)}</span>
        </div>
        <div className="flex items-center w-full h-2 bg-slate-900 rounded-full overflow-hidden relative border border-slate-800">
          <div className="absolute left-1/2 w-px h-full bg-slate-600 z-10" />
          <div className="w-1/2 h-full flex justify-end">
            {isNegative && <div className={cn("h-full", colorClass)} style={{ width: `${width}%` }} />}
          </div>
          <div className="w-1/2 h-full flex justify-start">
            {!isNegative && <div className={cn("h-full", colorClass)} style={{ width: `${width}%` }} />}
          </div>
        </div>
      </div>
    );
  };

  const maxD = Math.max(...customerGreeks.map(c => Math.abs(c.greeks.delta)), Math.abs(portfolioGreeks.delta));
  const maxG = Math.max(...customerGreeks.map(c => Math.abs(c.greeks.gamma)), Math.abs(portfolioGreeks.gamma));
  const maxV = Math.max(...customerGreeks.map(c => Math.abs(c.greeks.vega)), Math.abs(portfolioGreeks.vega));
  const maxT = Math.max(...customerGreeks.map(c => Math.abs(c.greeks.theta)), Math.abs(portfolioGreeks.theta));

  return (
    <Card className="bg-[#0b1120] border-slate-800 shadow-xl">
      <CardHeader className="pb-3 border-b border-slate-800">
        <CardTitle className="text-orange-500 uppercase text-xs font-bold tracking-widest">Greeks Analizi (Net Pozisyon)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pt-5">
        <div className="p-4 border border-slate-800 bg-slate-900/40 rounded-lg shadow-inner">
          <h3 className="text-[13px] font-bold text-slate-300 mb-4 uppercase tracking-wider">Toplam Portföy Greek Değerleri</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {renderBarChart("Net Delta", portfolioGreeks.delta, maxD, "bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]")}
            {renderBarChart("Net Gamma", portfolioGreeks.gamma, maxG, "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]")}
            {renderBarChart("Net Vega", portfolioGreeks.vega, maxV, "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]")}
            {renderBarChart("Net Theta", portfolioGreeks.theta, maxT, "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]")}
          </div>
        </div>

        <div>
          <h3 className="text-[11px] uppercase tracking-widest font-bold text-slate-500 mb-4 px-1">En Yüksek Riske Sahip Müşteriler</h3>
          <div className="space-y-5">
            {customerGreeks.slice(0, 5).map((c, i) => (
              <div key={i} className="grid grid-cols-5 gap-6 items-center">
                <div className="text-xs truncate font-medium text-slate-300" title={c.name}>{c.name}</div>
                {renderBarChart("Delta", c.greeks.delta, maxD, "bg-sky-500/80")}
                {renderBarChart("Gamma", c.greeks.gamma, maxG, "bg-indigo-500/80")}
                {renderBarChart("Vega", c.greeks.vega, maxV, "bg-emerald-500/80")}
                {renderBarChart("Theta", c.greeks.theta, maxT, "bg-rose-500/80")}
              </div>
            ))}
            {customerGreeks.length === 0 && (
              <div className="text-xs text-slate-500 text-center py-4">Müşteri Greek verisi bulunamadı.</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
