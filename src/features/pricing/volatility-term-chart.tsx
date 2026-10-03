"use client";

import { useMemo } from 'react';
import { rebasedExpiryDays, surfaceVolEstimate, type VolSurface } from '@/lib/vol/surface';
import { analysisNumber } from './position-analysis-view';

export function VolatilityTermChart({ surface, valuationDate, onSelect }: { surface: VolSurface | null; valuationDate: string; onSelect?: (date: string) => void }) {
  const points = useMemo(() => (surface?.expiries ?? []).map(e => {
    const days = rebasedExpiryDays(surface!, e, valuationDate);
    const iv = days > 0 ? surfaceVolEstimate(surface!, 1, days, valuationDate).vol : null;
    return { date: e.date, days, iv };
  }).filter((p): p is { date: string; days: number; iv: number } => p.iv !== null && Number.isFinite(p.days)).sort((a, b) => a.days - b.days), [surface, valuationDate]);
  if (!points.length) return <section className="analysis-panel"><h2>Volatilitenin vade yapısı</h2><p className="analysis-empty">Vade eğrisi için yeterli ATM smile verisi yok.</p></section>;
  const maxDays = Math.max(...points.map(p => p.days)), lo = Math.min(...points.map(p => p.iv)) * 100 - 1, hi = Math.max(...points.map(p => p.iv)) * 100 + 1;
  const x = (d: number) => 65 + d / maxDays * 790, y = (iv: number) => 250 - (iv * 100 - lo) / (hi - lo) * 220;
  return <section className="analysis-panel"><div className="analysis-panel-head"><div><p className="desk-eyebrow">VADE YAPISI</p><h2>ATM volatilite hangi vadede?</h2></div><span className="desk-muted">Forward ATM · K / F = 1</span></div>
    <div className="analysis-chart-scroll"><svg className="analysis-chart" viewBox="0 0 900 300" role="img" aria-label="Kayıtlı yüzeyden vadeye göre ATM volatilite eğrisi"><path d={points.map((p, i) => `${i ? 'L' : 'M'}${x(p.days)},${y(p.iv)}`).join(' ')} fill="none" stroke="var(--primary)" strokeWidth="2.5" />{points.map(p => <g key={p.date}><circle cx={x(p.days)} cy={y(p.iv)} r="4" fill="var(--primary)"><title>{p.date} · %{analysisNumber(p.iv * 100)}</title></circle></g>)}{[lo, (lo + hi) / 2, hi].map(v => <text key={v} x="52" y={y(v / 100) + 4} textAnchor="end" fill="var(--muted-foreground)" fontSize="12">%{analysisNumber(v, 1)}</text>)}{[0, maxDays / 2, maxDays].map(d => <text key={d} x={x(d)} y="281" textAnchor="middle" fill="var(--muted-foreground)" fontSize="12">{Math.round(d)} gün</text>)}</svg></div>
    <div className="desk-tenors">{points.map(p => <button key={p.date} onClick={() => onSelect?.(p.date)} disabled={!onSelect}>{p.date}<strong>%{analysisNumber(p.iv * 100)}</strong></button>)}</div>
    <p className="analysis-footnote">Aynı tarihli yüzeyin vade düğümleri. Yüksek IV tek başına pahalı işlem veya yatırım önerisi anlamına gelmez.</p>
  </section>;
}
