"use client";

import { useEffect, useState } from "react";
import { useMarketData, useSettings } from "@/store/marketData";
import { MARGIN_MATURITY_BUCKETS, COLLATERAL_HAIRCUT_RATES, RISK_THRESHOLDS } from "@/lib/margin/config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function SettingsPage() {
  const s = useSettings();
  const md = useMarketData();

  // Teminat motorunun (1M TL onay eşiği) kullandığı kalıcı kur — sunucuda kv tablosunda saklanır,
  // bu yüzden tarayıcı ayarlarından (s.usdtry) ayrı yüklenip ayrı kaydedilir.
  const [activeServerRate, setActiveServerRate] = useState<number | null>(null);
  const [savingRate, setSavingRate] = useState(false);
  const [rateMsg, setRateMsg] = useState<{ text: string; error: boolean } | null>(null);

  // Veri kaynağı (Yahoo/CME) durumu — sunucuda kv tablosunda saklanır.
  interface DsItem {
    product: string;
    source: 'yahoo' | 'cme';
    cmeSupported: boolean;
    cmeFetchedISO: string | null;
    cmeExpiries: number;
    yahooSymbol: string | null;
    yahooFetchedISO: string | null;
    yahooExpiries: number;
  }
  const [dsItems, setDsItems] = useState<DsItem[]>([]);
  const [dsBusy, setDsBusy] = useState<string | null>(null); // yenilenen ürün
  const [dsMsg, setDsMsg] = useState<{ text: string; error: boolean } | null>(null);

  const loadDataSources = () =>
    fetch('/api/settings/datasource').then(r => r.json()).then(d => setDsItems(d.items || [])).catch(() => {});

  useEffect(() => {
    fetch('/api/settings/usdtry')
      .then(r => r.json())
      .then(d => setActiveServerRate(d.usdtry))
      .catch(() => {});
    loadDataSources();
  }, []);

  /**
   * Seçili kaynaktan veriyi ÇEKER ve yüzeyi yeniden kurar.
   * - Yahoo: ETF opsiyon zincirleri baştan çekilir; tek istek HEM altını (GLD) HEM gümüşü
   *   (SLV) yeniler — snapshot ortak olduğu için ürün ayrımı yok.
   * - CME: yalnız o ürünün settlement yüzeyi yeniden kurulur.
   * İki kaynak veritabanında ayrı yazılır; biri diğerini ezmez.
   */
  const refreshSource = async (product: string, source: 'yahoo' | 'cme') => {
    setDsBusy(product);
    setDsMsg(null);
    try {
      const url = source === 'cme' ? `/api/market/refresh/cme?product=${product}` : '/api/market/refresh';
      const res = await fetch(url, { method: 'POST' });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || 'Yenileme başarısız');
      await loadDataSources();
      setDsMsg({
        text: source === 'cme'
          ? `${product}: CME'den ${d.expiries} vade çekildi (${d.fetchedISO}).`
          : `Yahoo zincirleri yenilendi (${d.fetchedISO}) — ${Object.entries(d.expiries || {}).map(([k, v]) => `${k}: ${v} vade`).join(', ')}.`,
        error: false,
      });
    } catch (e) {
      setDsMsg({ text: e instanceof Error ? e.message : 'Yenileme başarısız', error: true });
    } finally {
      setDsBusy(null);
    }
  };

  /** Kaynağı değiştirir ve HEMEN o kaynaktan taze veri çekip yüzeyi yeniden kurar. */
  const changeSource = async (product: string, source: 'yahoo' | 'cme') => {
    setDsMsg(null);
    try {
      const res = await fetch('/api/settings/datasource', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product, source }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || 'Kaydedilemedi');
      await loadDataSources();
      await refreshSource(product, source);
    } catch (e) {
      setDsMsg({ text: e instanceof Error ? e.message : 'Kaydedilemedi', error: true });
    }
  };

  const saveUsdTryToServer = async () => {
    setSavingRate(true);
    setRateMsg(null);
    try {
      const res = await fetch('/api/settings/usdtry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usdtry: s.usdtry }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || 'Kaydedilemedi');
      setActiveServerRate(d.usdtry);
      setRateMsg({ text: 'Teminat motoruna kaydedildi.', error: false });
    } catch (e) {
      setRateMsg({ text: e instanceof Error ? e.message : 'Kaydedilemedi', error: true });
    } finally {
      setSavingRate(false);
    }
  };

  const applyToPricing = () => {
    md.setField('rate', s.rate);
    md.setField('lease', md.product === 'XAG' ? s.leaseXAG : s.leaseXAU);
    md.setField('usdtry', s.usdtry);
    md.setField('basis', s.basis);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Ayarlar</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Piyasa Parametreleri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Risksiz Faiz Oranı (%)</Label>
                <Input type="number" step="0.1" value={s.rate} onChange={e => s.setSetting('rate', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-2">
                <Label>USD/TRY Kuru</Label>
                <Input type="number" step="0.01" value={s.usdtry} onChange={e => s.setSetting('usdtry', parseFloat(e.target.value) || 0)} />
                <div className="flex items-center justify-between gap-2 pt-1">
                  <p className="text-[11px] text-zinc-500">
                    Teminat motorunda aktif: {activeServerRate != null ? activeServerRate.toFixed(2) : "…"}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={saveUsdTryToServer} disabled={savingRate} className="h-7 px-2 text-xs">
                    {savingRate ? "Kaydediliyor…" : "Teminat Motoruna Kaydet"}
                  </Button>
                </div>
                {rateMsg && (
                  <p className={`text-[11px] ${rateMsg.error ? "text-rose-500" : "text-emerald-500"}`}>{rateMsg.text}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Altın Kira Oranı (%)</Label>
                <Input type="number" step="0.1" value={s.leaseXAU} onChange={e => s.setSetting('leaseXAU', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-2">
                <Label>Gümüş Kira Oranı (%)</Label>
                <Input type="number" step="0.1" value={s.leaseXAG} onChange={e => s.setSetting('leaseXAG', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-2">
                <Label>Gün Bazı (Basis)</Label>
                <Select value={String(s.basis)} onValueChange={v => s.setSetting('basis', (Number(v) === 360 ? 360 : 365))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="365">365</SelectItem>
                    <SelectItem value="360">360</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={applyToPricing} className="w-full">Fiyatlama Ekranına Uygula</Button>
            <p className="text-[11px] text-zinc-500">
              Ayarlar tarayıcıda saklanır. &quot;Uygula&quot; ile mevcut fiyatlama oturumuna aktarılır.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Risk Eşikleri</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1.5 border-b border-border/50">
                <span className="text-muted-foreground">Teminat Çağrısı (Zarar/Teminat)</span>
                <span className="font-mono">%{RISK_THRESHOLDS.MARGIN_CALL * 100}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border/50">
                <span className="text-muted-foreground">Stop Uyarısı</span>
                <span className="font-mono">%{RISK_THRESHOLDS.STOP_LOSS_WARNING * 100}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border/50">
                <span className="text-muted-foreground">Anında Stop</span>
                <span className="font-mono">%{RISK_THRESHOLDS.STOP_LOSS_IMMEDIATE * 100}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-muted-foreground">Onay Eşiği (Açık Teminat, TL)</span>
                <span className="font-mono">{RISK_THRESHOLDS.DEFICIT_THRESHOLD_TL.toLocaleString('tr-TR')}</span>
              </div>
            </div>
            <p className="text-[11px] text-zinc-500 mt-4">
              Bu eşikler prosedür dokümanından gelir; değiştirilmesi gerekirse kod içinde
              <span className="font-mono"> lib/margin/config.ts</span> güncellenir.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Veri Kaynağı (IV Yüzeyi)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[11px] text-zinc-500">
            Her ürünün oynaklık yüzeyi Yahoo (ETF opsiyonları, canlıya yakın) veya CME COMEX
            (vadeli settlement, günlük) kaynağından üretilir. CME settlement günde bir kez
            (seans kapanışında) oluşur; kurulan yüzey veritabanına yazılır ve site her açılışta
            anında oradan okur — sayfa açılışında vol hesabı beklenmez.
            <span className="text-zinc-400"> Kaynağı değiştirdiğinizde o kaynaktan hemen taze veri
            çekilir ve yüzey baştan kurulur.</span> İki kaynak veritabanında ayrı saklanır; biri
            yenilenince diğeri bozulmaz. Yahoo yenilemesi tek seferde hem altını (GLD) hem
            gümüşü (SLV) tazeler.
          </p>
          <p className="text-[11px] text-zinc-500">
            <span className="text-zinc-400">Günlük yenileme GitHub Actions&apos;ta koşar</span> (hafta içi 21:00 UTC).
            Databento ~3 dakika sürebildiği için Vercel fonksiyon limitine sığmıyor. Aşağıdaki
            &quot;CME&apos;den Yenile&quot; butonu elle tetikleme içindir; canlı ortamda zaman aşımına
            düşerse yenilemeyi GitHub Actions panelinden çalıştırın.
          </p>
          {dsItems.map(item => (
            <div key={item.product} className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3">
              <div className="min-w-[180px]">
                <p className="font-medium text-sm">{item.product === 'XAU' ? 'XAU (Altın)' : item.product === 'XAG' ? 'XAG (Gümüş)' : item.product}</p>
                {/* İki kaynağın durumu da gösterilir; aktif olan vurgulanır. */}
                <p className={`text-[11px] ${item.source === 'cme' ? 'text-emerald-500' : 'text-zinc-600'}`}>
                  CME COMEX: {item.cmeFetchedISO ? `${item.cmeFetchedISO} · ${item.cmeExpiries} vade` : 'veri yok'}
                </p>
                <p className={`text-[11px] ${item.source === 'yahoo' ? 'text-emerald-500' : 'text-zinc-600'}`}>
                  Yahoo {item.yahooSymbol ?? ''}: {item.yahooFetchedISO ? `${item.yahooFetchedISO} · ${item.yahooExpiries} vade` : 'veri yok'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select value={item.source} onValueChange={v => changeSource(item.product, v === 'cme' ? 'cme' : 'yahoo')}>
                  <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yahoo">Yahoo (ETF)</SelectItem>
                    <SelectItem value="cme" disabled={!item.cmeSupported}>CME COMEX</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => refreshSource(item.product, item.source)}
                  disabled={dsBusy === item.product}
                >
                  {dsBusy === item.product
                    ? 'Çekiliyor…'
                    : item.source === 'cme' ? "CME'den Yenile" : "Yahoo'dan Yenile"}
                </Button>
              </div>
            </div>
          ))}
          {dsMsg && (
            <p className={`text-[11px] ${dsMsg.error ? 'text-rose-500' : 'text-emerald-500'}`}>{dsMsg.text}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Teminat Oranları (Vade Dilimlerine Göre)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vade (gün)</TableHead>
                <TableHead className="text-right">Grup 1 (USD, EUR, GBP, CHF, JPY)</TableHead>
                <TableHead className="text-right">Grup 2 (TRY, CNY, RUB, AUD)</TableHead>
                <TableHead className="text-right">Grup 3 (XAU, XAG, XPD, XPT)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MARGIN_MATURITY_BUCKETS.map((b, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono">{b.minDays} – {b.maxDays}</TableCell>
                  <TableCell className="text-right font-mono">%{(b.rates.group1 * 100).toFixed(0)}</TableCell>
                  <TableCell className="text-right font-mono">%{(b.rates.group2 * 100).toFixed(0)}</TableCell>
                  <TableCell className="text-right font-mono">%{(b.rates.group3 * 100).toFixed(0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ek Teminat Haircut Oranları</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Varlık</TableHead>
                <TableHead className="text-right">Haircut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(COLLATERAL_HAIRCUT_RATES).map(([code, rate]) => (
                <TableRow key={code}>
                  <TableCell className="font-mono">{code}</TableCell>
                  <TableCell className="text-right font-mono">%{(rate * 100).toFixed(0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
