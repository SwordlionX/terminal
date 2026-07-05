"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface MarginSimulationProps {
  initialMargin: number;
  initialCollateral: number;
}

export function MarginSimulation({ initialMargin, initialCollateral }: MarginSimulationProps) {
  const [addedCollateral, setAddedCollateral] = useState<number>(0);
  const [haircut, setHaircut] = useState<number>(0);
  const [addedRisk, setAddedRisk] = useState<number>(0);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  const effectiveNewCollateral = addedCollateral * (1 - haircut);
  const totalCollateral = initialCollateral + effectiveNewCollateral;
  const totalMargin = initialMargin + addedRisk;
  
  const newCoverage = totalMargin > 0 ? (totalCollateral / totalMargin) : (totalCollateral > 0 ? 1 : 0);
  const newMissing = Math.max(0, totalMargin - totalCollateral);

  return (
    <Card className="border-indigo-900/60 shadow-lg shadow-indigo-900/20 bg-indigo-950/5">
      <CardHeader>
        <CardTitle className="text-indigo-400">Margin Simulator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Yeni Teminat Ekle (USD Karşılığı)</Label>
            <Input type="number" value={addedCollateral || ''} onChange={e => setAddedCollateral(Number(e.target.value))} placeholder="100000" />
          </div>
          <div className="space-y-2">
            <Label>Uygulanacak Haircut (%)</Label>
            <Select onValueChange={v => setHaircut(Number(v))}>
              <SelectTrigger><SelectValue placeholder="%0 (Nakit)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">%0 (Nakit TRY/USD/EUR)</SelectItem>
                <SelectItem value="0.05">%5 (PPF Fon)</SelectItem>
                <SelectItem value="0.10">%10 (DİBS/Tahvil)</SelectItem>
                <SelectItem value="0.15">%15 (DOL Fon)</SelectItem>
                <SelectItem value="0.25">%25 (Diğer Fonlar)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="space-y-2">
          <Label>Varsayımsal Pozisyon Riski (Required Margin Değişimi)</Label>
          <Input type="number" value={addedRisk || ''} onChange={e => setAddedRisk(Number(e.target.value))} placeholder="+50000 (Yeni İşlem) veya -20000 (Kapanış)" />
        </div>

        <div className="mt-6 p-4 rounded-md bg-[#0b1120] border border-slate-800 space-y-3">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Simüle Edilmiş Required Margin:</span>
            <span className="font-bold">{formatCurrency(totalMargin)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Simüle Edilmiş Available Collateral:</span>
            <span className="font-bold text-emerald-500">{formatCurrency(totalCollateral)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Simüle Edilmiş Missing Margin:</span>
            <span className="font-bold text-rose-500">{formatCurrency(newMissing)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-800 pt-3 mt-3">
            <span className="text-muted-foreground">Yeni Coverage Ratio:</span>
            <span className="font-bold text-lg">{(newCoverage * 100).toFixed(1)}%</span>
          </div>
        </div>
        
        <Button variant="outline" className="w-full mt-2" onClick={() => { setAddedCollateral(0); setHaircut(0); setAddedRisk(0); }}>
          Sıfırla
        </Button>
      </CardContent>
    </Card>
  );
}
