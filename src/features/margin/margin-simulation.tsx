"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const CURE_TARGET = 0.35; // config.RISK_THRESHOLDS.CURE_TARGET ile aynı — oranın indirileceği hedef

interface MarginSimulationProps {
  initialLoss: number;
  initialCollateral: number;
}

export function MarginSimulation({ initialLoss, initialCollateral }: MarginSimulationProps) {
  const [addedCollateral, setAddedCollateral] = useState<number>(0);
  const [addedLoss, setAddedLoss] = useState<number>(0);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  // Teminat artık yalnızca USD/XAU/XAG nakit-eşdeğeri (haircut 0) → eklenen teminat 1:1 sayılır.
  const totalCollateral = initialCollateral + addedCollateral;
  const totalLoss = Math.max(0, initialLoss + addedLoss);

  const newRatio = totalCollateral > 0 ? totalLoss / totalCollateral : (totalLoss > 0 ? 1 : 0);
  const newCure = totalLoss > 0 ? Math.max(0, totalLoss / CURE_TARGET - totalCollateral) : 0;

  const ratioColor = newRatio > 0.80 ? "text-rose-500" : newRatio > 0.60 ? "text-orange-500" : newRatio > 0.39 ? "text-yellow-500" : "text-emerald-500";

  return (
    <Card className="border-zinc-700/60 shadow-lg shadow-black/20 bg-zinc-900/20">
      <CardHeader>
        <CardTitle className="text-zinc-300">Teminat Simülatörü</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Yeni Teminat Ekle (USD)</Label>
            <Input type="number" value={addedCollateral || ''} onChange={e => setAddedCollateral(Number(e.target.value))} placeholder="100000" />
          </div>
          <div className="space-y-2">
            <Label>Varsayımsal Ek Zarar (USD)</Label>
            <Input type="number" value={addedLoss || ''} onChange={e => setAddedLoss(Number(e.target.value))} placeholder="+50000 kötüleşme / -20000 iyileşme" />
          </div>
        </div>

        <div className="mt-6 p-4 rounded-md bg-[#0b1120] border border-slate-800 space-y-3">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Simüle Zarar:</span>
            <span className="font-bold text-rose-400">{formatCurrency(totalLoss)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Simüle Mevcut Teminat:</span>
            <span className="font-bold text-emerald-500">{formatCurrency(totalCollateral)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Gerekli Ek Teminat (%35 hedef):</span>
            <span className="font-bold text-rose-500">{newCure > 0 ? formatCurrency(newCure) : '-'}</span>
          </div>
          <div className="flex justify-between border-t border-slate-800 pt-3 mt-3">
            <span className="text-muted-foreground">Zarar / Teminat:</span>
            <span className={`font-bold text-lg ${ratioColor}`}>%{(newRatio * 100).toFixed(1)}</span>
          </div>
        </div>

        <Button variant="outline" className="w-full mt-2" onClick={() => { setAddedCollateral(0); setAddedLoss(0); }}>
          Sıfırla
        </Button>
      </CardContent>
    </Card>
  );
}
