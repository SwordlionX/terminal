"use client";

import { useMemo } from "react";
import { rebasedExpiryDays, surfaceVolEstimate, type VolSurface } from "@/lib/vol/surface";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  surface: VolSurface | null;
  fwd: number;
  strike: number;
  daysToExpiry: number;
  valuationDate?: string;
  sourceLabel?: string;
  manualVol?: boolean;
  effectiveVol?: number;
}

const modeLabel = {
  observed: "Kote nokta", interpolated: "Kote smile enterpolasyonu",
  model: "SSVI uyumu", extrapolated: "SSVI model kanadı", unavailable: "Vol bulunamadı",
};

/** Observed dots and the exact curve/marker used by the pricing query. */
export function SmileChart({ surface, fwd, strike, daysToExpiry, valuationDate, sourceLabel, manualVol = false, effectiveVol }: Props) {
  const view = useMemo(() => {
    if (!surface || !surface.expiries.length || !(fwd > 0) || !(strike > 0) || !(daysToExpiry > 0)) return null;
    const active = surface.expiries
      .map(expiry => ({ expiry, days: rebasedExpiryDays(surface, expiry, valuationDate) }))
      .filter(item => Number.isFinite(item.days) && item.days > 0)
      .sort((a, b) => Math.abs(a.days - daysToExpiry) - Math.abs(b.days - daysToExpiry));
    if (!active.length) return null;
    const near = active[0];
    const pts = near.expiry.points.filter(p => Number.isFinite(p.m) && p.m > 0 && Number.isFinite(p.iv) && p.iv > 0);
    if (pts.length < 2) return null;
    const targetM = strike / fwd;
    const target = surfaceVolEstimate(surface, targetM, daysToExpiry, valuationDate);
    const quotedMin = Math.min(...pts.map(p => p.m));
    const quotedMax = Math.max(...pts.map(p => p.m));
    const xMin = Math.max(0.01, Math.min(quotedMin, targetM) * 0.97);
    const xMax = Math.max(quotedMax, targetM) * 1.03;
    const curve = Array.from({ length: 121 }, (_, i) => {
      const m = xMin + (xMax - xMin) * i / 120;
      const estimate = surfaceVolEstimate(surface, m, daysToExpiry, valuationDate);
      return { m, iv: estimate.vol, mode: estimate.mode };
    });
    const ivs = [...pts.map(p => p.iv), ...curve.flatMap(p => p.iv == null ? [] : [p.iv]),
      ...(target.vol == null ? [] : [target.vol])];
    const ivLow = Math.min(...ivs), ivHigh = Math.max(...ivs);
    const pad = Math.max((ivHigh - ivLow) * 0.15, 0.005);
    return { near, pts, targetM, target, quotedMin, quotedMax, xMin, xMax, curve,
      ivMin: (ivLow - pad) * 100, ivMax: (ivHigh + pad) * 100 };
  }, [surface, fwd, strike, daysToExpiry, valuationDate]);

  if (!view) return (
    <Card>
      <CardHeader><CardTitle>Volatilite Smile (kaynak)</CardTitle></CardHeader>
      <CardContent><div className="text-sm text-muted-foreground">Smile verisi veya geçerli vade yok.</div></CardContent>
    </Card>
  );

  const { near, pts, targetM, target, quotedMin, quotedMax, xMin, xMax, curve, ivMin, ivMax } = view;
  const W = 800, H = 300, padL = 56, padR = 24, padT = 24, padB = 42;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const xOf = (m: number) => padL + (m - xMin) / (xMax - xMin) * plotW;
  const yOf = (ivPct: number) => padT + (1 - (ivPct - ivMin) / (ivMax - ivMin)) * plotH;
  const pathFor = (model: boolean) => {
    let path = "", drawing = false;
    for (const p of curve) {
      const eligible = p.iv != null && (model
        ? p.mode === "model" || p.mode === "extrapolated"
        : p.mode === "observed" || p.mode === "interpolated");
      if (!eligible) { drawing = false; continue; }
      path += `${drawing ? "L" : "M"}${xOf(p.m).toFixed(2)} ${yOf((p.iv as number) * 100).toFixed(2)} `;
      drawing = true;
    }
    return path;
  };
  const xTicks = [xMin, (xMin + xMax) / 2, xMax];
  const yTicks = [ivMin, (ivMin + ivMax) / 2, ivMax];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          <span>Volatilite Smile (kaynak)</span>
          <span className="text-xs font-normal text-muted-foreground">
            {sourceLabel ?? `${surface?.symbol} yüzeyi`} · en yakın kote vade: {near.expiry.date} ({near.days.toFixed(1)}g)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="w-full overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px] h-auto" role="img" aria-label={manualVol ? "Referans smile grafiği; manuel volatilite fiyatlamada kullanılıyor" : "Volatilite smile grafiği: kote noktaları, fiyatlamada kullanılan eğri ve strike işaretçisi"}>
            <rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke="currentColor" className="text-zinc-800" strokeWidth={1} />
            {yTicks.map((t, i) => <g key={`y${i}`}>
              <line x1={padL} x2={padL + plotW} y1={yOf(t)} y2={yOf(t)} stroke="currentColor" className="text-zinc-800/60" strokeWidth={1} strokeDasharray="2 3" />
              <text x={padL - 6} y={yOf(t) + 3} textAnchor="end" className="fill-zinc-500" fontSize={9}>%{t.toFixed(1)}</text>
            </g>)}
            {xTicks.map((t, i) => <text key={`x${i}`} x={xOf(t)} y={H - padB + 14} textAnchor="middle" className="fill-zinc-500" fontSize={9}>{t.toFixed(3)}</text>)}
            <text x={padL + plotW / 2} y={H - 4} textAnchor="middle" className="fill-zinc-400" fontSize={9}>Forward-moneyness (K / F)</text>
            <path d={pathFor(false)} fill="none" stroke="currentColor" className="text-emerald-500" strokeWidth={1.5} />
            <path d={pathFor(true)} fill="none" stroke="currentColor" className="text-sky-400" strokeWidth={1.5} strokeDasharray="5 3" />
            {pts.map((p, i) => <circle key={i} cx={xOf(p.m)} cy={yOf(p.iv * 100)} r={2.5} className="fill-emerald-400" />)}
            <line x1={xOf(targetM)} x2={xOf(targetM)} y1={padT} y2={padT + plotH}
              stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 3"
              className={target.vol == null ? "text-rose-500" : "text-zinc-200"} />
            {target.vol != null && <circle cx={xOf(targetM)} cy={yOf(target.vol * 100)} r={4}
              className="fill-zinc-100 stroke-zinc-950" strokeWidth={1} />}
            <text x={xOf(targetM) + (targetM > (xMin + xMax) / 2 ? -4 : 4)} y={padT + 10}
              textAnchor={targetM > (xMin + xMax) / 2 ? "end" : "start"} fontSize={9}
              className={target.vol == null ? "fill-rose-400" : "fill-zinc-300"}>
              strike {targetM.toFixed(3)}{target.vol == null ? " · kapsam dışı" : ""}
            </text>
          </svg>
        </div>
        <div className="mt-2 text-[11px] text-zinc-500 space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1"><span>● Kote noktalar</span><span>— Fiyatlama eğrisi</span><span>┄ SSVI modeli</span></div>
          <div className={target.vol == null ? "text-rose-400/90" : "text-emerald-500/80"}>
            {manualVol ? "Referans yüzey (fiyatlamada kullanılmıyor) · " : ""}{modeLabel[target.mode]}{target.vol != null ? ` · %${(target.vol * 100).toFixed(2)}` : ` · ${target.reason ?? "Yüzey IV'si yok."}`}
          </div>
          {manualVol && <div className="text-amber-400">Fiyatlama manuel IV ile çalışıyor{effectiveVol != null ? `: %${effectiveVol.toFixed(2)}` : "; girdiler geçersiz"}. Grafikteki eğri ve işaretçi yalnız referans yüzeyi gösterir.</div>}
          <details className="workspace-notes"><summary>Eğri ayrıntıları</summary>
            <p>{pts.length} kote nokta · K / F {quotedMin.toFixed(3)}–{quotedMax.toFixed(3)} · seçili vade {daysToExpiry.toFixed(1)} gün.</p>
            {target.fitQuality && <p>Uyum hatası: ortalama %{(target.fitQuality.rmseVol * 100).toFixed(2)}, en çok %{(target.fitQuality.maxErrorVol * 100).toFixed(2)} IV.</p>}
            {target.vol != null && Math.abs(near.days - daysToExpiry) > 1e-8 && <p>Seçili vade için kote vadeler arasında toplam varyans enterpolasyonu kullanılır.</p>}
          </details>
        </div>
      </CardContent>
    </Card>
  );
}
