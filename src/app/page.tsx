"use client";

import { useEffect, useState } from "react";
import { addManualTradeAction } from "@/app/customers/[id]/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { PositionCard } from "@/features/pricing/position-card";
import { ScenarioAnalysis } from "@/features/pricing/scenario-analysis";
import { BarrierOptions } from "@/features/pricing/barrier-options";
import { usePricingModel, formatCurrency, formatNumber } from "@/features/pricing/use-pricing-model";
import { TrendingUpDown, Shield } from "lucide-react";

const pricingTools = [
  {
    title: "Tersine Mühendislik",
    desc: "Hedef primden zımni volatilite (implied vol) çözümü",
    href: "/pricing/reverse-engineering",
    icon: TrendingUpDown,
  },
  {
    title: "Delta Hedge",
    desc: "Delta nötr pozisyon için hedge büyüklüğü hesaplayıcı",
    href: "/pricing/delta-hedge",
    icon: Shield,
  },
];

export default function PricingPage() {
  const { md, feed, dateValid, daysToExpiry, tYears, smileIv, effVol, result, gr } = usePricingModel();

  // Kaydetme formu durumu
  const [customers, setCustomers] = useState<{ id: string; companyName: string }[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [bookType, setBookType] = useState<"Call" | "Put">("Call");
  const [bookPosition, setBookPosition] = useState<"Long" | "Short">("Long");
  const [bookMsg, setBookMsg] = useState<string>("");
  const [showBarrier, setShowBarrier] = useState(false);

  // Müşteri listesi (kaydetme formu için)
  useEffect(() => {
    fetch('/api/customers').then(r => r.json()).then(setCustomers).catch(() => {});
  }, []);

  const handleBookTrade = async () => {
    if (!customerId) { setBookMsg("Önce müşteri seçin."); return; }
    const premiumPerOz = bookType === "Call" ? result.call : result.put;
    await addManualTradeAction(customerId, {
      tradeDate: md.tradeDate,
      expiryDate: md.expiryDate,
      underlying: md.product,
      type: bookType,
      position: bookPosition,
      spot: md.spot,
      strike: md.strike,
      volatility: effVol / 100,
      contractSize: md.contractSize,
      premium: premiumPerOz * md.contractSize,
    });
    setBookMsg(`Kaydedildi: ${bookPosition} ${bookType} ${md.product} @ ${md.strike} (prim ${formatCurrency(premiumPerOz * md.contractSize)})`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Fiyatlama</h1>
          {feed.spot && (
            <Badge variant="outline" className="border-emerald-600 text-emerald-500 font-mono">
              Canlı: {feed.spot.source} ${formatNumber(feed.spot.price, 2)}
            </Badge>
          )}
          {feed.snapshotISO && (
            <Badge variant="outline" className="border-slate-700 text-slate-400">
              Zincir: {feed.snapshotISO}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={feed.refreshChains} disabled={feed.refreshing}>
            {feed.refreshing ? "Yenileniyor..." : "Opsiyon Zincirlerini Yenile"}
          </Button>
        </div>
      </div>

      {feed.error && (
        <div className="text-sm text-amber-500 border border-amber-900/50 bg-amber-950/20 rounded-md px-4 py-2">
          {feed.error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Market Data Girişi */}
        <Card>
          <CardHeader>
            <CardTitle>Piyasa Verileri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Ürün (Sembol)</Label>
              <Select value={md.product} onValueChange={(v) => md.setField('product', v || 'XAU')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="XAU">XAU/USD (Altın — GLD smile)</SelectItem>
                  <SelectItem value="XAG">XAG/USD (Gümüş — SLV smile)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Spot Fiyat</Label>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="manualSpot"
                      checked={md.manualSpot}
                      onChange={(e) => md.setField('manualSpot', e.target.checked)}
                    />
                    <Label htmlFor="manualSpot" className="text-xs text-slate-400 cursor-pointer">Manuel</Label>
                  </div>
                </div>
                <Input
                  type="number"
                  value={md.spot}
                  disabled={!md.manualSpot && feed.spot != null}
                  onChange={e => md.setField('spot', parseFloat(e.target.value) || 0)}
                  className={!md.manualSpot && feed.spot != null ? "opacity-80 font-mono" : ""}
                />
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
                {!dateValid && (
                  <p className="text-[11px] text-amber-500">Geçersiz tarih — son geçerli vade ({daysToExpiry.toFixed(0)} gün) kullanılıyor</p>
                )}
              </div>
              <div className="space-y-2 col-span-2">
                <div className="flex items-center justify-between">
                  <Label>Volatilite (%)</Label>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="manualVol"
                      checked={md.manualVol}
                      onChange={(e) => md.setField('manualVol', e.target.checked)}
                    />
                    <Label htmlFor="manualVol" className="text-xs text-slate-400 cursor-pointer">Manuel gir</Label>
                  </div>
                </div>
                <Input
                  type="number"
                  step="0.1"
                  value={md.manualVol ? md.vol : Number(effVol.toFixed(2))}
                  disabled={!md.manualVol}
                  onChange={e => md.setField('vol', parseFloat(e.target.value) || 0)}
                  className={!md.manualVol ? "opacity-80 font-mono" : ""}
                />
                {!md.manualVol && (
                  <p className="text-[11px] text-slate-500">
                    {smileIv != null
                      ? `Smile'dan otomatik: ${feed.surface?.symbol} yüzeyi, ${daysToExpiry.toFixed(0)} gün, de-Amerikanize IV`
                      : "Smile verisi yok — son manuel değer kullanılıyor"}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Kontrat (ons)</Label>
                <Input type="number" value={md.contractSize} onChange={e => md.setField('contractSize', parseFloat(e.target.value) || 0)} />
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
                  <span className="font-mono">{formatNumber(daysToExpiry, 0)} gün</span>
                </div>
                <div className="flex justify-between text-sm py-1 border-t">
                  <span className="text-muted-foreground">Kullanılan Vol</span>
                  <span className="font-mono">% {formatNumber(effVol, 2)} {md.manualVol ? "(manuel)" : "(smile)"}</span>
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

              {/* İşlem Kaydetme */}
              <div className="mt-4 p-4 rounded-lg border border-slate-800 space-y-3">
                <div className="text-sm font-semibold text-slate-300">İşlemi Müşteriye Kaydet</div>
                <div className="grid grid-cols-3 gap-2">
                  <Select value={customerId} onValueChange={(v) => setCustomerId(v || "")}>
                    <SelectTrigger><SelectValue placeholder="Müşteri..." /></SelectTrigger>
                    <SelectContent>
                      {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.companyName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={bookPosition} onValueChange={(v) => setBookPosition((v as "Long" | "Short") || "Long")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Long">Long</SelectItem>
                      <SelectItem value="Short">Short</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={bookType} onValueChange={(v) => setBookType((v as "Call" | "Put") || "Call")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Call">Call</SelectItem>
                      <SelectItem value="Put">Put</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full" onClick={handleBookTrade}>İşlemi Kaydet (Book Trade)</Button>
                {bookMsg && <p className="text-xs text-emerald-500">{bookMsg}</p>}
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

      {/* Bariyer Opsiyonu — ayrı bir menü yerine ana fiyatlamanın altında açılıp kapanan opsiyonel bölüm */}
      <div className="flex items-center gap-2 pt-2">
        <Checkbox
          id="showBarrier"
          checked={showBarrier}
          onChange={(e) => setShowBarrier(e.target.checked)}
        />
        <Label htmlFor="showBarrier" className="text-sm cursor-pointer">Bariyer Opsiyonu Ekle (Knock-In / Knock-Out)</Label>
      </div>
      {showBarrier && (
        <BarrierOptions
          spot={md.spot}
          strike={md.strike}
          tYears={tYears}
          rate={md.rate}
          lease={md.lease}
          vol={effVol}
        />
      )}

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
        tYears={Math.max(daysToExpiry / md.basis, 0.001)}
        rate={md.rate}
        lease={md.lease}
        vol={effVol}
        contractSize={md.contractSize}
        callPremium={result.call}
        putPremium={result.put}
      />

      {/* Detaylı Fiyatlama Araçları — Bariyer, Tersine Mühendislik, Delta Hedge kendi alt sayfalarına taşındı */}
      <div>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Detaylı Fiyatlama Araçları</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pricingTools.map((tool) => (
            <a
              key={tool.href}
              href={tool.href}
              className="flex items-start gap-3 p-4 rounded-lg border border-slate-800 bg-slate-900/30 hover:bg-slate-800/60 hover:border-slate-700 transition-colors"
            >
              <tool.icon className="w-5 h-5 mt-0.5 text-zinc-300 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-slate-200">{tool.title}</div>
                <div className="text-xs text-slate-500 mt-1">{tool.desc}</div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
