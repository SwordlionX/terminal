"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { addManualTradeAction } from "@/app/customers/[id]/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/number-input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PositionCard } from "@/features/pricing/position-card";
import { ScenarioAnalysis } from "@/features/pricing/scenario-analysis";
import { BarrierOptions } from "@/features/pricing/barrier-options";
import { SmileChart } from "@/features/pricing/smile-chart";
import { usePricingModel, formatCurrency, formatNumber } from "@/features/pricing/use-pricing-model";
import { TrendingUpDown, Shield, AlertTriangle } from "lucide-react";

/** Yahoo spot sembolünün tipini etiketler: =X gerçek spot, -USD token, =F vadeli. */
function spotKind(source: string): { label: string; futures: boolean } {
  if (source.endsWith("=F")) return { label: "Vadeli (futures)", futures: true };
  if (source.endsWith("-USD")) return { label: "Token", futures: false };
  if (source.endsWith("=X")) return { label: "Spot", futures: false };
  return { label: source, futures: false };
}

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

/**
 * ABD borsa seansı (NYSE regular) yaklaşık açık mı — hafta içi 09:30–16:00 ET (DST otomatik).
 * Resmi tatilleri KAPSAMAZ (nadir kenar durum); amaç, seans-dışı manuel "Yenile"de kullanıcıyı
 * uyarmak — çünkü Yahoo seans kapalıyken son KAPANIŞ verisini döndürür (bkz. refreshSnapshot).
 */
function isUsMarketLikelyOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const wd = parts.find(p => p.type === 'weekday')?.value;
  if (wd === 'Sat' || wd === 'Sun') return false;
  const hour = Number(parts.find(p => p.type === 'hour')?.value) % 24;
  const minute = Number(parts.find(p => p.type === 'minute')?.value);
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60; // 09:30–16:00 ET
}

