"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ExposureData {
  currency: { name: string; value: number; color: string }[];
  product: { name: string; value: number; color: string }[];
  direction: { name: string; value: number; color: string }[];
  expiry: { name: string; value: number; color: string }[];
}

export function ExposureDashboard({ data }: { data: ExposureData }) {
  const renderStackedBar = (title: string, items: { name: string; value: number; color: string }[]) => {
    const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
    
    return (
      <div className="space-y-3 p-4 border border-slate-800 bg-slate-900/30 rounded-lg shadow-inner">
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{title}</h4>
        <div className="flex w-full h-3 rounded-full overflow-hidden bg-slate-900 border border-slate-800">
          {items.map((item, i) => {
            const pct = (item.value / total) * 100;
            if (pct === 0) return null;
            return <div key={i} className={cn("h-full transition-all duration-500", item.color)} style={{ width: `${pct}%` }} title={`${item.name}: ${pct.toFixed(1)}%`} />
          })}
        </div>
        <div className="flex gap-4 text-xs mt-2 flex-wrap pt-2 border-t border-slate-800/50">
          {items.map((item, i) => {
            const pct = (item.value / total) * 100;
            if (pct === 0) return null;
            return (
              <div key={i} className="flex items-center gap-1.5">
                <span className={cn("w-2 h-2 rounded-full", item.color)} />
                <span className="text-slate-300 font-medium">{item.name} <span className="text-slate-500 font-mono">({pct.toFixed(1)}%)</span></span>
              </div>
            )
          })}
        </div>
      </div>
    );
  };

  return (
    <Card className="bg-[#0b1120] border-slate-800 shadow-xl">
      <CardHeader className="pb-3 border-b border-slate-800">
        <CardTitle className="text-orange-500 uppercase text-xs font-bold tracking-widest">Risk & Dağılım Paneli</CardTitle>
      </CardHeader>
      <CardContent className="space-y-8 pt-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {renderStackedBar("Ürün Dağılımı (Büyüklük)", data.product)}
          {renderStackedBar("Uzun (Long) / Kısa (Short) Yön Dağılımı", data.direction)}
          {renderStackedBar("Döviz Dağılımı (Teminat Cinsi)", data.currency)}
          {renderStackedBar("Vade Dağılımı (< 1 Hafta, < 1 Ay, > 1 Ay)", data.expiry)}
        </div>
      </CardContent>
    </Card>
  );
}
