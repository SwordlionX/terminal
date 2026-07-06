"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface ExpiryItem {
  id: string;
  customerName: string;
  product: string;
  position: string;
  date: Date;
  notional: number;
}

export function ExpiryCalendar({ items }: { items: ExpiryItem[] }) {
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
  
  const today = new Date();
  today.setHours(0,0,0,0);
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);
  
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);

  const categorize = (date: Date) => {
    const d = new Date(date);
    d.setHours(0,0,0,0);
    const time = d.getTime();
    if (time === today.getTime()) return "Bugün";
    if (time === tomorrow.getTime()) return "Yarın";
    if (time <= nextWeek.getTime()) return "Bu Hafta";
    if (time <= nextMonth.getTime()) return "Bu Ay";
    return "Daha Sonra";
  };

  const grouped = items.reduce((acc, item) => {
    const cat = categorize(item.date);
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, ExpiryItem[]>);

  const renderGroup = (title: string, catItems: ExpiryItem[] = [], color: string) => {
    return (
      <div className="space-y-3">
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex justify-between border-b border-slate-800 pb-2">
          <span>{title}</span>
          <Badge variant="outline" className={color}>{catItems.length}</Badge>
        </h4>
        <div className="space-y-2 h-[200px] overflow-y-auto pr-1 custom-scrollbar">
          {catItems.length === 0 ? (
            <div className="text-xs text-slate-600 italic py-4 text-center border border-dashed border-slate-800 rounded">İşlem Yok</div>
          ) : catItems.sort((a,b)=>a.date.getTime()-b.date.getTime()).map((it, i) => (
            <div key={i} className="p-2 bg-slate-900/40 border border-slate-800 rounded flex justify-between items-center hover:bg-slate-800 transition-colors cursor-pointer">
              <div>
                <div className="text-[11px] font-bold text-slate-300 truncate w-24 sm:w-32" title={it.customerName}>{it.customerName}</div>
                <div className="text-[10px] text-slate-500 uppercase">{it.product} {it.position}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xs text-slate-300">{formatCurrency(it.notional)}</div>
                <div className="text-[10px] text-slate-500 font-mono">{it.date.toLocaleDateString('tr-TR')}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Card className="bg-[#0b1120] border-slate-800 shadow-xl">
      <CardHeader className="pb-3 border-b border-slate-800">
        <CardTitle className="text-orange-500 uppercase text-xs font-bold tracking-widest">Vade Takvimi (Yaklaşan Vadeler)</CardTitle>
      </CardHeader>
      <CardContent className="pt-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {renderGroup("Bugün", grouped["Bugün"], "text-rose-400 border-rose-500/50")}
          {renderGroup("Yarın", grouped["Yarın"], "text-orange-400 border-orange-500/50")}
          {renderGroup("Bu Hafta", grouped["Bu Hafta"], "text-yellow-400 border-yellow-500/50")}
          {renderGroup("Bu Ay", grouped["Bu Ay"], "text-emerald-400 border-emerald-500/50")}
        </div>
      </CardContent>
    </Card>
  );
}
