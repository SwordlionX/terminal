"use client";

import { useState } from 'react';
import { PositionAnalysisView } from '@/features/pricing/position-analysis-view';
import { ArrowUpRight, ChevronDown, ChevronUp, Check, AlertTriangle, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMarketData } from '@/store/marketData';
import { useAnalysisDraft } from '@/store/analysis-draft';
import type { AssistantArtifact, Quote, ScenarioResult } from '@/lib/assistant/types';
import { formatDate, formatDateTime } from '@/lib/format';

const fmt = (n: number, digits = 2) => Number.isFinite(n) ? n.toLocaleString('tr-TR', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
const money = (n: number) => `${fmt(n)} USD`;
const compact = (n: number) => n.toLocaleString('tr-TR', { notation: 'compact', maximumFractionDigits: 1 });
const buttonFocus = 'min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300';
const modeLabels: Record<string, string> = { observed: 'Gözlemlenen IV', interpolated: 'Ara değer', model: 'SSVI modeli', extrapolated: 'SSVI uzatma' };
const unitLabels: Record<string, string> = { usd_per_unit: 'USD/birim', total_usd: 'USD toplam', pct_spot: '% spot nominali', pct_strike: '% strike nominali' };

export function QuoteCard({ quote, caption, onApply }: { quote: Quote; caption?: string; onApply?: () => void }) {
  const [details, setDetails] = useState(false);
  const [applied, setApplied] = useState(false);
  const router = useRouter();
  const q = quote;
  const methodNotes = q.warnings.filter(w => /^(Endikatif SOFR futures proxy|Ayın bilinmeyen business-day|Metal taşıması final CME|Futures son işlem tarihi|Gösterilen faiz\/taşıma)/.test(w));
  const alerts = q.warnings.filter(w => !methodNotes.includes(w));
  const unit = q.product === 'XAU' || q.product === 'XAG' ? 'ons' : 'adet';
  const apply = () => {
    const md = useMarketData.getState();
    useAnalysisDraft.getState().selectQuote(q.type, q.position);
    useAnalysisDraft.getState().setQuoteBarrier(q.barrier ?? null);
    md.setProduct(q.product, q.inputs.spot, q.inputs.lease, q.effectiveVol);
    const fields = { ...q.inputs, vol: q.effectiveVol, manualVol: false, manualSpot: false };
    for (const [key, value] of Object.entries(fields)) {
      md.setField(key as keyof typeof fields, value as never);
    }
    setApplied(true);
    router.push('/');
    onApply?.();
  };
  return <section className="overflow-hidden rounded-2xl border border-primary/20 bg-card" aria-label={`${q.product} ${q.position} ${q.type} fiyatı`}>
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-white/5 px-4 py-3">
      <div className="min-w-0 flex-1 basis-40">{caption && <p className="mb-1 break-words text-xs text-slate-300">{caption}</p>}
        <p className="text-xs font-semibold text-cyan-200">{`${q.product} · ${q.position === 'Short' ? 'Müşteri satışı' : 'Müşteri alışı'} · ${q.type}`}</p>
        {q.barrier && <p className="mt-1 text-xs text-slate-400">Bariyer {q.barrier.variant.toUpperCase()} · {fmt(q.barrier.level)}</p>}</div>
      <span className="rounded-full border border-cyan-400/20 px-2 py-1 text-xs text-cyan-200">ENDİKATİF</span>
    </div>
    <div className="p-4">
      <p className="text-xs text-slate-400">{q.position === 'Short' ? 'Müşterinin alacağı model primi' : 'Müşterinin ödeyeceği model primi'}</p>
      <div className="mt-2 grid grid-cols-2 gap-3"><div><p className="break-words text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{money(q.premiumTotal)}</p><p className="mt-1 text-xs text-muted-foreground">{fmt(q.premiumPerUnit, 4)} USD/{unit}</p></div><div><p className="break-words text-xl font-semibold tracking-tight text-foreground sm:text-2xl">%{fmt(q.premiumPctSpot)}</p><p className="mt-1 text-xs text-muted-foreground">Spot nominali üzerinden</p></div></div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs [&>div]:min-w-0 [&_dd]:break-words min-[420px]:grid-cols-3">
        <div><dt className="text-slate-400">Strike</dt><dd className="mt-1 font-mono text-slate-200">{fmt(q.inputs.strike, 4)}</dd></div>
        <div><dt className="text-slate-400">Vade</dt><dd className="mt-1 text-slate-200">{formatDate(q.inputs.expiryDate)}</dd></div>
        <div><dt className="text-slate-400">Miktar</dt><dd className="mt-1 text-slate-200">{fmt(q.inputs.contractSize)} {unit}</dd></div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {!q.barrier && <button onClick={apply} className={`${buttonFocus} flex items-center gap-1.5 rounded-lg bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-200`}>
          {applied ? <Check size={13} /> : <ArrowUpRight size={13} />}{applied ? 'Forma uygulandı' : 'Forma uygula'}</button>}
        <button onClick={() => setDetails(v => !v)} aria-expanded={details} className={`${buttonFocus} flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5`}>
          Hesap ayrıntıları {details ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>
      </div>
      {details && <div className="mt-4 space-y-2 border-t border-white/10 pt-3 text-xs text-slate-400">
        <p>{q.model} · {modeLabels[q.volMode] ?? q.volMode}</p>
        <p>Spot {fmt(q.inputs.spot, 4)} · IV %{fmt(q.effectiveVol, 4)} · Faiz %{fmt(q.inputs.rate, 4)} · Kira %{fmt(q.inputs.lease, 4)}</p>
        <p>Değerleme {formatDate(q.inputs.tradeDate)} · Gün bazı {q.inputs.basis} · Strike nominali üzerinden prim %{fmt(q.premiumPctStrike, 4)}</p>
        <p>Delta {fmt(q.delta, 4)} {unit} · Gamma {fmt(q.gamma, 6)} · Vega {money(q.vega)} / vol puanı · Theta {money(q.theta)} / gün</p>
        <p>Delta nötr hedge: {q.hedgeUnits >= 0 ? 'Al' : 'Sat'} {fmt(Math.abs(q.hedgeUnits), 4)} {unit}</p>
        <p>Spot kaynağı: {q.spotSource}{q.spotAt ? ` · ${formatDateTime(q.spotAt)}` : ''}</p>
        <p>Yüzey tarihi: {q.surfaceAt ? formatDate(q.surfaceAt) : 'Veri yok'}</p>
        <p>Hesap zamanı: {formatDateTime(q.pricedAt)}. Piyasa değişince yeniden fiyatlayın.</p>
      </div>}
      {alerts.length > 0 && <div className="mt-3 space-y-1 rounded-lg bg-amber-400/5 p-2 text-xs leading-relaxed text-amber-200">
        {alerts.map((warning, i) => <p key={i}>{warning}</p>)}
      </div>}
      {methodNotes.length > 0 && <details className="workspace-notes"><summary>Model sınırları</summary>{methodNotes.map((note, i) => <p key={i}>{note}</p>)}</details>}
    </div>
  </section>;
}

const colors = ['var(--primary)', 'var(--chart-4)', 'var(--analysis-positive)'];
export function ScenarioChart({ results, onApply }: { results: ScenarioResult[]; onApply?: () => void }) {
  const [selected, setSelected] = useState(10);
  const all = results.flatMap(r => r.points.map(p => p.pnl));
  const rawMin = Math.min(0, ...all), rawMax = Math.max(0, ...all);
  const min = rawMin === rawMax ? -1 : rawMin, max = rawMin === rawMax ? 1 : rawMax;
  const span = max - min;
  const x = (i: number) => 8 + i / 20 * 284;
  const y = (v: number) => 10 + (max - v) / span * 160;
  const selectedPoint = results[0]?.points[selected];
  return <section className="rounded-2xl border border-border bg-card p-4" aria-label="Pozisyon senaryo karşılaştırması">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-100">{results[0]?.horizon === 'expiry' ? 'Vade sonu karşılaştırması' : 'Bugünkü spot şoku'}</h3><span className="text-xs text-slate-400">MOTOR HESABI</span></div>
    <p className="mt-3 text-xs text-slate-400">Toplam kâr / zarar (USD)</p>
    <div className="mt-2 flex gap-2">
      <div aria-hidden="true" className="flex h-44 w-14 shrink-0 flex-col justify-between py-1 text-right text-xs tabular-nums text-slate-300">
        {[0, 0.5, 1].map(t => <span key={t} title={money(max - t * span)}>{compact(max - t * span)}</span>)}
      </div>
      <div className="min-w-0 flex-1">
    <svg viewBox="0 0 300 180" preserveAspectRatio="none" role="img" aria-label="Spot değişimine göre toplam kâr zarar grafiği. Kesin tutarlar aşağıda." className="h-44 w-full touch-pan-y"
      onPointerMove={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.pointerType === 'touch' && event.buttons === 0) return;
        const px = (event.clientX - rect.left) / rect.width * 300;
        setSelected(Math.max(0, Math.min(20, Math.round((px - 8) / 284 * 20))));
      }}>
      <title>Motor sonuçlarından hesaplanan toplam USD kâr zarar</title>
      {[0, 0.5, 1].map(t => <line key={t} x1="8" x2="292" y1={10 + t * 160} y2={10 + t * 160} stroke="#ffffff15" />)}
      <line x1="8" x2="292" y1={y(0)} y2={y(0)} stroke="#94a3b8" strokeDasharray="4 4" />
      {results.map((r, i) => <polyline key={r.label + i} fill="none" stroke={colors[i % colors.length]} strokeWidth="2.5" vectorEffect="non-scaling-stroke" points={r.points.map((p, j) => `${x(j)},${y(p.pnl)}`).join(' ')} />)}
      <line x1={x(selected)} x2={x(selected)} y1="10" y2="170" stroke="#ffffff60" />
      {results.map((r, i) => <circle key={i} cx={x(selected)} cy={y(r.points[selected].pnl)} r="4" fill={colors[i % colors.length]} />)}
    </svg>
    <div aria-hidden="true" className="flex justify-between gap-1 text-xs text-slate-300">{[-20, -10, 0, 10, 20].map(v => <span key={v}>{v > 0 ? '+' : ''}{v}%</span>)}</div>
      </div>
    </div>
    <label className="mt-3 flex flex-wrap items-center gap-x-3 text-xs text-slate-300">Spot değişimi
      <input aria-label="Grafikte spot değişimini seç" aria-valuetext={selectedPoint ? `Spot değişimi yüzde ${fmt(selectedPoint.movePct)}; senaryo spotu ${fmt(selectedPoint.spot, 4)}` : 'Senaryo verisi yok'} type="range" min="0" max="20" value={selected} onChange={e => setSelected(Number(e.target.value))} className="h-11 min-w-20 flex-1 accent-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300" />
      <span>{selectedPoint?.movePct}%</span></label>
    <p className="mt-2 text-xs text-slate-400">Senaryo spotu: {fmt(selectedPoint?.spot ?? 0, 4)}</p>
    <div className="mt-3 space-y-3">{results.map((r, i) => <div key={i} className="flex flex-col gap-1 text-xs min-[420px]:flex-row min-[420px]:justify-between min-[420px]:gap-3">
      <span className="flex min-w-0 items-center gap-2 text-slate-300"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colors[i % colors.length] }} />{r.label}</span>
      <span className={`break-words font-mono ${r.points[selected].pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{money(r.points[selected].pnl)}</span>
    </div>)}</div>
    <p className="mt-4 text-xs text-slate-400 min-[520px]:hidden">Diğer ölçümler için yatay kaydır →</p>
    <div className="mt-2 overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-cyan-300" tabIndex={0} role="region" aria-label="Alternatiflerin prim ve risk karşılaştırması; dar ekranda yatay kaydırılabilir"><table className="w-full min-w-[440px] text-left text-xs"><caption className="pb-2 text-left text-slate-300">Prim ve risk karşılaştırması</caption><thead className="text-slate-400"><tr><th scope="col" className="pb-2 pr-3 font-normal">Alternatif</th><th scope="col" className="pb-2 px-3 text-right font-normal">Net model primi</th><th scope="col" className="pb-2 px-3 text-right font-normal">Delta</th><th scope="col" className="pb-2 pl-3 text-right font-normal">Vega</th></tr></thead>
      <tbody>{results.map((r, i) => <tr key={i} className="border-t border-white/5 text-slate-300"><th scope="row" className="py-3 pr-3 font-normal">{r.label}</th><td className="whitespace-nowrap px-3 text-right">{money(r.netCashflow)}</td><td className="whitespace-nowrap px-3 text-right">{fmt(r.delta, 3)}</td><td className="whitespace-nowrap pl-3 text-right">{fmt(r.vega)}</td></tr>)}</tbody></table></div>
    <details className="mt-3 text-xs text-slate-400"><summary className={`${buttonFocus} cursor-pointer py-3`}>Karşılaştırılan işlemler ve varsayımlar</summary>
      <div className="mt-2 space-y-4">{results.map((r, i) => <div key={i}><p className="mb-2 font-semibold text-slate-200">{r.label}</p>
        <div className="space-y-2">{r.quotes.map((q, j) => <QuoteCard key={j} quote={q} onApply={onApply} />)}</div></div>)}</div>
    </details>
    <p className="mt-3 text-xs leading-relaxed text-slate-400">{results[0]?.note}</p>
  </section>;
}

export function ResultCard({ artifact, onApply }: { artifact: AssistantArtifact; onApply?: () => void }) {
  if (artifact.kind === 'customers') return <section className="rounded-xl border border-white/10 p-4" aria-label="Müşteri eşleşmeleri">
    <p className="text-sm font-semibold">{artifact.matches.length ? 'Hangi müşteri?' : 'Müşteri bulunamadı'}</p>
    {artifact.matches.map(c => <p key={c.id} className="mt-2 text-sm">{c.name}</p>)}
    <p className="mt-3 text-xs text-muted-foreground">{artifact.truncated ? 'İlk sekiz eşleşme gösteriliyor. Daha ayrıntılı bir ad yaz.' : 'Müşterinin tam adını sohbete yaz.'}</p>
  </section>;
  if (artifact.kind === 'workspace') {
    const w = artifact.snapshot;
    return <section className="workspace-panel"><p className="desk-eyebrow">TERMİNAL KAYITLARI / SALT OKUNUR</p><h3 className="mt-2 text-sm font-semibold">{w.customer?.name ?? 'Risk masası özeti'}</h3><p className="workspace-muted">{w.trades.length} seçili işlem{w.truncated ? ` · ${w.totalTrades} kaydın ilk ${w.trades.length} tanesi; tam portföy değildir` : ''}</p>{w.margin && <><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><p className="workspace-muted">Ek teminat</p><strong>{money(w.margin.cureAmount)}</strong></div><div><p className="workspace-muted">Prosedür brüt zararı</p><strong>{money(w.margin.totalMtmLoss)}</strong></div></div><p className="workspace-muted mt-3">{w.margin.method}</p>{w.margin.dataWarning && <p className="desk-policy mt-3">{w.margin.dataWarning}</p>}</>}{w.riskSummary && <><p className="mt-3 text-sm">{w.riskSummary.customerCount} müşteri · {w.riskSummary.openTrades} açık işlem</p><p className="mt-2 text-sm">Gerekli ek teminat: {money(w.riskSummary.cureAmount)}</p>{w.riskSummary.priorities.map(r => <Link key={r.customerId} className="desk-link block mt-3" href={`/customers/${r.customerId}?tab=collateral`}>{r.name} · {money(r.cureAmount)} ↗</Link>)}</>}{w.trades.map(t => <Link key={t.id} className="block border-t border-border py-3 mt-3 text-xs" href={`/trades?trade=${t.id}`}><strong>{t.underlying} · {t.position} {t.type}</strong><p className="workspace-muted">{fmt(t.contractSize)} ons · {formatDate(t.expiryDate)} · {money(t.premiumTotal)} geçmiş prim</p><span className="desk-link">Pozisyonu ekranda aç ↗</span></Link>)}{w.customer && <Link className="desk-link block mt-3" href={`/customers/${w.customer.id}`}>Müşteri dosyasını aç ↗</Link>}</section>;
  }
  if (artifact.kind === 'position_analysis') return <section className="min-w-0"><p className="mb-3 text-sm font-semibold">{artifact.result.label}</p><PositionAnalysisView result={artifact.result} compact /></section>;
  if (artifact.kind === 'quote') return <QuoteCard quote={artifact.quote} onApply={onApply} />;
  if (artifact.kind === 'scenarios') return <ScenarioChart results={artifact.results} onApply={onApply} />;
  if (artifact.kind === 'research') return <section className="rounded-2xl border border-indigo-300/20 bg-indigo-300/5 p-4">
    <p className="text-xs font-semibold text-indigo-200">Yöntem araştırması</p><p className="mt-1 text-xs text-slate-400">Bu açıklama fiyat veya piyasa girdisi kaynağı değildir.</p>
    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{artifact.text}</p>
    <ul className="mt-3 space-y-2">{artifact.sources.map((s, i) => <li key={i}><a href={s.url} target="_blank" rel="noopener noreferrer" className={`${buttonFocus} flex items-center gap-2 rounded-lg text-xs text-indigo-200 hover:underline`}><ExternalLink size={14} className="shrink-0" />{s.title}</a></li>)}</ul>
    {artifact.searchEntryHtml && <iframe title="Google arama kaynakları" srcDoc={artifact.searchEntryHtml}
      sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" className="mt-3 h-40 w-full rounded-lg border-0 bg-white" />}
  </section>;
  const r = artifact.result;
  return <section className="space-y-3">
    <div className={`rounded-xl border p-3 ${r.reached ? 'border-emerald-300/20 bg-emerald-300/5' : 'border-amber-300/20 bg-amber-300/5'}`}>
      <p className={`flex items-center gap-2 text-xs font-semibold ${r.reached ? 'text-emerald-200' : 'text-amber-200'}`}>{r.reached ? <Check size={14} /> : <AlertTriangle size={14} />}{r.reached ? 'Hedefi sağlayan alternatif bulundu' : 'Bu aralıkta hedefi sağlayan alternatif bulunamadı'}</p>
      <p className="mt-2 text-xs text-slate-400">Hedef {fmt(r.target, 4)} {unitLabels[r.unit]} · Tolerans ±{fmt(r.tolerance, 5)}</p>
    </div>
    {r.candidates.map((c, i) => <QuoteCard key={i} quote={c.quote} onApply={onApply} caption={`Alternatif ${i + 1} · Hedefe fark ${fmt(c.error, 5)} ${unitLabels[r.unit]}`} />)}
    {!r.reached && r.nearest && <QuoteCard quote={r.nearest.quote} onApply={onApply} caption={`En yakın sonuç · Hedefi sağlamıyor · Fark ${fmt(r.nearest.error, 4)} ${unitLabels[r.unit]}`} />}
  </section>;
}
