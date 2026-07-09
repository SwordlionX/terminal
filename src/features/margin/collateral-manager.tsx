"use client";

import { useState } from "react";
import { CollateralItem } from "@/types/collateral";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus } from "lucide-react";
import { COLLATERAL_HAIRCUT_RATES } from "@/lib/margin/config";
import { addCustomerCollateral, removeCustomerCollateral } from "@/app/customers/[id]/margin/collateral-actions";

interface CollateralManagerProps {
  customerId: string;
  collaterals: CollateralItem[];
}

export function CollateralManager({ customerId, collaterals }: CollateralManagerProps) {
  const [assetCode, setAssetCode] = useState("Nakit-USD");
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
  const formatPercent = (val: number) => new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(val);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const nominal = Number(amount);
    if (!nominal || nominal <= 0) return;

    setIsSubmitting(true);
    try {
      const haircut = COLLATERAL_HAIRCUT_RATES[assetCode] ?? 0;
      let currency = 'USD';
      if (assetCode.includes('-TRY') || assetCode === 'DİBS-EB-SUKUK' || assetCode === 'Bono-EB-Repo') currency = 'TRY';
      if (assetCode.includes('-EUR')) currency = 'EUR';
      if (assetCode.includes('-XAU')) currency = 'XAU';
      if (assetCode.includes('-XAG')) currency = 'XAG';

      const marketValueUsd = nominal * (1 - haircut);

      await addCustomerCollateral(customerId, {
        assetCode,
        currency,
        nominalQuantity: nominal,
        marketValueUsd,
        haircut,
      });

      setAmount("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Bu teminatı silmek istediğinize emin misiniz?")) {
      await removeCustomerCollateral(customerId, id);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mevcut Teminat Varlıkları</CardTitle>
        <CardDescription>Müşterinin portföyünde bulunan anlık teminatlar ve kesinti oranları (Haircut).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-md border border-slate-800">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead>Varlık Türü</TableHead>
                <TableHead>Döviz</TableHead>
                <TableHead className="text-right">Brüt Tutar</TableHead>
                <TableHead className="text-right">Kesinti (%)</TableHead>
                <TableHead className="text-right">Geçerli Teminat Değeri</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collaterals.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                    Henüz teminat eklenmemiş. Aşağıdaki formu kullanarak ekleyebilirsiniz.
                  </TableCell>
                </TableRow>
              ) : (
                collaterals.map(c => {
                  const hc = c.haircut ?? 0;
                  return (
                    <TableRow key={c.id} className="border-slate-800">
                      <TableCell className="font-medium text-slate-200">{c.assetCode}</TableCell>
                      <TableCell className="text-slate-400">{c.currency}</TableCell>
                      <TableCell className="text-right font-mono text-slate-300">{formatCurrency(c.nominalQuantity)}</TableCell>
                      <TableCell className="text-right font-mono text-rose-400">{formatPercent(hc)}</TableCell>
                      <TableCell className="text-right font-mono text-emerald-400 font-bold">{formatCurrency(c.marketValueUsd)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="text-slate-500 hover:text-rose-400 hover:bg-rose-400/10" onClick={() => handleDelete(c.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <div className="pt-4 border-t border-slate-800">
          <h3 className="text-sm font-medium mb-3 flex items-center text-slate-300"><Plus className="h-4 w-4 mr-1"/> Yeni Teminat Ekle</h3>
          <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="space-y-1.5 flex-1">
              <Label htmlFor="assetCode" className="text-xs text-slate-400">Varlık Türü</Label>
              <Select value={assetCode} onValueChange={(val) => setAssetCode(val || "")}>
                <SelectTrigger id="assetCode" className="bg-slate-950 border-slate-800 text-sm">
                  <SelectValue placeholder="Varlık seçin" />
                </SelectTrigger>
                <SelectContent className="border-slate-800 bg-slate-950">
                  {Object.entries(COLLATERAL_HAIRCUT_RATES).map(([code, rate]) => (
                    <SelectItem key={code} value={code}>
                      <span className="flex justify-between w-full pr-4">
                        <span>{code}</span>
                        <span className="text-slate-500 ml-4">Kesinti: {formatPercent(rate)}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1.5 flex-1">
              <Label htmlFor="amount" className="text-xs text-slate-400">Brüt Tutar (USD Karşılığı)</Label>
              <Input 
                id="amount" 
                type="number" 
                step="any" 
                min="0"
                value={amount} 
                onChange={(e) => setAmount(e.target.value)} 
                placeholder="Örn: 10000"
                className="bg-slate-950 border-slate-800 font-mono text-sm"
                required
              />
            </div>

            <Button type="submit" disabled={isSubmitting} className="bg-emerald-600/20 text-emerald-400 border border-emerald-600/50 hover:bg-emerald-600/30 w-full sm:w-auto transition-colors">
              {isSubmitting ? "Ekleniyor..." : "Teminat Ekle"}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
