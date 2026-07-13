"use client";

import { useState } from "react";
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

interface BarrierGreekResult {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

interface CalcResult {
  price: number;
  greeks: BarrierGreekResult;
  nearBarrier: boolean;
  knockedOut: boolean;
}

export function BarrierOptions({
  spot, strike, tYears, rate, lease, vol
}: BarrierOptionsProps) {
  const [barrierH, setBarrierH] = useState<number>(spot * 1.1);
  const [rebateR, setRebateR] = useState<number>(0);
  const [barrierType, setBarrierType] = useState<string>("cuo");
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0);

  const calculate = () => {
    // lib/math motoru direkt kullanılıyor
    const price = barrierPrice(spot, strike, barrierH, rebateR, tYears, rate / 100, lease / 100, vol / 100, barrierType);
    const greeks = barrierGreeks(spot, strike, barrierH, rebateR, tYears, rate / 100, lease / 100, vol / 100, barrierType, 365);

    const isUp = barrierType[1] === "u";
    const isOut = barrierType[2] === "o";
    // Greek'ler sonlu farkla; bariyer süreksizliğine yakın (~%3) Delta/Gamma güvenilmez
    const nearBarrier = spot > 0 && Math.abs(spot - barrierH) / spot < 0.03;
    // KO opsiyonu bariyeri zaten geçtiyse devre dışı — prim yalnızca rebate
    const knockedOut = isOut && ((isUp && spot >= barrierH) || (!isUp && spot <= barrierH));

    setCalcResult({ price, greeks, nearBarrier, knockedOut });
  };

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-zinc-300">Bariyer Opsiyonu (Knock-In / Knock-Out)</div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-zinc-400 text-xs uppercase tracking-wider">Bariyer Tipi</Label>
          <Select value={barrierType} onValueChange={(v) => setBarrierType(v || "cuo")}>
            <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
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
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-zinc-400 text-xs uppercase tracking-wider">Bariyer (H)</Label>
            <Input
              type="number"
              value={barrierH || ''}
              onChange={e => setBarrierH(Number(e.target.value))}
              className="bg-zinc-900 border-zinc-700 font-mono text-zinc-200"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-zinc-400 text-xs uppercase tracking-wider">Rebate (R)</Label>
            <Input
              type="number"
              value={rebateR || ''}
              onChange={e => setRebateR(Number(e.target.value))}
              className="bg-zinc-900 border-zinc-700 font-mono text-zinc-200"
            />
          </div>
        </div>
        <Button onClick={calculate} className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-bold tracking-wide">
          HESAPLA
        </Button>
      </div>

      {calcResult && (
        <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-700/50 flex flex-col gap-3 shadow-inner">
          <div className="flex justify-between items-center border-b border-zinc-700/50 pb-2">
            <span className="text-zinc-200 text-sm font-semibold tracking-wide">Bariyer Primi</span>
            <span className="text-2xl font-bold font-mono text-emerald-400">${formatCurrency(calcResult.price)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-xs text-zinc-500 uppercase">Delta</div>
              <div className="font-mono text-sm text-zinc-300">{calcResult.greeks.delta.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 uppercase">Gamma</div>
              <div className="font-mono text-sm text-zinc-300">{calcResult.greeks.gamma.toFixed(6)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 uppercase">Theta</div>
              <div className="font-mono text-sm text-zinc-300">{calcResult.greeks.theta.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 uppercase">Vega</div>
              <div className="font-mono text-sm text-zinc-300">{calcResult.greeks.vega.toFixed(4)}</div>
            </div>
          </div>

          {calcResult.knockedOut && (
            <div className="rounded-md border border-rose-600/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-300/90">
              ⚠ Spot bariyeri (H) zaten aştı — opsiyon devre dışı (knocked out). Prim yalnızca rebate&apos;ten ibarettir; Greek&apos;ler ~0.
            </div>
          )}
          {calcResult.nearBarrier && !calcResult.knockedOut && (
            <div className="rounded-md border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300/90">
              ⚠ Spot bariyere (H) yakın. Greek&apos;ler sonlu farkla hesaplanıyor; bariyerdeki süreksizlik nedeniyle Delta/Gamma bu bölgede oynak ve güvenilmez olabilir.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
