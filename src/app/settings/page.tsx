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

  useEffect(() => {
    fetch('/api/settings/usdtry')
      .then(r => r.json())
      .then(d => setActiveServerRate(d.usdtry))
      .catch(() => {});
  }, []);

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
