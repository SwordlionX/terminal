"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { NumberInput } from "@/components/ui/number-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { gk, greeks } from "@/lib/math";

interface ScenarioProps {
  spot: number;
  strike: number;
  tYears: number;
  rate: number;
  lease: number;
  vol: number;
  contractSize: number;
  callPremium: number;
  putPremium: number;
}

export function ScenarioAnalysis({
  spot, strike, tYears, rate, lease, vol, contractSize, callPremium, putPremium
}: ScenarioProps) {
  const minSpot = Math.max(1, strike * 0.75);
  const maxSpot = strike * 1.25;
  const [scenarioSpot, setScenarioSpot] = useState(spot);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  const formatPercent = (val: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val * 100);

  const renderCol = (title: string, sub: string, pos: "Long Call"|"Short Call"|"Long Put"|"Short Put", prm: number) => {
    let maxP: string, maxL: string, be: number, pnlUnit: number;
    const s = scenarioSpot;
    
    const currentIv = pos.includes("Call") ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
    const tv = prm - currentIv;

    if (pos.includes("Call")) {
      be = strike + prm;
    } else {
      be = strike - prm;
    }

    if (pos === "Long Call") {
      maxP = "Sınırsız"; maxL = `$${formatCurrency(prm * contractSize)}`;
      pnlUnit = Math.max(0, s - strike) - prm;
    } else if (pos === "Short Call") {
      maxP = `$${formatCurrency(prm * contractSize)}`; maxL = "Sınırsız";
      pnlUnit = prm - Math.max(0, s - strike);
    } else if (pos === "Long Put") {
      maxP = `$${formatCurrency((strike - prm) * contractSize)}`; maxL = `$${formatCurrency(prm * contractSize)}`;
      pnlUnit = Math.max(0, strike - s) - prm;
    } else {
      maxP = `$${formatCurrency(prm * contractSize)}`; maxL = `$${formatCurrency((strike - prm) * contractSize)}`;
      pnlUnit = prm - Math.max(0, strike - s);
    }

    const pnlTotal = pnlUnit * contractSize;
    const roi = prm !== 0 ? (pnlUnit / prm) : 0;

    return (
      <div className="space-y-3 p-4 border border-zinc-800 rounded-md bg-zinc-900/30 shadow-inner">
        <div className="border-b border-zinc-800 pb-2">
          <div className="text-[13px] font-bold text-zinc-300">{title}</div>
          <div className="text-[11px] text-zinc-500">{sub}</div>
        </div>
        <div className="space-y-2.5 text-xs">
          <div className="flex justify-between"><span className="text-zinc-400">Azami Kazanç</span><span>{maxP}</span></div>
          <div className="flex justify-between"><span className="text-zinc-400">Azami Kayıp</span><span>{maxL}</span></div>
          <div className="flex justify-between"><span className="text-zinc-400">Başabaş (Breakeven)</span><span className="font-mono">{formatCurrency(be)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-400">Mevcut İçsel Değer</span><span className="font-mono">{formatCurrency(currentIv)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-400">Mevcut Zaman Değeri</span><span className="font-mono">{formatCurrency(tv)}</span></div>
          <div className="flex justify-between mt-3 pt-3 border-t border-zinc-800"><span className="text-zinc-400">Net K/Z (ons)</span><span className={cn("font-mono", pnlUnit >= 0 ? "text-emerald-400" : "text-rose-400")}>{formatCurrency(pnlUnit)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-400">Net K/Z (toplam $)</span><span className={cn("font-mono font-bold text-[13px]", pnlTotal >= 0 ? "text-emerald-400" : "text-rose-400")}>{pnlTotal >= 0 ? "+" : ""}{formatCurrency(pnlTotal)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-400">Getiri (ROI)</span><span className={cn("font-mono", roi >= 0 ? "text-emerald-400" : "text-rose-400")}>{formatPercent(roi)}%</span></div>
        </div>
      </div>
    );
  };

  const steps = 15;
  const stepSize = (maxSpot - minSpot) / steps;
  const tableRows = [];
  for (let i = 0; i <= steps; i++) {
    const s = minSpot + (i * stepSize);
    const g = gk(s, strike, tYears, rate / 100, lease / 100, vol / 100);
    const gr = greeks(s, strike, tYears, rate / 100, lease / 100, vol / 100, 365);
    if (!gr) continue;
    const intrinsicValue = Math.max(0, s - strike);
    const pnl = (g.call - callPremium) * contractSize;
    tableRows.push({ spot: s, iv: intrinsicValue, price: g.call, pnl, delta: gr.call.delta, gamma: gr.call.gamma, theta: gr.call.theta, vega: gr.call.vega });
  }

  return (
    <div className="space-y-6 mt-6">
      <Card className="bg-[#09090b] border-zinc-800 text-zinc-100 shadow-xl">
        <CardHeader className="pb-4">
          <CardTitle className="text-zinc-300 uppercase text-xs font-bold tracking-widest">Vade Sonu Senaryo Analizi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-5 p-4 rounded-lg bg-zinc-900/50 border border-zinc-800">
            <span className="text-sm font-semibold whitespace-nowrap text-zinc-300">Senaryo Fiyatı (Vade Sonu)</span>
            <NumberInput
              value={scenarioSpot}
              onValueChange={setScenarioSpot}
              className="w-28 bg-[#09090b] border-zinc-700 text-center font-mono"
            />
            <Slider 
              value={[scenarioSpot]} 
              min={minSpot} 
              max={maxSpot} 
              step={0.1}
              onValueChange={(val) => setScenarioSpot(Array.isArray(val) ? val[0] : val)}
              className="flex-1"
            />
            <span className="text-sm font-mono font-bold w-24 text-right text-zinc-200">{formatCurrency(scenarioSpot)}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {renderCol("Alış Ops. Al", "(Long Call)", "Long Call", callPremium)}
            {renderCol("Alış Ops. Sat", "(Short Call)", "Short Call", callPremium)}
            {renderCol("Satış Ops. Al", "(Long Put)", "Long Put", putPremium)}
            {renderCol("Satış Ops. Sat", "(Short Put)", "Short Put", putPremium)}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#09090b] border-zinc-800 text-zinc-100 shadow-xl overflow-hidden">
        <CardHeader className="bg-zinc-900/30 border-b border-zinc-800 pb-3 pt-4">
          <CardTitle className="text-zinc-300 uppercase text-xs font-bold tracking-widest flex justify-between">
            <span>Senaryo Tablosu (Long Call)</span>
            <span className="text-zinc-500 text-[10px]">{steps + 1} Fiyat Seviyesi</span>
          </CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-zinc-900/10">
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400 text-xs">Spot</TableHead>
                <TableHead className="text-zinc-400 text-xs text-right">İçsel Değer</TableHead>
                <TableHead className="text-zinc-400 text-xs text-right">Opsiyon Değeri</TableHead>
                <TableHead className="text-zinc-400 text-xs text-right">Kâr/Zarar ($)</TableHead>
                <TableHead className="text-zinc-400 text-xs text-right">Delta</TableHead>
                <TableHead className="text-zinc-400 text-xs text-right">Gamma</TableHead>
                <TableHead className="text-zinc-400 text-xs text-right">Theta</TableHead>
                <TableHead className="text-zinc-400 text-xs text-right">Vega</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableRows.map((r, i) => (
                <TableRow key={i} className="border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                  <TableCell className="font-mono text-xs font-bold text-zinc-200">{formatCurrency(r.spot)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-zinc-400">{formatCurrency(r.iv)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-zinc-200 font-semibold">{formatCurrency(r.price)}</TableCell>
                  <TableCell className={cn("text-right font-mono text-xs font-bold", r.pnl >= 0 ? "text-emerald-500" : "text-rose-500")}>
                    {r.pnl >= 0 ? "+" : ""}{formatCurrency(r.pnl)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] text-zinc-500">{r.delta.toFixed(4)}</TableCell>
                  <TableCell className="text-right font-mono text-[11px] text-zinc-500">{r.gamma.toFixed(6)}</TableCell>
                  <TableCell className="text-right font-mono text-[11px] text-zinc-500">{r.theta.toFixed(4)}</TableCell>
                  <TableCell className="text-right font-mono text-[11px] text-zinc-500">{r.vega.toFixed(4)}</TableCell>
                </TableRow>
                 ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
