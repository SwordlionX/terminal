"use client";

import { useMarketData } from "@/store/marketData";
import { gk, greeks } from "@/lib/math";
import { mockCustomers } from "@/services/mockDb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PositionCard } from "@/features/pricing/position-card";
import { ScenarioAnalysis } from "@/features/pricing/scenario-analysis";
import { ReverseEngineering } from "@/features/pricing/reverse-engineering";
import { BarrierOptions } from "@/features/pricing/barrier-options";
import { HedgePanel } from "@/features/pricing/hedge-panel";

export default function PricingPage() {
  const md = useMarketData();
  
  // Hesaplama (Gün farkı / basis)
  const T = (new Date(md.expiryDate).getTime() - new Date(md.tradeDate).getTime()) / (1000 * 3600 * 24) / md.basis;
  const tYears = Math.max(T, 0.001);
  const result = gk(md.spot, md.strike, tYears, md.rate / 100, md.lease / 100, md.vol / 100);
  const gr = greeks(md.spot, md.strike, tYears, md.rate / 100, md.lease / 100, md.vol / 100, md.basis);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
  const formatNumber = (val: number, dig = 4) => Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: dig, maximumFractionDigits: dig });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Fiyatlama</h1>
        <Button>İşlemi Kaydet (Book Trade)</Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Market Data Girişi */}
        <Card>
          <CardHeader>
            <CardTitle>Piyasa Verileri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Müşteri (Portfolio Link)</Label>
              <Select>
                <SelectTrigger><SelectValue placeholder="Müşteri Seçiniz..." /></SelectTrigger>
                <SelectContent>
                  {mockCustomers.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Ürün (Sembol)</Label>
              <Select value={md.product} onValueChange={(v) => md.setField('product', v || '')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="XAU">XAU/USD (Altın)</SelectItem>
                  <SelectItem value="XAG">XAG/USD (Gümüş)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Spot Fiyat</Label>
                <Input type="number" value={md.spot} onChange={e => md.setField('spot', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-2">
                <Label>Kullanım (Strike)</Label>
                <Input type="number" value={md.strike} onChange={e => md.setField('strike', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-2">
                <Label>İşlem Tarihi</Label>
                <Input type="date" value={md.tradeDate} onChange={e => md.setField('tradeDate', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Vade (Tarih)</Label>
                <Input type="date" value={md.expiryDate} onChange={e => md.setField('expiryDate', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Volatilite (%)</Label>
                <Input type="number" step="0.1" value={md.vol} onChange={e => md.setField('vol', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-2">
                <Label>Kontrat (ons)</Label>
                <Input type="number" value={md.contractSize} onChange={e => md.setField('contractSize', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="col-span-2 flex items-center space-x-2 pt-2 pb-1 border-b border-slate-800/50">
                <Checkbox id="smile" />
                <Label htmlFor="smile" className="text-xs text-slate-400">Volatiliteyi Smile'dan al (her strike kendi vol'ünü kullanır)</Label>
              </div>
              <div className="space-y-2">
                <Label>Faiz Oranı (%)</Label>
                <Input type="number" step="0.1" value={md.rate} onChange={e => md.setField('rate', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-2">
                <Label>Kira / Temettü (%)</Label>
                <Input type="number" step="0.1" value={md.lease} onChange={e => md.setField('lease', parseFloat(e.target.value) || 0)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Fiyatlama Çıktısı */}
        <Card>
          <CardHeader>
            <CardTitle>Prim & Değerleme</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-secondary/50">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Call Primi (ons)</div>
                  <div className="text-2xl font-bold text-emerald-500">${formatNumber(result.call)}</div>
                  <div className="text-xs text-muted-foreground mt-1">% {formatNumber((result.call / md.strike) * 100)}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Put Primi (ons)</div>
                  <div className="text-2xl font-bold text-rose-500">${formatNumber(result.put)}</div>
                  <div className="text-xs text-muted-foreground mt-1">% {formatNumber((result.put / md.strike) * 100)}</div>
                </div>
              </div>
              <div className="space-y-2 mt-4">
                <div className="flex justify-between text-sm py-1">
                  <span className="text-muted-foreground">Vade (Gün)</span>
                  <span className="font-mono">{formatNumber(tYears * md.basis, 0)} gün</span>
                </div>
                <div className="flex justify-between text-sm py-1 border-t">
                  <span className="text-muted-foreground">Kontrat Değeri ({md.contractSize} ons)</span>
                  <span className="font-mono">{formatCurrency(md.spot * md.contractSize)}</span>
                </div>
                <div className="flex justify-between text-sm py-1 border-t">
                  <span className="text-muted-foreground">Toplam Call Primi</span>
                  <span className="font-mono text-emerald-500">{formatCurrency(result.call * md.contractSize)}</span>
                </div>
                <div className="flex justify-between text-sm py-1 border-t">
                  <span className="text-muted-foreground">Toplam Put Primi</span>
                  <span className="font-mono text-rose-500">{formatCurrency(result.put * md.contractSize)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Greeks (Duyarlılıklar) */}
        <Card>
          <CardHeader>
            <CardTitle>Greeks (Call)</CardTitle>
          </CardHeader>
          <CardContent>
             {gr ? (
               <div className="space-y-1 font-mono text-sm">
                 <div className="flex justify-between py-1.5 border-b border-border/50"><span className="text-muted-foreground">Delta</span><span>{formatNumber(gr.call.delta)}</span></div>
                 <div className="flex justify-between py-1.5 border-b border-border/50"><span className="text-muted-foreground">Gamma</span><span>{formatNumber(gr.call.gamma, 6)}</span></div>
                 <div className="flex justify-between py-1.5 border-b border-border/50"><span className="text-muted-foreground">Theta (Günlük)</span><span>{formatNumber(gr.call.theta)}</span></div>
                 <div className="flex justify-between py-1.5 border-b border-border/50"><span className="text-muted-foreground">Vega</span><span>{formatNumber(gr.call.vega)}</span></div>
                 <div className="flex justify-between py-1.5 border-b border-border/50"><span className="text-muted-foreground">Rho</span><span>{formatNumber(gr.call.rho)}</span></div>
                 <div className="flex justify-between py-1.5 border-b border-border/50"><span className="text-muted-foreground">Charm</span><span>{formatNumber(gr.call.charm, 6)}</span></div>
                 <div className="flex justify-between py-1.5 border-b border-border/50"><span className="text-muted-foreground">Vanna</span><span>{formatNumber(gr.call.vanna, 5)}</span></div>
                 <div className="flex justify-between py-1.5"><span className="text-muted-foreground">Vomma</span><span>{formatNumber(gr.call.vomma, 5)}</span></div>
               </div>
             ) : (
               <div className="text-muted-foreground text-sm">Hesaplanamıyor</div>
             )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <PositionCard 
          spot={md.spot}
          strike={md.strike}
          callPremium={result.call}
          putPremium={result.put}
          contractSize={md.contractSize}
        />
      </div>

      <ScenarioAnalysis
        spot={md.spot}
        strike={md.strike}
        tYears={tYears}
        rate={md.rate}
        lease={md.lease}
        vol={md.vol}
        contractSize={md.contractSize}
        callPremium={result.call}
        putPremium={result.put}
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ReverseEngineering 
          spot={md.spot}
          strike={md.strike}
          tYears={tYears}
          rate={md.rate}
          lease={md.lease}
          contractSize={md.contractSize}
        />
        <BarrierOptions 
          spot={md.spot}
          strike={md.strike}
          tYears={tYears}
          rate={md.rate}
          lease={md.lease}
          vol={md.vol}
        />
      </div>

      <HedgePanel 
        spot={md.spot}
        usdTryRate={40.0} // Varsayılan kur, ileride API'den gelir
        deltaExposure={gr ? (gr.call.delta * md.contractSize) : 0} // Örnek olarak Long Call deltası kullanıldı, normalde portföy deltası çekilmeli
      />
    </div>
  );
}