export default function PricingPage() {
  const { md, feed, dateValid, daysToExpiry, tYears, smileIv, effVol, result, gr, autoAvailable, priceable, unpriceableReason, pricingSpot, fwd, usingCmeFwd, cmeCarry } = usePricingModel();
  const spotInfo = feed.spot ? spotKind(feed.spot.source) : null;

  // Kaydetme formu durumu
  const [customers, setCustomers] = useState<{ id: string; companyName: string }[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [bookType, setBookType] = useState<"Call" | "Put">("Call");
  const [bookPosition, setBookPosition] = useState<"Long" | "Short">("Long");
  const [bookMsg, setBookMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [showBarrier, setShowBarrier] = useState(false);

  // Müşteri listesi (kaydetme formu için)
  useEffect(() => {
    fetch('/api/customers').then(r => r.json()).then(setCustomers).catch(() => {});
  }, []);

  const handleBookTrade = async () => {
    if (booking) return; // çift tıklamayı engelle
    if (!customerId) { setBookMsg({ text: "Önce müşteri seçin.", error: true }); return; }
    if (!priceable) { setBookMsg({ text: "Fiyat üretilemiyor (kote opsiyon yok / vol türetilemedi) — işlem kaydedilemez.", error: true }); return; }
    setBooking(true);
    setBookMsg(null);
    try {
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
      setBookMsg({ text: `Kaydedildi: ${bookPosition} ${bookType} ${md.product} @ ${md.strike} (prim ${formatCurrency(premiumPerOz * md.contractSize)})`, error: false });
    } catch (e) {
      setBookMsg({ text: e instanceof Error ? e.message : "İşlem kaydedilemedi.", error: true });
    } finally {
      setBooking(false);
    }
  };

  const handleRefreshChains = () => {
    if (!isUsMarketLikelyOpen()) {
      const ok = window.confirm(
        "ABD opsiyon seansı şu an kapalı görünüyor. Yenilersen son KAPANIŞ verisi çekilir — zaman damgası güncellenir ama fiyatlar seans-canlı değildir. Devam edilsin mi?"
      );
      if (!ok) return;
    }
    feed.refreshChains();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">Fiyatlama</h1>
          {feed.spot && spotInfo && (
            <Badge
              variant="outline"
              className={spotInfo.futures
                ? "border-amber-600 text-amber-500 font-mono"
                : "border-emerald-600 text-emerald-500 font-mono"}
            >
              {spotInfo.label}: {feed.spot.source} ${formatNumber(feed.spot.price, 2)}
            </Badge>
          )}
          {feed.snapshotISO && (
            <Badge variant="outline" className="border-zinc-700 text-zinc-400">
              Zincir: {feed.snapshotISO}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleRefreshChains} disabled={feed.refreshing}>
            {feed.refreshing ? "Yenileniyor..." : "Opsiyon Zincirlerini Yenile"}
          </Button>
        </div>
      </div>

      {feed.error && (
        <div className="text-sm text-amber-500 border border-amber-900/50 bg-amber-950/20 rounded-md px-4 py-2">
          {feed.error}
        </div>
      )}

      {spotInfo?.futures && (
        <div className="flex items-center gap-2 text-sm text-amber-500 border border-amber-900/50 bg-amber-950/20 rounded-md px-4 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Spot kaynağı vadeli (futures {feed.spot?.source}) — carry yüzünden gerçek spottan yüksek olabilir; primler bir miktar sapabilir.
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
                    <Label htmlFor="manualSpot" className="text-xs text-zinc-400 cursor-pointer">Manuel</Label>
                  </div>
                </div>
                <NumberInput
                  value={md.spot}
                  disabled={!md.manualSpot && feed.spot != null}
                  onValueChange={v => md.setField('spot', v)}
                  className={!md.manualSpot && feed.spot != null ? "opacity-80 font-mono" : ""}
                />
              </div>
              <div className="space-y-2">
                <Label>Kullanım (Strike)</Label>
                <NumberInput value={md.strike} onValueChange={v => md.setField('strike', v)} />
              </div>
              <div className="space-y-2">
                <Label>İşlem Tarihi</Label>
                <DateInput value={md.tradeDate} onValueChange={v => md.setField('tradeDate', v)} />
              </div>
              <div className="space-y-2">
                <Label>Vade (Tarih)</Label>
                <DateInput value={md.expiryDate} onValueChange={v => md.setField('expiryDate', v)} />
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
                    <Label htmlFor="manualVol" className="text-xs text-zinc-400 cursor-pointer">Manuel gir</Label>
                  </div>
                </div>
                <NumberInput
                  value={md.manualVol ? md.vol : Number(effVol.toFixed(2))}
                  disabled={!md.manualVol}
                  onValueChange={v => md.setField('vol', v)}
                  className={!md.manualVol ? "opacity-80 font-mono" : ""}
                />
                {!md.manualVol && (
                  <p className={smileIv != null ? "text-[11px] text-zinc-500" : "text-[11px] text-amber-500"}>
                    {smileIv != null
                      ? `Smile'dan otomatik: ${feed.surface?.symbol} yüzeyi, ${daysToExpiry.toFixed(0)} gün, de-Amerikanize IV`
                      : "Bu strike/vade için kote opsiyon yok — fiyat üretilmiyor. Manuel girmek için tiki işaretleyin."}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Kontrat (ons)</Label>
                <NumberInput value={md.contractSize} onValueChange={v => md.setField('contractSize', v)} />
              </div>
              <div className="space-y-2">
                <Label>Faiz Oranı (%)</Label>
                <NumberInput value={md.rate} onValueChange={v => md.setField('rate', v)} />
                {usingCmeFwd && (
                  <p className="text-[11px] text-zinc-500">
                    Faiz yalnız primi iskontoda kullanılır (forward CME futures&apos;tan gelir).
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Kira / Temettü (%)</Label>
                <NumberInput
                  value={md.lease}
                  onValueChange={v => md.setField('lease', v)}
                  className={usingCmeFwd ? "opacity-60 font-mono" : ""}
                />
                {usingCmeFwd ? (
                  <p className="text-[11px] text-amber-500">
                    CME forward&apos;ı aktif — kira prime girmiyor{cmeCarry != null ? ` (piyasa carry'si ≈ %${(cmeCarry * 100).toFixed(1)})` : ""}.
                  </p>
                ) : feed.surface?.symbol === md.product && (
                  <p className="text-[11px] text-zinc-500">
                    Forward spot+kira&apos;dan türetiliyor (bu vade için CME forward yok).
                  </p>
                )}
              </div>
            </div>

            {/* Bariyer aç/kapa — işaretlenince prim kartında bariyer paneli görünür */}
            <div className="flex items-center gap-2 pt-2 border-t border-border/50 mt-2">
              <Checkbox
                id="showBarrier"
                checked={showBarrier}
                onChange={(e) => setShowBarrier(e.target.checked)}
              />
              <Label htmlFor="showBarrier" className="text-sm cursor-pointer">Bariyer Opsiyonu Ekle (Knock-In / Knock-Out)</Label>
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
              {priceable ? (
                <>
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
                  {md.manualVol && !autoAvailable && (
                    <div className="mt-3 text-[11px] text-amber-500 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Manuel vol — bu strike/vade için piyasa (smile) verisi yok.
                    </div>
                  )}
                  <div className="space-y-2 mt-4">
                    <div className="flex justify-between text-sm py-1">
                      <span className="text-muted-foreground">Vade (Gün)</span>
                      <span className="font-mono">{formatNumber(daysToExpiry, 0)} gün</span>
                    </div>
                    <div className="flex justify-between text-sm py-1 border-t">
                      <span className="text-muted-foreground">Kullanılan Vol</span>
                      <span className="font-mono">% {formatNumber(effVol, 2)} {md.manualVol ? "(manuel)" : "(smile)"}</span>
                    </div>
                    {usingCmeFwd && (
                      <div className="flex justify-between text-sm py-1 border-t">
                        <span className="text-muted-foreground">Fiyatlama Forward&apos;ı (CME futures)</span>
                        <span className="font-mono text-amber-500">{formatNumber(fwd, 2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm py-1 border-t">
                      <span className="text-muted-foreground">Kontrat Değeri ({md.contractSize} ons)</span>
                      <span className="font-mono">{formatCurrency(pricingSpot * md.contractSize)}</span>
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
                </>
              ) : feed.loading ? (
                <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/30 flex items-center gap-2.5">
                  <span className="text-sm text-zinc-400 animate-pulse">Piyasa verisi yükleniyor…</span>
                </div>
              ) : (
                <div className="p-4 rounded-lg border border-amber-900/50 bg-amber-950/20 flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" />
                  <div>
                    <div className="font-semibold text-sm text-amber-400">Fiyat üretilmiyor</div>
                    <div className="text-xs mt-1 text-amber-500/90">{unpriceableReason}</div>
                    <div className="text-xs mt-1.5 text-zinc-400">
                      Yine de fiyatlamak için Volatilite alanındaki &quot;Manuel gir&quot; tikini işaretleyip bir değer girebilirsiniz.
                    </div>
                  </div>
                </div>
              )}

              {/* Bariyer Opsiyonu — sol karttaki tik işaretliyken Call/Put priminin altında */}
              {showBarrier && (
                <div className="mt-4 pt-4 border-t border-zinc-800">
                  <BarrierOptions
                    spot={pricingSpot}
                    strike={md.strike}
                    tYears={tYears}
                    rate={md.rate}
                    lease={md.lease}
                    vol={effVol}
                  />
                </div>
              )}

              {/* İşlemi Müşteriye Kaydet — kompakt buton, form Dialog'da */}
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <Button variant="outline" className="w-full" onClick={() => { setBookMsg(null); setBookOpen(true); }}>
                  İşlemi Müşteriye Kaydet
                </Button>
                {bookMsg && !bookOpen && (
                  <p className={`text-xs mt-2 ${bookMsg.error ? "text-rose-500" : "text-emerald-500"}`}>{bookMsg.text}</p>
                )}
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
             {gr && priceable ? (
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
               <div className="text-muted-foreground text-sm">
                 {feed.loading ? "Yükleniyor…" : priceable ? "Hesaplanamıyor" : "Kote opsiyon yok — Greeks üretilmiyor."}
               </div>
             )}
          </CardContent>
        </Card>
      </div>

      {/* Volatilite smile kaynağı — kullanılan vol'ün hangi gözlemlenen noktalardan geldiği */}
      <SmileChart
        surface={feed.surface}
        spot={md.spot}
        strike={md.strike}
        daysToExpiry={daysToExpiry}
      />

      <div className="mt-6">
        <PositionCard
          spot={pricingSpot}
          strike={md.strike}
          callPremium={result.call}
          putPremium={result.put}
          contractSize={md.contractSize}
        />
      </div>

      <ScenarioAnalysis
        spot={pricingSpot}
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
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Detaylı Fiyatlama Araçları</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pricingTools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="flex items-start gap-3 p-4 rounded-lg border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-800/60 hover:border-zinc-700 transition-colors"
            >
              <tool.icon className="w-5 h-5 mt-0.5 text-zinc-300 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-zinc-200">{tool.title}</div>
                <div className="text-xs text-zinc-500 mt-1">{tool.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* İşlemi Müşteriye Kaydet — Dialog (fiyatla → tek tıkla kaydet akışı korunur) */}
      <Dialog open={bookOpen} onOpenChange={setBookOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>İşlemi Müşteriye Kaydet</DialogTitle>
            <DialogDescription>
              Hesaplanan prim ve volatilite ile seçilen müşteriye opsiyon işlemi kaydedilir.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
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
            <Button className="w-full" onClick={handleBookTrade} disabled={!priceable || booking}>
              {booking ? "Kaydediliyor..." : "İşlemi Kaydet (Book Trade)"}
            </Button>
            {!priceable && (
              <p className="text-xs text-amber-500">Fiyat üretilemiyor — önce fiyatlanabilir bir opsiyon seçin (kote opsiyon yok / vol türetilemedi).</p>
            )}
            {bookMsg && (
              <p className={`text-xs ${bookMsg.error ? "text-rose-500" : "text-emerald-500"}`}>{bookMsg.text}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
