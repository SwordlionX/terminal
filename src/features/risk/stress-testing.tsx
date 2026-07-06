"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface StressScenario {
  name: string;
  impactMtm: number;
  marginCallCount: number;
}

export function StressTesting({ scenarios }: { scenarios: StressScenario[] }) {
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

  return (
    <Card className="bg-[#0b1120] border-slate-800 shadow-xl">
      <CardHeader className="pb-3 border-b border-slate-800 flex flex-row items-center justify-between">
        <CardTitle className="text-orange-500 uppercase text-xs font-bold tracking-widest">Stres Testi ve Senaryo Motoru</CardTitle>
        <Button variant="outline" size="sm" className="h-6 text-[10px] bg-slate-900 border-slate-700 hover:bg-slate-800">
          Tümünü Çalıştır
        </Button>
      </CardHeader>
      <CardContent className="pt-5 space-y-3 h-[320px] overflow-y-auto custom-scrollbar pr-1">
        {scenarios.map((s, i) => (
          <div key={i} className="flex justify-between items-center p-3 border border-slate-800 bg-slate-900/40 rounded-lg hover:bg-slate-800/80 transition-colors">
            <div className="font-medium text-[13px] text-slate-300 w-1/2">{s.name}</div>
            <div className="flex gap-6 items-center w-1/2 justify-end">
              <div className="text-right">
                <div className="text-[9px] text-slate-500 uppercase tracking-widest">MTM Etkisi</div>
                <div className={`font-mono font-bold text-[13px] ${s.impactMtm >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {s.impactMtm >= 0 ? "+" : ""}{formatCurrency(s.impactMtm)}
                </div>
              </div>
              <div className="text-right w-20">
                <div className="text-[9px] text-slate-500 uppercase tracking-widest">Margin Calls</div>
                <div className="font-bold text-sm mt-0.5">
                  {s.marginCallCount > 0 ? (
                    <Badge variant="destructive" className="h-5 text-[10px] px-1.5">{s.marginCallCount} Hesap</Badge>
                  ) : (
                    <Badge variant="outline" className="h-5 text-[10px] px-1.5 border-slate-700 text-slate-500">Güvenli</Badge>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
        {scenarios.length === 0 && (
          <div className="text-xs text-slate-500 text-center py-4 border border-dashed border-slate-800 rounded">Henüz senaryo hesaplanmadı.</div>
        )}
      </CardContent>
    </Card>
  );
}
