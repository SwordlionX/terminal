"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { barrierPrice, barrierGreeks } from "@/lib/math";

interface BarrierOptionsProps {
  spot: number;
  strike: number;
  tYears: number;
  rate: number;
  lease: number;
  vol: number;
}

export function BarrierOptions({
  spot, strike, tYears, rate, lease, vol
}: BarrierOptionsProps) {
  const [barrierH, setBarrierH] = useState<number>(spot * 1.1);
  const [rebateR, setRebateR] = useState<number>(0);
  const [barrierType, setBarrierType] = useState<string>("cuo");
  const [calcResult, setCalcResult] = useState<any>(null);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0);

  const calculate = () => {
    // lib/math motoru direkt kullanılıyor
    const price = barrierPrice(spot, strike, barrierH, rebateR, tYears, rate / 100, lease / 100, vol / 100, barrierType);
    const greeks = barrierGreeks(spot, strike, barrierH, rebateR, tYears, rate / 100, lease / 100, vol / 100, barrierType, 365);
    setCalcResult({ price, greeks });
  };

  return (
    <Card className="bg-[#0b1120] border-slate-800 text-slate-100 mt-6 shadow-xl">
      <CardHeader className="pb-3 border-b border-slate-800">
        <CardTitle className="text-orange-500 uppercase text-xs font-bold tracking-widest">Bariyer Opsiyonları (Knock-Out / Knock-In)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pt-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-400 text-xs uppercase tracking-wider">Bariyer Tipi</Label>
            <Select value={barrierType} onValueChange={(v) => setBarrierType(v || "cuo")}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cuo">Call Up & Out (cuo)</SelectItem>
                <SelectItem value="cdo">Call Down & Out (cdo)</SelectItem>
                <SelectItem value="cui">Call Up & In (cui)</SelectItem>
                <SelectItem value="cdi">Call Down & In (cdi)</SelectItem>
                <SelectItem value="puo">Put Up & Out (puo)</SelectItem>
                <SelectItem value="pdo">Put Down & Out (pdo)</SelectItem>
                <SelectItem value="pui">Put Up & In (pui)</SelectItem>
                <SelectItem value="pdi">Put Down & In (pdi)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-400 text-xs uppercase tracking-wider">Bariyer (H)</Label>
            <Input 
              type="number" 
              value={barrierH || ''} 
              onChange={e => setBarrierH(Number(e.target.value))} 
              className="bg-slate-900 border-slate-700 font-mono text-slate-200" 
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-400 text-xs uppercase tracking-wider">Rebate (R)</Label>
            <Input 
              type="number" 
              value={rebateR || ''} 
              onChange={e => setRebateR(Number(e.target.value))} 
              className="bg-slate-900 border-slate-700 font-mono text-slate-200" 
            />
          </div>
          <div className="flex items-end">
            <Button onClick={calculate} className="w-full bg-cyan-700 hover:bg-cyan-600 text-white font-bold tracking-wide">
              HESAPLA
            </Button>
          </div>
        </div>

        {calcResult && (
          <div className="mt-4 p-5 rounded-lg bg-cyan-950/20 border border-cyan-900/50 flex flex-col gap-4 shadow-inner">
            <div className="flex justify-between items-center border-b border-cyan-900/50 pb-3">
              <span className="text-cyan-300 font-semibold tracking-wide">Bariyer Opsiyon Primi:</span>
              <span className="text-3xl font-bold font-mono text-emerald-400">${formatCurrency(calcResult.price)}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
              <div>
                <div className="text-xs text-slate-500 uppercase">Delta</div>
                <div className="font-mono text-sm text-slate-300">{calcResult.greeks.delta.toFixed(4)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase">Gamma</div>
                <div className="font-mono text-sm text-slate-300">{calcResult.greeks.gamma.toFixed(6)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase">Theta</div>
                <div className="font-mono text-sm text-slate-300">{calcResult.greeks.theta.toFixed(4)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase">Vega</div>
                <div className="font-mono text-sm text-slate-300">{calcResult.greeks.vega.toFixed(4)}</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}