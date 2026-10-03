"use client";

import { useState } from 'react';
import type { PositionAnalysis } from '@/lib/pricing/position-analysis';

export const analysisNumber = (v: number, digits = 2) => v.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const analysisMoney = (v: number) => `${analysisNumber(v)} USD`;
const colors = ['var(--primary)', 'var(--analysis-positive)', 'var(--analysis-negative)', 'var(--chart-4)'];

export function PositionCurve({ results, dateIndex = 0 }: { results: PositionAnalysis[]; dateIndex?: number }) {
  const series = results.map(r => r.rows.map(row => ({ x: row.spot, y: row.cells[dateIndex]?.pnl ?? null })));
  const points = series.flat().filter((p): p is { x: number; y: number } => p.y !== null && Number.isFinite(p.y));
  if (!points.length) return <p className="analysis-empty">Bu tarihte eğrinin desteklediği bir fiyat senaryosu yok.</p>;
  const W = 900, H = 320, L = 85, R = 24, T = 25, B = 46;
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const rawMin = Math.min(0, ...points.map(p => p.y)), rawMax = Math.max(0, ...points.map(p => p.y));
  const pad = Math.max((rawMax - rawMin) * .12, 1), minY = rawMin - pad, maxY = rawMax + pad;
  const x = (v: number) => L + (v - minX) / Math.max(maxX - minX, 1) * (W - L - R);
  const y = (v: number) => T + (maxY - v) / (maxY - minY) * (H - T - B);
  return <div>
    <div className="analysis-legend">{results.map((r, i) => <span key={r.label}><i style={{ background: colors[i % colors.length] }} />{r.label}</span>)}</div>
    <div className="analysis-chart-scroll"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Birleşik pozisyon ve alternatifler için fiyat seviyesine göre kâr zarar grafiği" className="analysis-chart">
      {[0, .25, .5, .75, 1].map(f => { const v = minY + f * (maxY - minY); return <g key={f}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={L - 12} y={y(v) + 4} textAnchor="end" fill="var(--muted-foreground)" fontSize="11">{analysisNumber(v, 0)}</text></g>; })}
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeDasharray="4 5" />
      {[minX, (minX + maxX) / 2, maxX].map(v => <text key={v} x={x(v)} y={H - 24} textAnchor="middle" fill="var(--muted-foreground)" fontSize="11">{analysisNumber(v)}</text>)}
      <text x={L} y={15} fill="var(--muted-foreground)" fontSize="11">K/Z · USD</text>
      <text x={W - R} y={H - 4} textAnchor="end" fill="var(--muted-foreground)" fontSize="11">Dayanak fiyatı · USD / birim</text>
      {series.map((values, index) => {
        let drawing = false;
        const d = values.map(p => { if (p.y === null) { drawing = false; return ''; } const cmd = drawing ? 'L' : 'M'; drawing = true; return `${cmd}${x(p.x).toFixed(2)},${y(p.y).toFixed(2)}`; }).join(' ');
        return <g key={index}><path d={d} fill="none" stroke={colors[index % colors.length]} strokeWidth="2.4" />{values.filter(p => p.y !== null).map(p => <circle key={p.x} cx={x(p.x)} cy={y(p.y!)} r="2.5" fill={colors[index % colors.length]}><title>{results[index].label} · {analysisNumber(p.x)} · {analysisMoney(p.y!)}</title></circle>)}</g>;
      })}
    </svg></div>
    <p className="analysis-footnote">Grafikte taranan aralık teorik maksimum kayıp değildir. Kapsam dışı noktalarda çizgi kesilir.</p>
  </div>;
}

