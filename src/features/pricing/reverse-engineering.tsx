"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { impliedVol } from "@/lib/math";

interface ReverseEngineeringProps {
  spot: number;
  strike: number;
  tYears: number;
  rate: number;
  lease: number;
  contractSize: number;
}

export function ReverseEngineering({
  spot, strike, tYears, rate, lease
}: ReverseEngineeringProps) {
  const [targetPremium, setTargetPremium] = useState<number>(0);
  const [unitMode, setUnitMode] = useState<"oz" | "pct">("oz");
  const [optionType, setOptionType] = useState<"call" | "put">("call");
  
  const [resultIv, setResultIv] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const formatPercent = (val: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val * 100);

  const runReverse = () => {
    let price = targetPremium;
    if (unitMode === "pct") {
      price = (targetPremium / 100) * strike;
    }

    const res = impliedVol(spot, strike, tYears, rate / 100, lease / 100, price, optionType);
    if (res.ok) {
      setResultIv(res.vol);
      setErrorMsg(null);
    } else {
      setResultIv(null);
      setErrorMsg("Çözüm bulunamadı. Girdiğiniz prim, opsiyonun mevcut içsel değerinden düşük olabilir veya matematiksel sınır dışındadır.");
    }
  };

  return (
    <Card className="bg-[#0b1120] border-slate-800 text-slate-100 mt-6 shadow-xl">
      <CardHeader className="pb-3 border-b border-slate-800">
        <CardTitle className="text-zinc-300 uppercase text-xs font-bold tracking-widest">Tersine Mühendislik (Implied Volatility Solver)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-400 text-xs uppercase tracking-wider">Opsiyon Tipi</Label>
            <Select value={optionType} onValueChange={(v) => setOptionType(v === "put" ? "put" : "call")}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="call">Alış (Call)</SelectItem>
                <SelectItem value="put">Satış (Put)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-slate-400 text-xs uppercase tracking-wider">Hedef Prim</Label>
            <Input 
              type="number" 
              value={targetPremium || ''} 
              onChange={e => setTargetPremium(Number(e.target.value))} 
              className="bg-slate-900 border-slate-700 font-mono text-slate-200" 
              placeholder="örn. 120"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-400 text-xs uppercase tracking-wider">Prim Birimi</Label>
            <Select value={unitMode} onValueChange={(v) => setUnitMode(v === "pct" ? "pct" : "oz")}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-slate-200"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="oz">USD / ons</SelectItem>
                <SelectItem value="pct">% Notional</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={runReverse} className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-bold tracking-wide">
              IV ÇÖZ (ÇALIŞTIR)
            </Button>
          </div>
        </div>

        {resultIv !== null && (
          <div className="mt-4 p-5 rounded-lg bg-zinc-900/40 border border-zinc-700/50 flex justify-between items-center shadow-inner">
            <span className="text-zinc-200 font-semibold tracking-wide">Bulunan Zımni Volatilite (Implied Volatility):</span>
            <span className="text-3xl font-bold font-mono text-emerald-400">{formatPercent(resultIv)}%</span>
          </div>
        )}
        {errorMsg && (
          <div className="mt-4 p-4 rounded-lg bg-rose-950/20 border border-rose-900/50 text-rose-400 text-sm font-medium">
            {errorMsg}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
