"use client";

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { NumberInput } from '@/components/ui/number-input';
import { usePricingModel } from './use-pricing-model';
import { analyzeEuropeanPosition, analysisDates, type AnalysisLeg } from '@/lib/pricing/position-analysis';
import { PositionAnalysisView, PositionCurve, analysisMoney, analysisNumber } from './position-analysis-view';
import { useAnalysisDraft } from '@/store/analysis-draft';
import type { MarketSnapshot, Product, ScreenContext } from '@/lib/assistant/types';
import { MANUAL_PRICING_BLOCKED } from '@/lib/assistant/policy';
import { TERMINAL_DESIGN } from '@/lib/terminal-design';

export function AnalysisWorkspace() {
  const { md, feed } = usePricingModel();
  const seed = useAnalysisDraft.getState();
  const [draft, setDraft] = useState<{ product: string; legs: AnalysisLeg[] }>(() => ({ product: md.product,
    legs: seed.product === md.product && seed.legs ? seed.legs : [{ option: { type: 'Put', position: 'Short', strike: md.strike, expiryDate: md.expiryDate, contractSize: md.contractSize } }] }));
  const [comparison, setComparison] = useState(false);
  const [hedgeStrike, setHedgeStrike] = useState(Number((md.strike * .95).toFixed(2)));
  const [hedgeType, setHedgeType] = useState<'Call' | 'Put'>('Put');
  const [hedgeQuantity, setHedgeQuantity] = useState(md.contractSize);
  const [newExpiry, setNewExpiry] = useState('');
  const [curveDate, setCurveDate] = useState('');
  const legs = draft.legs;
  const unit = ['XAU', 'XAG'].includes(md.product) ? 'ons' : 'adet';
  const view = useMemo(() => {
    if (draft.product !== md.product) return { error: 'Ürün değişti. Bu pozisyonu yeni ürüne taşımak için ekrandan yeni pozisyon oluşturun.', results: [], failed: [] };
    if (feed.loading) return { error: 'Terminal eğrisi yükleniyor…', results: [], failed: [] };
    if (md.manualSpot || md.manualVol) return { error: MANUAL_PRICING_BLOCKED, results: [], failed: [] };
    const screen = { ...md, product: md.product as Product } as ScreenContext;
    const market: MarketSnapshot = { product: md.product as Product, spot: feed.spot?.price ?? null,
      spotSource: feed.spot?.source ?? '', spotAt: feed.spot ? new Date(feed.spot.quoteAt ?? feed.spot.at).toISOString() : null,
      spotStale: feed.spot?.stale, surface: feed.surface, surfaceSource: feed.surfaceSource, error: feed.error ?? undefined };
    const plans: { label: string; legs: AnalysisLeg[]; added: AnalysisLeg[] }[] = [{ label: 'Mevcut pozisyon', legs, added: [] }];
    if (comparison) {
      const hedge: AnalysisLeg = { option: { type: hedgeType, position: 'Long', strike: hedgeStrike, expiryDate: legs[0].option.expiryDate ?? md.expiryDate, contractSize: hedgeQuantity } };
      const opposite = legs.map(l => ({ option: { ...l.option, position: l.option.position === 'Long' ? 'Short' as const : 'Long' as const } }));
      plans.push({ label: 'Koruma bacağı ekle', legs: [...legs, hedge], added: [hedge] }, { label: 'Ters işlemle dengele', legs: [...legs, ...opposite], added: opposite });
      if (newExpiry) {
        const replacement = legs.map(l => ({ option: { ...l.option, expiryDate: newExpiry } }));
        plans.push({ label: 'Ters işlem + yeni vade', legs: [...legs, ...opposite, ...replacement], added: [...opposite, ...replacement] });
      }
    }
    try {
      // Original expiry remains the common horizon, including in the new-tenor plan.
      const firstExpiry = legs.map(l => l.option.expiryDate ?? md.expiryDate).sort()[0];
      const dates = analysisDates(md.tradeDate, firstExpiry);
      const results = [], failed = [];
      for (const plan of plans) {
        try {
          if (plan.label === 'Ters işlem + yeni vade' && newExpiry <= legs.map(l => l.option.expiryDate ?? md.expiryDate).sort().at(-1)!) throw new Error('Yeni vade, bütün mevcut bacakların vadelerinden sonra olmalı.');
          const result = analyzeEuropeanPosition(screen, market, plan.legs, plan.label, dates, undefined, legs[0].option.contractSize);
          const extra = plan.added.length ? analyzeEuropeanPosition(screen, market, plan.added, plan.label, [md.tradeDate], [0], legs[0].option.contractSize).modelCashflow : 0;
          results.push({ result, extra });
        } catch (error) { failed.push({ label: plan.label, error: error instanceof Error ? error.message : 'Alternatif hesaplanamadı.' }); }
      }
      return { error: results[0]?.result.label === 'Mevcut pozisyon' ? null : failed[0]?.error ?? 'Pozisyon hesaplanamadı.', results, failed };
    } catch (error) { return { error: error instanceof Error ? error.message : 'Analiz hesaplanamadı.', results: [], failed: [] }; }
  }, [md, feed, draft, legs, comparison, hedgeStrike, hedgeType, hedgeQuantity, newExpiry]);
  const base = view.results[0]?.result;
  const dateIndex = base ? Math.max(0, base.dates.indexOf(curveDate)) : 0;
  const updateLeg = (index: number, patch: Partial<AnalysisLeg>) => setDraft(d => ({ ...d, legs: d.legs.map((l, i) => i === index ? { ...l, ...patch } : l) }));
  const updateOption = (index: number, patch: Partial<AnalysisLeg['option']>) => updateLeg(index, { option: { ...legs[index].option, ...patch } });
  return <div className="desk-workspace analysis-workspace">
    <div className="desk-hero"><div><p className="desk-eyebrow">{TERMINAL_DESIGN === 'meridian' ? 'MERIDIAN / POZİSYON MASASI' : 'TERMINAL X / SCENARIO DESK'}</p><h1>Pozisyonu bütün olarak gör.</h1><p>Avrupa tipi vanilya opsiyonlar · müşteri perspektifi · {md.product}</p></div><Link className="desk-link" href="/">Fiyatlamaya dön ↗</Link></div>
    <div className="desk-policy">Vade öncesi kullanım veya otomatik kapatma yok. Hedge ve ters işlem yeni bacaklar ekler; mevcut sözleşmenin yükümlülükleri devam eder.</div>
    <section className="analysis-panel"><div className="analysis-panel-head"><div><p className="desk-eyebrow">İŞLEM KOŞULLARI</p><h2>Müşterinin pozisyonu</h2></div><button className="desk-button" onClick={() => setDraft({ product: md.product, legs: [{ option: { type: 'Put', position: 'Short', strike: md.strike, expiryDate: md.expiryDate, contractSize: md.contractSize } }] })}>Ekrandan yeni pozisyon</button></div>
      <div className="analysis-legs">{legs.map((leg, i) => <div className="analysis-leg" key={i}>
        <label className="desk-field">Tip<select aria-label={`Bacak ${i + 1} tipi`} value={leg.option.type} onChange={e => updateOption(i, { type: e.target.value as 'Call' | 'Put' })}><option>Call</option><option>Put</option></select></label>
        <label className="desk-field">Müşteri yönü<select aria-label={`Bacak ${i + 1} yönü`} value={leg.option.position} onChange={e => updateOption(i, { position: e.target.value as 'Long' | 'Short' })}><option value="Short">Satış · prim alır</option><option value="Long">Alış · prim öder</option></select></label>
        <label className="desk-field">Strike<NumberInput aria-label={`Bacak ${i + 1} strike`} value={leg.option.strike ?? md.strike} onValueChange={strike => updateOption(i, { strike })} /></label>
        <label className="desk-field">Vade<input type="date" aria-label={`Bacak ${i + 1} vade`} value={leg.option.expiryDate ?? md.expiryDate} onChange={e => updateOption(i, { expiryDate: e.target.value })} /></label>
        <label className="desk-field">Miktar · {unit}<NumberInput aria-label={`Bacak ${i + 1} miktar`} value={leg.option.contractSize ?? md.contractSize} onValueChange={contractSize => updateOption(i, { contractSize })} /></label>
        <div className="desk-field"><label className="desk-check"><input type="checkbox" checked={leg.entryPremiumPerUnit !== undefined} onChange={e => updateLeg(i, { entryPremiumPerUnit: e.target.checked ? 0 : undefined })} />Gerçekleşen prim</label>{leg.entryPremiumPerUnit !== undefined ? <NumberInput aria-label={`Bacak ${i + 1} geçmiş birim prim`} value={leg.entryPremiumPerUnit} onValueChange={entryPremiumPerUnit => updateLeg(i, { entryPremiumPerUnit })} /> : <small>Bugünkü model primi referans</small>}</div>
        <button className="desk-icon-button" aria-label={`Bacak ${i + 1} sil`} disabled={legs.length === 1} onClick={() => setDraft(d => ({ ...d, legs: d.legs.filter((_, j) => j !== i) }))}>×</button>
      </div>)}</div>
      <div className="analysis-panel-head"><button className="desk-button" disabled={legs.length >= 8} onClick={() => setDraft(d => ({ ...d, legs: [...d.legs, { option: { type: 'Put', position: 'Long', strike: Number((md.strike * .95).toFixed(2)), expiryDate: d.legs[0].option.expiryDate ?? md.expiryDate, contractSize: md.contractSize } }] }))}>+ Bacak ekle</button><span className="desk-muted">Geçmiş prim USD / {unit}; piyasa IV/faiz/kira girdisi değildir.</span></div>
    </section>
    <section className="analysis-panel"><div className="analysis-panel-head"><div><p className="desk-eyebrow">ALTERNATİFLER</p><h2>Hedge ve yeni vade</h2></div><label className="desk-check"><input type="checkbox" checked={comparison} onChange={e => setComparison(e.target.checked)} />Karşılaştırmayı aç</label></div>
      {comparison && <><div className="analysis-compare-controls"><label className="desk-field">Koruma opsiyonu<select value={hedgeType} onChange={e => setHedgeType(e.target.value as 'Call' | 'Put')}><option>Put</option><option>Call</option></select></label><label className="desk-field">Koruma strike<NumberInput value={hedgeStrike} onValueChange={setHedgeStrike} /></label><label className="desk-field">Koruma miktarı · {unit}<NumberInput value={hedgeQuantity} onValueChange={setHedgeQuantity} /></label><label className="desk-field">İsteğe bağlı yeni vade<input type="date" value={newExpiry} onChange={e => setNewExpiry(e.target.value)} /></label></div><p className="analysis-footnote">Koruma bacağı alış yönündedir. Yeni vade karşılaştırması, mevcut bacaklara eşleşen ters işlemler ve yeni vadeli bacaklar ekler. İşlem/fesih gerçekleştirmez.</p></>}
    </section>
    {view.error ? <div role="status" className="desk-policy">{view.error}{(md.manualSpot || md.manualVol) && <button className="desk-button" onClick={() => { md.setField('manualSpot', false); md.setField('manualVol', false); }}>Otomatik kaynağa dön</button>}</div> : base && <>
      {comparison && <section className="analysis-panel"><div className="analysis-panel-head"><h2>Ortak tarihte karşılaştırma</h2><label className="desk-field">Senaryo tarihi<select aria-label="Karşılaştırma tarihi" value={base.dates[dateIndex]} onChange={e => setCurveDate(e.target.value)}>{base.dates.map(d => <option key={d}>{d}</option>)}</select></label></div><PositionCurve results={view.results.map(x => x.result)} dateIndex={dateIndex} />
        <div className="analysis-table-scroll"><table><thead><tr><th>Alternatif</th><th>Yeni prim akışı · USD / %</th><th>Delta · {unit}</th><th>Azami kayıp · ortak vade</th><th>Başabaş · ortak vade</th></tr></thead><tbody>{view.results.map(({ result, extra }) => <tr key={result.label}><th scope="row">{result.label}</th><td>{analysisMoney(extra)} / %{analysisNumber(extra / base.nominal * 100)}</td><td>{analysisNumber(result.delta, 3)}</td><td>{!result.limits ? 'Ortak vade yok' : result.limits.maxLoss === null ? 'Teorik olarak sınırsız' : analysisMoney(result.limits.maxLoss)}</td><td>{!result.limits ? 'Ortak vade yok' : result.limits.breakevens.length ? result.limits.breakevens.map(x => analysisNumber(x)).join(' / ') : result.limits.flatZeroRanges.length ? 'Sıfır K/Z aralığı' : 'Yok'}</td></tr>)}</tbody></table></div><p className="analysis-footnote">+ yeni tahsilat / − yeni ödeme. Mevcut işlemin geçmiş primi yeniden tahsil edilmiş sayılmaz. Ters işlem spread, teminat ve karşı taraf riskini ortadan kaldırmaz.</p>
      </section>}
      <PositionAnalysisView result={base} />
    </>}
    {view.failed.filter(x => x.label !== 'Mevcut pozisyon').map(x => <p className="desk-policy" key={x.label}>{x.label}: {x.error}</p>)}
    <div className="desk-policy">Kaynak eğriyle endikatif model analizi. USD faiz ve metal taşıma eğrisinin kaynak/konvansiyon düzeltmesi henüz tamamlanmadı; bu ekran banka tarafından onaylanmış kotasyon üretmez.</div>
  </div>;
}
