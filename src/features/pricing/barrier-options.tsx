"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { barrierPrice, barrierGreeks } from "@/lib/math";
import { vannaVolgaBarrier } from "@/lib/math/vanna-volga";

interface BarrierOptionsProps {
  spot: number;
  strike: number;
  tYears: number;
  rate: number;
  lease: number;
  vol: number;
  /** Verilen fiyat seviyesinin smile vol'ü (%). Yoksa/aralık dışıysa null. */
  volAtLevel?: (level: number) => number | null;
}

interface BarrierGreekResult {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

interface CalcResult {
  price: number;
  greeks: BarrierGreekResult;
  nearBarrier: boolean;
  knockedOut: boolean;
  /** Vanna-Volga uygulandıysa detayları; smile yoksa null (düz BS'e düşülür). */
  vv: { bsPrice: number; correction: number; survival: number; atmVol: number } | null;
}

export function BarrierOptions({
  spot, strike, tYears, rate, lease, vol, volAtLevel
}: BarrierOptionsProps) {
  const [barrierH, setBarrierH] = useState<number>(spot * 1.1);
  const [rebateR, setRebateR] = useState<number>(0);
  const [barrierType, setBarrierType] = useState<string>("cuo");
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0);

  const calculate = () => {
    const r = rate / 100, q = lease / 100;
    // Smile fonksiyonu (ondalık vol). Yoksa Vanna-Volga kurulamaz → düz BS'e düşülür.
    const smile = volAtLevel
      ? (k: number): number | null => { const v = volAtLevel(k); return v != null && isFinite(v) ? v / 100 : null; }
      : null;

    /**
     * Fiyat: Vanna-Volga varsa onunla (piyasa standardı smile düzeltmesi), yoksa tek-vol BS.
     * `shift` paralel vol kaydırmasıdır — vega'yı sonlu farkla almak için kullanılır.
     */
    const priceAt = (s: number, shift: number): number => {
      if (smile) {
        const sm = (k: number) => { const v = smile(k); return v == null ? null : v + shift; };
        const res = vannaVolgaBarrier(s, strike, barrierH, rebateR, tYears, r, q, barrierType, sm);
        if (res) return res.price;
      }
      return barrierPrice(s, strike, barrierH, rebateR, tYears, r, q, vol / 100 + shift, barrierType);
    };

    const vvRes = smile ? vannaVolgaBarrier(spot, strike, barrierH, rebateR, tYears, r, q, barrierType, smile) : null;
    const price = vvRes ? vvRes.price : barrierPrice(spot, strike, barrierH, rebateR, tYears, r, q, vol / 100, barrierType);

    // Greek'ler: VV varsa VV fiyatının kendisinden sonlu farkla (fiyatla tutarlı olsun),
    // yoksa mevcut BS tabanlı hesaplayıcı.
    let greeks: BarrierGreekResult;
    if (vvRes) {
      const hS = spot * 0.002, dv = 0.005, dt = 1 / 365;
      const pu = priceAt(spot + hS, 0), pd = priceAt(spot - hS, 0);
      const pT = (() => {
        const sm = smile as (k: number) => number | null;
        const res = vannaVolgaBarrier(spot, strike, barrierH, rebateR, Math.max(tYears - dt, 1e-8), r, q, barrierType, sm);
        return res ? res.price : price;
      })();
      greeks = {
        delta: (pu - pd) / (2 * hS),
        gamma: (pu - 2 * price + pd) / (hS * hS),
        vega: (priceAt(spot, dv) - priceAt(spot, -dv)) / (2 * dv) / 100,
        theta: pT - price,
      };
    } else {
      greeks = barrierGreeks(spot, strike, barrierH, rebateR, tYears, r, q, vol / 100, barrierType, 365);
    }

    const isUp = barrierType[1] === "u";
    const isOut = barrierType[2] === "o";
    // Greek'ler sonlu farkla; bariyer süreksizliğine yakın (~%3) Delta/Gamma güvenilmez
    const nearBarrier = spot > 0 && Math.abs(spot - barrierH) / spot < 0.03;
    // KO opsiyonu bariyeri zaten geçtiyse devre dışı — prim yalnızca rebate
    const knockedOut = isOut && ((isUp && spot >= barrierH) || (!isUp && spot <= barrierH));

    setCalcResult({
      price, greeks, nearBarrier, knockedOut,
      vv: vvRes ? { bsPrice: vvRes.bsPrice, correction: vvRes.correction, survival: vvRes.survival, atmVol: vvRes.atmVol } : null,
    });
  };

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-zinc-300">Bariyer Opsiyonu (Knock-In / Knock-Out)</div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-zinc-400 text-xs uppercase tracking-wider">Bariyer Tipi</Label>
          <Select value={barrierType} onValueChange={(v) => setBarrierType(v || "cuo")}>
            <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cuo">Call Up & Out (cuo)</SelectItem>
              <SelectItem value="cdo">Call Down & Out (cdo)</SelectItem>
              <SelectItem value="cui">Call Up & In (cui)</SelectItem>
              <SelectItem value="cdi">Call Down & In (cdi)</SelectItem>
              <SelectItem value="puo">Put Up & Out (puo)</SelectItem>
              <SelectItem value="pdo">Put Down & Out (pdo)</SelectItem>
              <SelectItem value="pui">Put Up & In (pui)</SelectItem>
              <SelectItem value="pdi">Put Down & In (pdi)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-zinc-400 text-xs uppercase tracking-wider">Bariyer (H)</Label>
            <Input
              type="number"
              value={barrierH || ''}
              onChange={e => setBarrierH(Number(e.target.value))}
              className="bg-zinc-900 border-zinc-700 font-mono text-zinc-200"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-zinc-400 text-xs uppercase tracking-wider">Rebate (R)</Label>
            <Input
              type="number"
              value={rebateR || ''}
              onChange={e => setRebateR(Number(e.target.value))}
              className="bg-zinc-900 border-zinc-700 font-mono text-zinc-200"
            />
          </div>
        </div>
        <Button onClick={calculate} className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-bold tracking-wide">
          HESAPLA
        </Button>
      </div>

