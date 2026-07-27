"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { barrierPrice, barrierGreeks, spotFiniteDiff } from "@/lib/math";
import { vannaVolgaBarrier } from "@/lib/math/vanna-volga";

interface BarrierOptionsProps {
  spot: number;
  strike: number;
  tYears: number;
  rate: number;
  lease: number;
  vol: number;
  /** Verilen fiyat seviyesinin smile vol'ü (%). Yoksa/aralığın dışıysa null. */
  volAtLevel?: (level: number) => number | null;
  /** Kontrat büyüklüğü (ons) — toplam primi göstermek için. */
  contractSize?: number;
  /** true ise Vanna-Volga dökümü + Greek'ler de gösterilir (bariyer alt sayfası). */
  detailed?: boolean;
}

interface BarrierGreekResult {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

/** Tek bacak (call ya da put) için hesap sonucu. */
interface LegResult {
  price: number;
  greeks: BarrierGreekResult;
  /** Vanna-Volga uygulandıysa detayları; smile yoksa null (düz BS'e düşülür). */
  vv: { bsPrice: number; correction: number; survival: number; atmVol: number } | null;
}

/** Hesap anındaki girdiler — sonrasında girdi değişirse ekrandaki sonuç "bayat" işaretlenir. */
interface CalcInputs {
  spot: number; strike: number; tYears: number; rate: number; lease: number; vol: number;
  variant: string; barrierH: number; rebateR: number;
}

interface CalcResult {
  call: LegResult;
  put: LegResult;
  nearBarrier: boolean;
  knockedOut: boolean;
  inputs: CalcInputs;
}

/** Bariyer yapısı: yön (u/d) + tip (o/i). Call ve put AYNI yapı için birlikte fiyatlanır. */
const VARIANTS: { value: string; label: string }[] = [
  { value: "uo", label: "Up & Out (yukarı — değerse ölür)" },
  { value: "do", label: "Down & Out (aşağı — değerse ölür)" },
  { value: "ui", label: "Up & In (yukarı — değerse doğar)" },
  { value: "di", label: "Down & In (aşağı — değerse doğar)" },
];

const fmt = (val: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0);

/** Yüzde gösterimi vanilya priminkiyle aynı hassasiyette olsun (yan yana duruyorlar). */
const fmtPct = (val: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(val || 0);

const fmtUsd = (val: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

/**
 * Bariyer fiyatlama durumu + hesabı. Girdi paneli (BarrierInputs) ile sonuç paneli
 * (BarrierResult) FARKLI kartlarda duruyor — girdiler "Piyasa Verileri"nin altında,
 * prim "Prim & Değerleme"nin altında — bu yüzden durum burada ortaklaştırıldı.
 */
export function useBarrierPricing({
  spot, strike, tYears, rate, lease, vol, volAtLevel,
}: BarrierOptionsProps) {
  /**
   * Bariyer seviyesi. Kullanıcı bir değer girene kadar null tutulur ve ekranda CANLI
   * spotun %10 üstü gösterilir. Sabit bir başlangıç değeri (spot·1.1) kullanılamaz:
   * bu hook sayfa seviyesinde, canlı spot gelmeden önce kuruluyor — varsayılan, açılış
   * anındaki geçici spota (ör. 3700) çakılıp kalıyordu.
   */
  const [barrierHRaw, setBarrierH] = useState<number | string | null>(null);
  const barrierH = barrierHRaw ?? Math.round(spot * 1.1 * 100) / 100;
  const [rebateR, setRebateR] = useState<number | string>(0);
  const [variant, setVariant] = useState<string>("uo");

  /**
   * HESAPLA ile ONAYLANAN bariyer yapısı. Fiyat bu yapıdan ve CANLI piyasa girdilerinden
   * her render'da yeniden türetilir (aşağıdaki useMemo) — sonuç saklanmaz.
   *
   * Neden: sonuç sabit saklandığında, canlı besleme spotu 5 dakikada bir tazelediği için
   * kullanıcı hiçbir şeye dokunmadan "girdiler değişti, tekrar hesaplayın" uyarısı
   * alıyordu (sayaç sayfa açılışına göre işlediğinden hesaptan 1-2 dakika sonra bile).
   * Oysa yanındaki vanilya primi kendiliğinden güncelleniyor. Artık bariyer primi de
   * öyle: piyasa oynayınca sessizce güncellenir, uyarı YALNIZCA kullanıcı bariyer
   * formunu değiştirip HESAPLA'ya basmadığında çıkar.
   */
  const [committed, setCommitted] = useState<{ variant: string; barrierH: number; rebateR: number } | null>(null);

  const calculate = () => {
    // Kullanıcı H girmediyse alan canlı spotu (×1.1) izliyor. HESAPLA'ya basıldığında o an
    // GÖRÜLEN seviye sabitlenir: aksi halde spot her tazelendiğinde H kayıyor, bariyer
    // yapısı değişmiş sayılıyor ve kullanıcı hiçbir şeye dokunmadan "girdiler değişti"
    // uyarısı alıyordu. Fiyatlanan bariyerin seviyesi de sessizce oynamamış olur.
    setBarrierH(barrierH);
    setCommitted({ variant, barrierH: Number(barrierH), rebateR: Number(rebateR) });
  };

  const calcResult = useMemo<CalcResult | null>(() => {
    if (!committed) return null;
    return priceBarrier({ spot, strike, tYears, rate, lease, vol, volAtLevel }, committed);
  }, [committed, spot, strike, tYears, rate, lease, vol, volAtLevel]);

  /** Kullanıcı formu değiştirdi ama HESAPLA'ya basmadı mı? */
  const stale = !!committed && (
    committed.variant !== variant || committed.barrierH !== Number(barrierH) || committed.rebateR !== Number(rebateR)
  );

  return { barrierH, setBarrierH, rebateR, setRebateR, variant, setVariant, calcResult, calculate, stale };
}

/** Fiyat hesabı — saf fonksiyon. FİYATLAMA MANTIĞI DEĞİŞMEDİ, yalnız state'ten ayrıldı. */
function priceBarrier(
  { spot, strike, tYears, rate, lease, vol, volAtLevel }: BarrierOptionsProps,
  { variant, barrierH, rebateR }: { variant: string; barrierH: number; rebateR: number },
): CalcResult {
  {
    const r = rate / 100, q = lease / 100;
    // Smile fonksiyonu (ondalık vol). Yoksa Vanna-Volga kurulamaz → düz BS'e düşülür.
    const smile = volAtLevel
      ? (k: number): number | null => { const v = volAtLevel(k); return v != null && isFinite(v) ? v / 100 : null; }
      : null;

    /** Tek bacağı (code = 'c'/'p' + variant) fiyatlar. FİYATLAMA MANTIĞI DEĞİŞMEDİ. */
    const priceLeg = (code: string): LegResult => {
      /**
       * Fiyat: Vanna-Volga varsa onunla (piyasa standardı smile düzeltmesi), yoksa tek-vol BS.
       * `shift` paralel vol kaydırmasıdır — vega'yı sonlu farkla almak için kullanılır.
       */
      const priceAt = (s: number, shift: number): number => {
        if (smile) {
          const sm = (k: number) => { const v = smile(k); return v == null ? null : v + shift; };
          const res = vannaVolgaBarrier(s, strike, barrierH, rebateR, tYears, r, q, code, sm);
          if (res) return res.price;
        }
        return barrierPrice(s, strike, barrierH, rebateR, tYears, r, q, vol / 100 + shift, code);
      };

      const vvRes = smile ? vannaVolgaBarrier(spot, strike, barrierH, rebateR, tYears, r, q, code, smile) : null;
      const price = vvRes ? vvRes.price : barrierPrice(spot, strike, barrierH, rebateR, tYears, r, q, vol / 100, code);

      // Greek'ler: VV varsa VV fiyatının kendisinden sonlu farkla (fiyatla tutarlı olsun),
      // yoksa mevcut BS tabanlı hesaplayıcı.
      let greeks: BarrierGreekResult;
      if (vvRes) {
        const dv = 0.005, dt = 1 / 365;
        // Delta/Gamma bariyer-korumalı sonlu farkla (bkz. spotFiniteDiff): bariyere yakınken
        // adımlar tek taraflı atılır, süreksizlik örneklenmez.
        const { delta, gamma } = spotFiniteDiff(spot, barrierH, s => priceAt(s, 0));
        const pT = (() => {
          const sm = smile as (k: number) => number | null;
          const res = vannaVolgaBarrier(spot, strike, barrierH, rebateR, Math.max(tYears - dt, 1e-8), r, q, code, sm);
          return res ? res.price : price;
        })();
        greeks = {
          delta,
          gamma,
          vega: (priceAt(spot, dv) - priceAt(spot, -dv)) / (2 * dv) / 100,
          theta: pT - price,
        };
      } else {
        greeks = barrierGreeks(spot, strike, barrierH, rebateR, tYears, r, q, vol / 100, code, 365);
      }

      return {
        price,
        greeks,
        vv: vvRes ? { bsPrice: vvRes.bsPrice, correction: vvRes.correction, survival: vvRes.survival, atmVol: vvRes.atmVol } : null,
      };
    };

    const isUp = variant[0] === "u";
    const isOut = variant[1] === "o";
    // Greek'ler sonlu farkla; bariyer süreksizliğine yakın (~%3) Delta/Gamma güvenilmez
    const nearBarrier = spot > 0 && Math.abs(spot - barrierH) / spot < 0.03;
    // KO opsiyonu bariyeri zaten geçtiyse devre dışı — prim yalnızca rebate
    const knockedOut = isOut && ((isUp && spot >= barrierH) || (!isUp && spot <= barrierH));

    return {
      call: priceLeg("c" + variant),
      put: priceLeg("p" + variant),
      nearBarrier,
      knockedOut,
      inputs: { spot, strike, tYears, rate, lease, vol, variant, barrierH, rebateR },
    };
  }
}

export type BarrierPricing = ReturnType<typeof useBarrierPricing>;

/** Girdi paneli — "Piyasa Verileri" kartının altında durur. */
export function BarrierInputs({ state }: { state: BarrierPricing }) {
  const { barrierH, setBarrierH, rebateR, setRebateR, variant, setVariant, calculate, stale } = state;

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-zinc-300">Bariyer Opsiyonu (Knock-In / Knock-Out)</div>

      <div className="space-y-1.5">
        <Label className="text-zinc-400 text-xs uppercase tracking-wider">Bariyer Tipi</Label>
        {/* Call/Put burada SEÇİLMEZ: aynı bariyer yapısının call ve put primi birlikte
            hesaplanıp yan yana gösteriliyor (vanilya kartındaki gibi). */}
        <Select value={variant} onValueChange={(v) => setVariant(v || "uo")}>
          <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-200"><SelectValue /></SelectTrigger>
          <SelectContent>
            {VARIANTS.map(v => (
              <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-zinc-400 text-xs uppercase tracking-wider">Bariyer (H)</Label>
          <Input
            type="number"
            value={barrierH}
            onChange={e => setBarrierH(e.target.value)}
            className="bg-zinc-900 border-zinc-700 font-mono text-zinc-200"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-zinc-400 text-xs uppercase tracking-wider">Rebate (R)</Label>
          <Input
            type="number"
            value={rebateR}
            onChange={e => setRebateR(e.target.value)}
            className="bg-zinc-900 border-zinc-700 font-mono text-zinc-200"
          />
        </div>
      </div>
      <Button onClick={calculate} className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-bold tracking-wide">
        HESAPLA
      </Button>
      {stale && (
        <p className="text-[11px] text-amber-500">
          Girdiler hesaptan sonra değişti — prim güncel değil, tekrar hesaplayın.
        </p>
      )}
    </div>
  );
}

/**
 * Bariyer değerleme — vanilya prim kartının BİREBİR aynı düzeni: Call/Put primi (ons) +
 * yüzde, altında yalnızca toplam primler. Vade/vol/forward zaten vanilya bölümünde yazıyor,
 * tekrarlanmaz.
 */
export function BarrierResult({
  state, contractSize = 1, detailed = false,
}: { state: BarrierPricing; contractSize?: number; detailed?: boolean }) {
  const { calcResult, stale } = state;
  if (!calcResult) return null;

  const { call, put, inputs } = calcResult;
  const label = VARIANTS.find(v => v.value === inputs.variant)?.label ?? inputs.variant;
  const pct = (p: number) => inputs.strike > 0 ? (p / inputs.strike) * 100 : 0;
  const noSmile = !call.vv || !put.vv;

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold text-zinc-300">
        Bariyer Değerleme{" "}
        <span className="font-normal text-zinc-500">· {label} · H {fmt(inputs.barrierH)}</span>
      </div>

      {stale && (
        <div className="rounded-md border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300/90">
          ⚠ Girdiler değişti — aşağıdaki rakamlar son &quot;HESAPLA&quot;dan kalma. Tekrar hesaplayın.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-secondary/50">
        <div>
          <div className="text-sm text-muted-foreground mb-1">Call Primi (ons)</div>
          <div className="text-2xl font-bold text-emerald-500">${fmt(call.price)}</div>
          <div className="text-xs text-muted-foreground mt-1">% {fmtPct(pct(call.price))}</div>
        </div>
        <div>
          <div className="text-sm text-muted-foreground mb-1">Put Primi (ons)</div>
          <div className="text-2xl font-bold text-rose-500">${fmt(put.price)}</div>
          <div className="text-xs text-muted-foreground mt-1">% {fmtPct(pct(put.price))}</div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm py-1 border-t">
          <span className="text-muted-foreground">Toplam Call Primi ({contractSize} ons)</span>
          <span className="font-mono text-emerald-500">{fmtUsd(call.price * contractSize)}</span>
        </div>
        <div className="flex justify-between text-sm py-1 border-t">
          <span className="text-muted-foreground">Toplam Put Primi ({contractSize} ons)</span>
          <span className="font-mono text-rose-500">{fmtUsd(put.price * contractSize)}</span>
        </div>
      </div>

      {/* Smile uygulanamadıysa bu SESSİZ GEÇİLMEZ: fiyat skew düzeltmesi olmadan üretilmiştir. */}
      {noSmile && (
        <div className="rounded-md border border-amber-700/40 bg-amber-950/20 px-3 py-2">
          <p className="text-[11px] text-amber-300/90">
            Smile verisi yok / kolonlar kote aralığın dışında — düz tek-vol Black-Scholes
            kullanıldı. Bariyerli opsiyonda skew düzeltmesi uygulanamadı.
          </p>
        </div>
      )}

      {calcResult.knockedOut && (
        <div className="rounded-md border border-rose-600/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-300/90">
          ⚠ Spot bariyeri (H) zaten aştı — opsiyon devre dışı (knocked out). Prim yalnızca rebate&apos;ten ibarettir.
        </div>
      )}
      {calcResult.nearBarrier && !calcResult.knockedOut && (
        <div className="rounded-md border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300/90">
          ⚠ Spot bariyere (H) yakın — bariyerdeki süreksizlik nedeniyle prim ve Greek&apos;ler bu bölgede oynaktır.
        </div>
      )}

      {/* Ayrıntı (Vanna-Volga dökümü + Greek'ler) yalnız bariyer ALT SAYFASINDA. Ana fiyatlama
          ekranında kart sade tutulur — orada istenen tek şey prim. */}
      {detailed && (
        <div className="space-y-4 pt-2 border-t border-zinc-800">
          {([['Call', call], ['Put', put]] as [string, LegResult][]).map(([name, leg]) => (
            <div key={name} className="space-y-2">
              <div className="text-xs uppercase tracking-wider text-zinc-500">{name}</div>
              {leg.vv && (
                <div className="rounded-md border border-zinc-700/50 bg-zinc-900/40 px-3 py-2 space-y-1">
                  <div className="flex justify-between text-xs font-mono text-zinc-400">
                    <span>düz BS (ATM vol %{(leg.vv.atmVol * 100).toFixed(2)})</span>
                    <span>${fmt(leg.vv.bsPrice)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-mono text-zinc-400">
                    <span>smile düzeltmesi (Vanna-Volga)</span>
                    <span>{leg.vv.correction >= 0 ? "+" : "−"}${fmt(Math.abs(leg.vv.correction))}</span>
                  </div>
                  <div className="flex justify-between text-[11px] font-mono text-zinc-500">
                    <span>bariyere değmeme olasılığı</span>
                    <span>%{(leg.vv.survival * 100).toFixed(1)}</span>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className="text-xs text-zinc-500 uppercase">Delta</div>
                  <div className="font-mono text-sm text-zinc-300">{leg.greeks.delta.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 uppercase">Gamma</div>
                  <div className="font-mono text-sm text-zinc-300">{leg.greeks.gamma.toFixed(6)}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 uppercase">Theta</div>
                  <div className="font-mono text-sm text-zinc-300">{leg.greeks.theta.toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 uppercase">Vega</div>
                  <div className="font-mono text-sm text-zinc-300">{leg.greeks.vega.toFixed(4)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Girdi + sonucu tek blokta veren sarmalayıcı (bariyer alt sayfası bunu kullanır). */
export function BarrierOptions(props: BarrierOptionsProps) {
  const state = useBarrierPricing(props);
  return (
    <div className="space-y-4">
      <BarrierInputs state={state} />
      <BarrierResult state={state} contractSize={props.contractSize} detailed={props.detailed} />
    </div>
  );
}
