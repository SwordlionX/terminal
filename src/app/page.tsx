"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addManualTradeAction } from "@/app/customers/[id]/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/number-input";
import { FeedStatus } from "@/features/pricing/feed-status";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PositionCard } from "@/features/pricing/position-card";
import { ScenarioAnalysis } from "@/features/pricing/scenario-analysis";
import { BarrierInputs, BarrierResult, useBarrierPricing } from "@/features/pricing/barrier-options";
import { SmileChart } from "@/features/pricing/smile-chart";
import { usePricingModel, formatCurrency, formatNumber } from "@/features/pricing/use-pricing-model";
import { InfoHint } from "@/components/ui/info-hint";
import { GREEK_INFO, BREAKEVEN_INFO } from "@/lib/greeks-info";
import type { GreeksResult } from "@/lib/math/greeks";
import { TrendingUpDown, Shield, AlertTriangle } from "lucide-react";

/**
 * Greeks tablosunun satırları. `same: true` olanlar put-call paritesi gereği call ve put'ta
 * BİREBİR aynıdır (gamma, vega ve onların vol türevleri) — iki kez yazmak yerine "=" konur.
 */
const GREEK_ROWS: { key: keyof GreeksResult; label: string; digits: number; same?: boolean }[] = [
  { key: 'delta', label: 'Delta', digits: 4 },
  { key: 'gamma', label: 'Gamma', digits: 6, same: true },
  { key: 'theta', label: 'Theta (Günlük)', digits: 4 },
  { key: 'vega', label: 'Vega', digits: 4, same: true },
  { key: 'rho', label: 'Rho', digits: 4 },
  { key: 'charm', label: 'Charm', digits: 6 },
  { key: 'vanna', label: 'Vanna', digits: 5, same: true },
  { key: 'vomma', label: 'Vomma', digits: 5, same: true },
];

/**
 * Spot kaynağını rozete böler: etiket (kaynağın CİNSİ) + sembol.
 *
 * İki biçim var:
 *  - Sağlayıcılı gerçek spot: "XAU/USD (Twelve Data)" → etiket sağlayıcı adı, sembol XAU/USD.
 *  - Yahoo sembolü: =X gerçek spot, -USD token, =F vadeli.
 * Sağlayıcı biçimi eklendiğinde bu ayrıştırma yoktu; hiçbir son eke uymadığı için etiket
 * ham kaynağın kendisi oluyordu ve rozet "XAU/USD (Twelve Data): XAU/USD (Twelve Data) $…"
 * diye iki kez yazıyordu.
 */