      {calcResult && (
        <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-700/50 flex flex-col gap-3 shadow-inner">
          <div className="flex justify-between items-center border-b border-zinc-700/50 pb-2">
            <span className="text-zinc-200 text-sm font-semibold tracking-wide">Bariyer Primi</span>
            <span className="text-2xl font-bold font-mono text-emerald-400">${formatCurrency(calcResult.price)}</span>
          </div>

          {calcResult.vv ? (
            <div className="rounded-md border border-zinc-700/50 bg-zinc-900/40 px-3 py-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                Vanna-Volga (smile düzeltmesi) · ATM vol %{(calcResult.vv.atmVol * 100).toFixed(2)}
              </div>
              <div className="flex justify-between text-xs font-mono text-zinc-400">
                <span>düz BS (ATM vol)</span>
                <span>${formatCurrency(calcResult.vv.bsPrice)}</span>
              </div>
              <div className="flex justify-between text-xs font-mono text-zinc-400">
                <span>smile düzeltmesi</span>
                <span>{calcResult.vv.correction >= 0 ? "+" : "−"}${formatCurrency(Math.abs(calcResult.vv.correction))}</span>
              </div>
              <div className="flex justify-between text-xs font-mono text-emerald-400 pt-1 border-t border-zinc-700/40">
                <span>Vanna-Volga (kullanılan)</span>
                <span>${formatCurrency(calcResult.price)}</span>
              </div>
              <div className="flex justify-between text-[11px] font-mono text-zinc-500 pt-0.5">
                <span>bariyere değmeme olasılığı</span>
                <span>%{(calcResult.vv.survival * 100).toFixed(1)}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-amber-700/40 bg-amber-950/20 px-3 py-2">
              <p className="text-[11px] text-amber-300/90">
                Smile verisi yok / kolonlar kote aralığın dışında — düz tek-vol Black-Scholes
                kullanıldı. Bariyerli opsiyonda skew düzeltmesi uygulanamadı.
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="text-xs text-zinc-500 uppercase">Delta</div>
              <div className="font-mono text-sm text-zinc-300">{calcResult.greeks.delta.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 uppercase">Gamma</div>
              <div className="font-mono text-sm text-zinc-300">{calcResult.greeks.gamma.toFixed(6)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 uppercase">Theta</div>
              <div className="font-mono text-sm text-zinc-300">{calcResult.greeks.theta.toFixed(4)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 uppercase">Vega</div>
              <div className="font-mono text-sm text-zinc-300">{calcResult.greeks.vega.toFixed(4)}</div>
            </div>
          </div>

          {calcResult.knockedOut && (
            <div className="rounded-md border border-rose-600/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-300/90">
              ⚠ Spot bariyeri (H) zaten aştı — opsiyon devre dışı (knocked out). Prim yalnızca rebate&apos;ten ibarettir; Greek&apos;ler ~0.
            </div>
          )}
          {calcResult.nearBarrier && !calcResult.knockedOut && (
            <div className="rounded-md border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300/90">
              ⚠ Spot bariyere (H) yakın. Greek&apos;ler sonlu farkla hesaplanıyor; bariyerdeki süreksizlik nedeniyle Delta/Gamma bu bölgede oynak ve güvenilmez olabilir.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