export function PositionAnalysisView({ result, compact = false }: { result: PositionAnalysis; compact?: boolean }) {
  const [metric, setMetric] = useState<'pnl' | 'delta' | 'gamma'>('pnl');
  const [date, setDate] = useState(result.dates[0]);
  const dateIndex = Math.max(0, result.dates.indexOf(date));
  const unit = ['XAU', 'XAG'].includes(result.quotes[0].product) ? 'ons' : 'adet';
  const limitText = (v: number | null) => v === null ? 'Teorik olarak sınırsız' : analysisMoney(v);
  return <div className={`position-analysis-view ${compact ? 'is-compact' : ''}`}>
    <div className="analysis-summary">
      <div><span>Net model prim akışı</span><strong>{analysisMoney(result.modelCashflow)}</strong><strong>%{analysisNumber(result.modelCashflowPct)}</strong><small>+ tahsilat / − ödeme · referans nominal</small><small>K/Z başlangıç prim akışı: {analysisMoney(result.entryCashflow)}</small></div>
      <div><span>Pozisyon deltası</span><strong>{analysisNumber(result.delta, 3)} {unit}</strong><small>{Math.abs(result.delta) < 1e-8 ? 'Mevcut modelde delta nötr' : `Delta nötrleştirme: ${result.delta > 0 ? 'satış' : 'alış'} ${analysisNumber(Math.abs(result.delta), 3)} ${unit}`}</small></div>
      <div><span>Vade sonu azami kayıp</span><strong>{result.limits ? limitText(result.limits.maxLoss) : 'Ortak vade yok'}</strong><small>{result.limits ? 'S ≥ 0 · bütün fiyat seviyeleri' : 'Farklı vadeler ortak tarihte değerlenir'}</small></div>
      <div><span>Vade sonu azami kazanç</span><strong>{result.limits ? limitText(result.limits.maxProfit) : 'Ortak vade yok'}</strong><small>{result.limits?.breakevens.length ? `Başabaş: ${result.limits.breakevens.map(x => analysisNumber(x)).join(' / ')}` : result.limits?.flatZeroRanges.length ? 'Sıfır K/Z aralığı var' : 'Başabaş noktası yok / tanımsız'}</small></div>
    </div>
    {!compact && <div className="analysis-panel"><div className="analysis-panel-head"><div><p className="desk-eyebrow">BİRLEŞİK POZİSYON</p><h2>Fiyat değişince ne olur?</h2></div><label className="desk-field">Senaryo tarihi<select value={result.dates[dateIndex]} onChange={e => setDate(e.target.value)}>{result.dates.map(d => <option key={d}>{d}</option>)}</select></label></div><PositionCurve results={[result]} dateIndex={dateIndex} /></div>}
    <section className="analysis-panel">
      <div className="analysis-panel-head"><div><p className="desk-eyebrow">FİYAT × TARİH</p><h2>{metric === 'pnl' ? 'Kâr / zarar haritası' : `${metric === 'delta' ? 'Delta' : 'Gamma'} risk haritası`}</h2></div><div className="desk-segments">{(['pnl', 'delta', 'gamma'] as const).map(m => <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>{m === 'pnl' ? 'K/Z' : m === 'delta' ? 'Delta' : 'Gamma'}</button>)}</div></div>
      <div className="analysis-table-scroll"><table className="analysis-heatmap"><caption className="sr-only">{result.label}: fiyat ve tarihe göre {metric}; bütün yönler müşteri açısından</caption><thead><tr><th scope="col">Fiyat / şok</th>{result.dates.map(d => <th scope="col" key={d}>{d}<small>{d === result.firstExpiry ? result.allSameExpiry ? 'Vade sonu' : 'İlk vade' : d === result.valuationDate ? 'Bugün' : 'Model senaryosu'}</small></th>)}</tr></thead><tbody>
        {[...result.rows].reverse().map(row => <tr key={row.movePct}><th scope="row">{analysisNumber(row.spot)}<small>{row.movePct > 0 ? '+' : ''}{row.movePct}%</small></th>{row.cells.map((cell, i) => {
          const value = cell[metric];
          return <td key={i} title={cell.reason ?? (value === null ? 'Vade tarihinde delta/gamma gösterilmez.' : `${result.label} · ${row.movePct}% · ${result.dates[i]}`)} className={value === null ? 'heat-missing' : value > 0 ? 'heat-positive' : value < 0 ? 'heat-negative' : 'heat-neutral'}>
            {value === null ? <span aria-label={cell.reason ?? 'Vade tarihinde risk duyarlılığı tanımsız'}>—</span> : <><strong>{analysisNumber(value, metric === 'gamma' ? 5 : metric === 'delta' ? 3 : 2)}</strong>{metric === 'pnl' && <small>%{analysisNumber(cell.pnlPct!)} · USD</small>}</>}
          </td>;
        })}</tr>)}
      </tbody></table></div>
      <p className="analysis-footnote">{metric === 'pnl' ? 'Yüzde bazı: ' + analysisMoney(result.nominal) + ' referans nominal. ' : `Delta: ${unit}. Gamma: ${unit} / (USD/birim). Motorun yerel Greeks değerleri; her senaryoda smile yeniden okunur. `}{result.missingCells > 0 ? `${result.missingCells} hücrede eğri kapsamı yetersiz; fiyat uydurulmadı.` : 'Bütün hücreler mevcut motorla hesaplandı.'}</p>
    </section>
    <details className="analysis-assumptions"><summary>Veri, işlem bacakları ve senaryo varsayımları</summary><p>{result.quotes[0].product} · Spot: {result.quotes[0].spotSource} · Eğri: {result.quotes[0].surfaceAt} · Değerleme: {result.valuationDate}</p><ul>{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul><div className="analysis-table-scroll"><table><thead><tr><th>Yön / tip</th><th>Miktar</th><th>Strike</th><th>Vade</th><th>Model primi</th><th>K/Z referansı · USD/birim</th></tr></thead><tbody>{result.quotes.map((q, i) => <tr key={i}><td>{q.position} {q.type}</td><td>{analysisNumber(q.inputs.contractSize)} {unit}</td><td>{analysisNumber(q.inputs.strike)}</td><td>{q.inputs.expiryDate}</td><td>{analysisMoney(q.premiumTotal)}</td><td>{analysisNumber(result.entryPremiums[i], 4)}</td></tr>)}</tbody></table></div></details>
  </div>;
}