function spotKind(source: string): { label: string; symbol: string; futures: boolean } {
  const provider = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(source);
  if (provider) return { label: provider[2], symbol: provider[1], futures: false };
  if (source.endsWith("=F")) return { label: "Vadeli (futures)", symbol: source, futures: true };
  if (source.endsWith("-USD")) return { label: "Token", symbol: source, futures: false };
  if (source.endsWith("=X")) return { label: "Spot", symbol: source, futures: false };
  return { label: source, symbol: source, futures: false };
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
  const { md, feed, dateValid, daysToExpiry, tYears, smileIv, smileEstimate, effVol, result, gr, autoAvailable, priceable, unpriceableReason, pricingSpot, fwd, usingCmeFwd, volAtLevel, volModeAtLevel, barrierSpot, barrierLease, surfaceSourceLabel } = usePricingModel();
  const spotInfo = feed.spot ? spotKind(feed.spot.source) : null;
  const volModeLabel = md.manualVol ? "Manuel varsayım" : ({ observed: "Gözlemlenen IV", interpolated: "Ara değer", model: "SSVI modeli", extrapolated: "SSVI uzatma", unavailable: "Veri yok" }[smileEstimate.mode]);

  // Kaydetme formu durumu
  const [customers, setCustomers] = useState<{ id: string; companyName: string }[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
  const [bookType, setBookType] = useState<"Call" | "Put">("Call");
  const [bookPosition, setBookPosition] = useState<"Long" | "Short">("Long");
  const [bookMsg, setBookMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [showBarrier, setShowBarrier] = useState(false);

  // Bariyer durumu BURADA tutulur: girdi paneli sol kartta, prim sağ kartta duruyor.
  const barrier = useBarrierPricing({
    spot: barrierSpot,
    strike: md.strike,
    tYears,
    rate: md.rate,
    lease: barrierLease,
    vol: effVol,
    volAtLevel,
    volModeAtLevel,
  });

  // Müşteri listesi (kaydetme formu için)
  useEffect(() => {
    fetch('/api/customers').then(async r => {
      if (!r.ok) return;
      const data: unknown = await r.json();
      if (Array.isArray(data)) setCustomers(data.filter((c): c is { id: string; companyName: string } =>
        c != null && typeof c.id === 'string' && typeof c.companyName === 'string'));
    }).catch(() => {});
  }, []);

  // Seçili müşterinin ADININ kutuda görünmesi için değer->etiket eşlemesi. Bu olmadan
  // Base UI seçimden sonra ham id'yi ("c-22384484") yazıyordu.
  const customerItems = useMemo(
    () => Object.fromEntries(customers.map(c => [c.id, c.companyName])),
    [customers],
  );

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
    if (feed.surfaceSource === "yahoo" && !isUsMarketLikelyOpen()) {
      const ok = window.confirm(
        "ABD opsiyon seansı şu an kapalı görünüyor. Yenilersen son KAPANIŞ verisi çekilir — zaman damgası güncellenir ama fiyatlar seans-canlı değildir. Devam edilsin mi?"
      );
      if (!ok) return;
    }
    feed.refreshChains();
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-400">Opsiyon çalışma alanı</p>
          <h1 className="text-3xl font-semibold tracking-tight">Fiyatlama</h1>
          <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{md.product === "XAU" ? "Altın · XAU/USD" : "Gümüş · XAG/USD"}</Badge>
          <span className="text-xs text-muted-foreground">{dateValid ? `${formatNumber(daysToExpiry, 0)} gün` : "Vade geçersiz"} · {formatNumber(md.contractSize, 0)} ons</span>
          {feed.spot && spotInfo && (
            <Badge
              variant="outline"
              className={spotInfo.futures
                ? "border-amber-600 text-amber-500 font-mono"
                : "border-emerald-600 text-emerald-500 font-mono"}
            >
              {spotInfo.label}: {spotInfo.symbol} ${formatNumber(feed.spot.price, 2)}
            </Badge>
          )}
          {feed.snapshotISO && (
            <Badge variant="outline" className="border-zinc-700 text-zinc-400">
              Zincir: {feed.snapshotISO}
            </Badge>
          )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleRefreshChains} disabled={feed.refreshing}>
            {feed.refreshing ? "Yenileniyor..." : "Opsiyon Zincirlerini Yenile"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Fiyatlama spotu", value: Number.isFinite(pricingSpot) && pricingSpot > 0 ? `$${formatNumber(pricingSpot, 2)}` : "—", detail: md.manualSpot ? "Manuel spot" : spotInfo?.label ?? "Başlangıç girdisi · veri bekleniyor" },
          { label: "Hesaplanan forward", value: dateValid && Number.isFinite(fwd) && fwd > 0 ? `$${formatNumber(fwd, 2)}` : "—", detail: `Spot + carry · ACT/${md.basis}` },
          { label: "Kullanılan volatilite", value: priceable ? `%${formatNumber(effVol, 2)}` : "—", detail: volModeLabel },
          { label: "Volatilite kaynağı", value: feed.surface ? (feed.surfaceSource === "cme" ? "CME COMEX" : "Yahoo / ETF") : "Veri bekleniyor", detail: feed.surface?.fetchedISO ?? "Henüz yüzey alınmadı" },
        ].map(item => (
          <div key={item.label} className="min-w-0 rounded-xl border border-border bg-card/80 px-4 py-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{item.label}</p>
            <p className="mt-2 truncate font-mono text-lg font-semibold sm:text-xl">{item.value}</p>
            <p className="mt-1 break-words text-[11px] text-muted-foreground">{item.detail}</p>
          </div>
        ))}
      </div>

      <FeedStatus feed={feed} />

      {spotInfo?.futures && (
        <div className="flex items-center gap-2 text-sm text-amber-500 border border-amber-900/50 bg-amber-950/20 rounded-md px-4 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Spot kaynağı vadeli (futures {feed.spot?.source}) — carry yüzünden gerçek spottan yüksek olabilir; primler bir miktar sapabilir.
        </div>
      )}

      <div className="pricing-workspace grid grid-cols-1 items-start gap-5">
        {/* Market Data Girişi */}
        <Card>
          <CardHeader>
            <CardTitle>İşlem girdileri</CardTitle>
            <p className="text-xs text-muted-foreground">Ürün, vade ve fiyatlama varsayımları</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Ürün (Sembol)</Label>
              {/* `items` OLMADAN Base UI'ın Select.Value'su seçeneğin ETİKETİNİ değil ham
                  DEĞERİNİ basar; kutu "XAU/USD (Altın)" yerine "XAU" gösteriyordu. Yalnız
                  görüntüyle ilgili — fiyatlama her zaman value'yu (md.product) kullanır. */}
              <Select
                value={md.product}
                items={{ XAU: 'XAU/USD (Altın)', XAG: 'XAG/USD (Gümüş)' }}
                onValueChange={(v) => md.setField('product', v || 'XAU')}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* Yüzeyin kaynağı burada YAZILMAZ (eskiden "GLD smile" / "SLV smile" yazıyordu):
                      kaynak artık Ayarlar'dan seçiliyor ve varsayılan CME. Aktif kaynak, altta
                      smile kartının başlığında gerçek haliyle gösteriliyor. */}
                  <SelectItem value="XAU">XAU/USD (Altın)</SelectItem>
                  <SelectItem value="XAG">XAG/USD (Gümüş)</SelectItem>
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
                  <p className="text-[11px] text-amber-500">Geçerli işlem tarihi ve ileri bir vade seçin — fiyat üretilmiyor.</p>
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
                      ? `${volModeLabel}: ${feed.surface?.symbol} yüzeyi · ${daysToExpiry.toFixed(0)} gün`
                      : smileEstimate.reason ?? "Bu strike/vade için güvenilir IV yok. Manuel bir varsayım girebilirsiniz."}
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
                {feed.rateNote && (
                  <p className="text-[11px] text-amber-500">{feed.rateNote}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Kira / Temettü (%)</Label>
                <NumberInput
                  value={md.lease}
                  onValueChange={v => md.setField('lease', v)}
                  className={usingCmeFwd ? "opacity-60 font-mono" : ""}
                />
                {md.manualSpot ? (
                  <p className="text-[11px] text-zinc-500">
                    Manuel spot girili — forward girdiğiniz spot + kira&apos;dan türetiliyor.
                  </p>
                ) : feed.surface?.impliedLeaseRate != null ? (
                  <p className="text-[11px] text-zinc-500">
                    Kira oranı piyasa (CME) vadelilerinden çekildi. Forward canlı spot ile türetiliyor.
                  </p>
                ) : (
                  <p className="text-[11px] text-zinc-500">
                    Forward fiyatı canlı spot + kira&apos;dan türetiliyor.
                  </p>
                )}
              </div>
            </div>

            {/* Bariyer aç/kapa — işaretlenince GİRDİ paneli hemen altta, PRİM ise
                sağdaki "Prim & Değerleme" kartında vanilya priminin ardında görünür. */}
            <div className="flex items-center gap-2 pt-2 border-t border-border/50 mt-2">
              <Checkbox
                id="showBarrier"
                checked={showBarrier}
                onChange={(e) => setShowBarrier(e.target.checked)}
              />
              <Label htmlFor="showBarrier" className="text-sm cursor-pointer">Bariyer Opsiyonu Ekle (Knock-In / Knock-Out)</Label>
            </div>

            {showBarrier && (
              <div className="pt-3 border-t border-border/50">
                <BarrierInputs state={barrier} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fiyatlama Çıktısı */}
        <Card>
          <CardHeader>
            <CardTitle>Model primi & değerleme</CardTitle>
            <p className="text-xs text-muted-foreground">Avrupa tipi · hesaplanan prim, işlem yapılabilir piyasa kotasyonu değildir.</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {priceable ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="min-w-0 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
                      <div className="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-3">Call · USD / ons</div>
                      <div className="break-all font-mono text-3xl font-semibold tracking-tight text-emerald-400">${formatNumber(result.call)}</div>
                      <div className="text-xs text-muted-foreground mt-3">Strike&apos;ın %{formatNumber((result.call / md.strike) * 100, 2)}&apos;i</div>
                    </div>
                    <div className="min-w-0 rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
                      <div className="text-xs font-semibold uppercase tracking-wider text-rose-400 mb-3">Put · USD / ons</div>
                      <div className="break-all font-mono text-3xl font-semibold tracking-tight text-rose-400">${formatNumber(result.put)}</div>
                      <div className="text-xs text-muted-foreground mt-3">Strike&apos;ın %{formatNumber((result.put / md.strike) * 100, 2)}&apos;i</div>
                    </div>
                  </div>
                  {!md.manualVol && smileEstimate.mode === "extrapolated" && (
                    <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-400">Bu strike gözlemlenen aralığın dışında. Prim, kalite kontrolünden geçen SSVI uzatmasına dayanıyor; piyasa kotasyonu değildir.</p>
                  )}
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
                    {/* Başabaş — vade sonunda net K/Z'nin sıfır olduğu spot. Call'da strike +
                        prim, put'ta strike − prim. Alış/satışta seviye aynı, kâr tarafı değişir. */}
                    <div className="flex justify-between text-sm py-1 border-t">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        Başabaş (Call / Put)
                        <InfoHint label="Başabaş nedir" text={BREAKEVEN_INFO} />
                      </span>
                      <span className="font-mono">
                        <span className="text-emerald-500">{formatNumber(md.strike + result.call, 2)}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-rose-500">{formatNumber(md.strike - result.put, 2)}</span>
                      </span>
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
                    {dateValid && md.contractSize > 0 && !md.manualVol && (
                      <div className="text-xs mt-1.5 text-zinc-400">
                        Piyasa IV&apos;si yoksa Volatilite alanındaki &quot;Manuel gir&quot; seçeneğiyle kendi varsayımınızı kullanabilirsiniz. Geçersiz girdiler önce düzeltilmelidir.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Bariyer primi — girdiler sol karttaki panelde, sonuç burada vanilya
                  priminin hemen ardında (aynı dil: ons + yüzde + toplam + vanilya farkı). */}
              {priceable && showBarrier && barrier.calcResult && (
                <div className="mt-4 pt-4 border-t border-zinc-800">
                  <BarrierResult state={barrier} contractSize={md.contractSize} detailed />
                </div>
              )}

              {/* İşlemi Müşteriye Kaydet — kompakt buton, form Dialog'da */}
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <Button className="w-full" disabled={!priceable} onClick={() => { setBookMsg(null); setBookOpen(true); }}>
                  İşlemi Müşteriye Kaydet
                </Button>
                {bookMsg && !bookOpen && (
                  <p className={`text-xs mt-2 ${bookMsg.error ? "text-rose-500" : "text-emerald-500"}`}>{bookMsg.text}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Greeks (Duyarlılıklar) — Call VE Put birlikte.
            Eskiden yalnız call gösteriliyordu; oysa masanın yazdığı işlemlerin çoğu put ve
            greeks() zaten iki tarafı da hesaplıyordu. Delta/theta/charm/rho iki tarafta
            FARKLIDIR; gamma/vega/vanna/vomma put-call paritesi gereği aynıdır. */}
        <Card className="pricing-greeks">
          <CardHeader>
            <CardTitle>Greeks</CardTitle>
          </CardHeader>
          <CardContent>
             {gr && priceable ? (
               <div className="text-sm">
                 <div className="flex items-center justify-between pb-1.5 text-xs uppercase tracking-wider text-zinc-500">
                   <span>Duyarlılık</span>
                   <span className="flex gap-4">
                     <span className="w-20 text-right text-emerald-600/80">Call</span>
                     <span className="w-20 text-right text-rose-600/80">Put</span>
                   </span>
                 </div>
                 {GREEK_ROWS.map(({ key, label, digits, same }) => (
                   <div key={key} className="flex items-center justify-between py-1.5 border-t border-border/50">
                     <span className="flex items-center gap-1.5 text-muted-foreground">
                       {label}
                       <InfoHint label={`${GREEK_INFO[key].title} nedir`} text={GREEK_INFO[key].text} />
                     </span>
                     <span className="flex gap-4 font-mono">
                       <span className="w-20 text-right">{formatNumber(gr.call[key], digits)}</span>
                       <span className={`w-20 text-right ${same ? 'text-zinc-500' : ''}`}>
                         {same ? '=' : formatNumber(gr.put[key], digits)}
                       </span>
                     </span>
                   </div>
                 ))}
                 <p className="text-[11px] text-zinc-500 mt-3">
                   &quot;=&quot; işaretli satırlar put-call paritesi gereği iki tarafta aynıdır.
                 </p>
               </div>
                     ) : (
               <div className="text-muted-foreground text-sm">
                 {feed.loading ? "Yükleniyor…" : priceable ? "Hesaplanamıyor" : "Fiyatlama geçerli değil — Greeks üretilmiyor."}
               </div>
             )}
          </CardContent>
        </Card>
      </div>

      {/* Volatilite smile kaynağı — kullanılan vol'ün hangi gözlemlenen noktalardan geldiği */}
      <SmileChart
        surface={feed.surface}
        fwd={fwd}
        strike={md.strike}
        daysToExpiry={daysToExpiry}
        sourceLabel={surfaceSourceLabel}
        valuationDate={md.tradeDate}
        manualVol={md.manualVol}
        effectiveVol={priceable ? effVol : undefined}
      />

      {priceable && <>
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
        tYears={tYears}
        rate={md.rate}
        lease={md.lease}
        vol={effVol}
        contractSize={md.contractSize}
        callPremium={result.call}
        putPremium={result.put}
      />
      </>}

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
              <Select value={customerId} items={customerItems} onValueChange={(v) => setCustomerId(v || "")}>
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
