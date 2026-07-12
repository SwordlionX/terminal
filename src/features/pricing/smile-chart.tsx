"use client";

import { useMemo } from "react";
import { VolSurface, ExpirySmile } from "@/lib/vol/surface";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  surface: VolSurface | null;
  spot: number;
  strike: number;
  daysToExpiry: number;
}

/** points içinde m'e göre lineer IV (aralık dışında NaN — smileAt ile aynı davranış). */
function interpIv(points: { m: number; iv: number }[], m: number): number {
  if (points.length === 0) return NaN;
  if (m < points[0].m || m > points[points.length - 1].m) return NaN;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (m >= a.m && m <= b.m) {
      const w = (m - a.m) / (b.m - a.m);
      return a.iv + w * (b.iv - a.iv);
    }
  }
  return points[points.length - 1].iv;
}

/**
 * Fiyatlamada kullanılan volatilitenin nereden geldiğini görselleştirir:
 * seçilen vadeye en yakın kote smile'ın gerçek IV noktaları + girilen strike'ın
 * moneyness konumu. Strike kote aralığın dışındaysa net biçimde "kapsam dışı" gösterir.
 */
export function SmileChart({ surface, spot, strike, daysToExpiry }: Props) {
  const view = useMemo(() => {
    if (!surface || surface.expiries.length === 0 || spot <= 0) return null;

    // Seçilen vadeye en yakın kote vade
    let near: ExpirySmile = surface.expiries[0];
    for (const e of surface.expiries) {
      if (Math.abs(e.days - daysToExpiry) < Math.abs(near.days - daysToExpiry)) near = e;
    }
    const pts = near.points;
    if (pts.length < 2) return null;

    const m0 = strike / spot;
    const mMin = pts[0].m, mMax = pts[pts.length - 1].m;
    const inRange = m0 >= mMin && m0 <= mMax;
    const iv0 = interpIv(pts, m0);

    const ivs = pts.map(p => p.iv * 100);
    const ivMin = Math.min(...ivs), ivMax = Math.max(...ivs);
    const ivPad = Math.max((ivMax - ivMin) * 0.15, 0.5);

    return { symbol: surface.symbol, near, pts, m0, mMin, mMax, inRange, iv0, ivMin: ivMin - ivPad, ivMax: ivMax + ivPad };
  }, [surface, spot, strike, daysToExpiry]);

  if (!view) {
    return (
      <Card>
        <CardHeader><CardTitle>Volatilite Smile (kaynak)</CardTitle></CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Smile verisi yok — opsiyon zincirini yenileyin.</div>
        </CardContent>
      </Card>
    );
  }

  const { symbol, near, pts, m0, mMin, mMax, inRange, iv0, ivMin, ivMax } = view;

  // SVG çizim alanı
  const W = 480, H = 220, padL = 44, padR = 16, padT = 14, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const xOf = (m: number) => padL + ((m - mMin) / (mMax - mMin || 1)) * plotW;
  const yOf = (ivPct: number) => padT + (1 - (ivPct - ivMin) / (ivMax - ivMin || 1)) * plotH;

  const line = pts.map(p => `${xOf(p.m).toFixed(1)},${yOf(p.iv * 100).toFixed(1)}`).join(" ");

  // Eksen etiketleri
  const xTicks = [mMin, (mMin + mMax) / 2, mMax];
  const yTicks = [ivMin, (ivMin + ivMax) / 2, ivMax];

  // Girilen strike'ın X'i (kapsam dışıysa kenara kırpılır)
  const mClamped = Math.max(mMin, Math.min(mMax, m0));
  const markerX = xOf(mClamped);

  const interpolatingTime = Math.abs(near.days - daysToExpiry) > 0.6;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2">
          <span>Volatilite Smile (kaynak)</span>
          <span className="text-xs font-normal text-muted-foreground">
            {symbol} yüzeyi · en yakın kote vade: {near.date} ({near.days.toFixed(0)}g)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="w-full overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[360px]" role="img" aria-label="Volatilite smile grafiği">
            {/* çerçeve */}
            <rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke="currentColor" className="text-zinc-800" strokeWidth={1} />

            {/* y grid + etiketler */}
            {yTicks.map((t, i) => (
              <g key={`y${i}`}>
                <line x1={padL} x2={padL + plotW} y1={yOf(t)} y2={yOf(t)} stroke="currentColor" className="text-zinc-800/60" strokeWidth={1} strokeDasharray="2 3" />
                <text x={padL - 6} y={yOf(t) + 3} textAnchor="end" className="fill-zinc-500" fontSize={9}>%{t.toFixed(1)}</text>
              </g>
            ))}

            {/* x etiketleri */}
            {xTicks.map((t, i) => (
              <text key={`x${i}`} x={xOf(t)} y={H - padB + 14} textAnchor="middle" className="fill-zinc-500" fontSize={9}>
                {t.toFixed(3)}
              </text>
            ))}
            <text x={padL + plotW / 2} y={H - 4} textAnchor="middle" className="fill-zinc-400" fontSize={9}>Moneyness (K / S)</text>

            {/* smile eğrisi + noktalar */}
            <polyline points={line} fill="none" stroke="currentColor" className="text-emerald-500" strokeWidth={1.5} />
            {pts.map((p, i) => (
              <circle key={i} cx={xOf(p.m)} cy={yOf(p.iv * 100)} r={2} className="fill-emerald-400" />
            ))}

            {/* girilen strike işaretçisi */}
            <line
              x1={markerX} x2={markerX} y1={padT} y2={padT + plotH}
              stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 3"
              className={inRange ? "text-zinc-200" : "text-rose-500"}
            />
            {inRange && isFinite(iv0) && (
              <circle cx={markerX} cy={yOf(iv0 * 100)} r={3.5} className="fill-zinc-100 stroke-zinc-950" strokeWidth={1} />
            )}
            <text
              x={markerX + (m0 > (mMin + mMax) / 2 ? -4 : 4)}
              y={padT + 10}
              textAnchor={m0 > (mMin + mMax) / 2 ? "end" : "start"}
              fontSize={9}
              className={inRange ? "fill-zinc-300" : "fill-rose-400"}
            >
              strike {m0.toFixed(3)}{inRange ? "" : " · kapsam dışı"}
            </text>
          </svg>
        </div>

        <div className="mt-2 text-[11px] text-zinc-500 space-y-0.5">
          <div>Kote moneyness aralığı: {mMin.toFixed(3)} – {mMax.toFixed(3)} · {pts.length} nokta</div>
          {inRange
            ? <div className="text-emerald-500/80">Strike aralık içinde — vol smile&apos;dan türetildi{isFinite(iv0) ? ` (%${(iv0 * 100).toFixed(2)})` : ""}.</div>
            : <div className="text-rose-400/90">Strike kote aralığın dışında — güvenilir vol türetilemez, fiyat üretilmez.</div>}
          {interpolatingTime && (
            <div>Not: seçilen vade ({daysToExpiry.toFixed(0)}g) iki kote vade arasında; model varyansta harmanlar.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
