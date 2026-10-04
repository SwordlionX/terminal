"use client";
import { useState } from 'react';
import { usePricingModel } from './use-pricing-model';
import { TradeConditions } from './trade-conditions';
import { NumberInput } from '@/components/ui/number-input';
import { searchPremium } from '@/lib/assistant/search';
import { quoteOption } from '@/lib/assistant/pricing';
import type { MarketSnapshot, PremiumUnit, Product, ScreenContext, SearchResult } from '@/lib/assistant/types';
import { ResultCard } from '@/features/assistant/result-cards';
import { useAnalysisDraft } from '@/store/analysis-draft';
import { AskAssistant } from '@/components/workspace-context';
export function TargetPremium() {
  const { md, feed } = usePricingModel(), type = useAnalysisDraft(s => s.quoteType), position = useAnalysisDraft(s => s.quotePosition);
  const [target, setTarget] = useState(5), [unit, setUnit] = useState<PremiumUnit>('pct_spot');
  const [lower, setLower] = useState(65), [upper, setUpper] = useState(135), [error, setError] = useState('');
  const [calculation, setCalculation] = useState<{ key: string; result: SearchResult } | null>(null);
  const targetBasis = { pct_spot: 'spot nominalinin yüzdesi', pct_strike: 'strike nominalinin yüzdesi', total_usd: 'USD toplam prim', usd_per_unit: 'USD / ons' }[unit];
  const assistantPrompt = `${md.product} için ${md.expiryDate} vadeli, ${md.contractSize} ons, müşteri ${position === 'Short' ? 'satışı' : 'alışı'} ${type} opsiyonunda ${target} ${targetBasis} hedefini mevcut terminal eğrisinde ara. Strike aralığı spotun yüzde ${lower}–${upper} arası. IV veya diğer piyasa girdilerini değiştirme.`;
  const key = JSON.stringify([md.product, md.contractSize, md.tradeDate, md.expiryDate, md.basis, md.manualSpot, md.manualVol, type, position, target, unit, lower, upper, feed.spot?.at, feed.surface?.curves?.id]);
  const search = () => {
    setError('');
    try {
      if (![target, lower, upper].every(Number.isFinite) || target < 0 || lower < 5 || upper > 500 || lower >= upper) throw new Error('Geçerli hedef ve spotun %5–500 aralığında artan strike sınırları gerekli.');
      if (!feed.spot || !feed.surface || feed.loading || feed.error) throw new Error('Terminal spotu ve eğrisi hazır olmalı.');
      const screen = { ...md, product: md.product as Product } as ScreenContext;
      const market: MarketSnapshot = { product: md.product as Product, spot: feed.spot.price, spotSource: feed.spot.source, spotAt: new Date(feed.spot.quoteAt ?? feed.spot.at).toISOString(), spotStale: feed.spot.stale, surface: feed.surface, surfaceSource: feed.surfaceSource };
      const tolerance = Math.max(.00001, target * .0001);
      const result = searchPremium(strike => quoteOption({ type, position, contractSize: md.contractSize, strike }, screen, market), target, unit, feed.spot.price * lower / 100, feed.spot.price * upper / 100, tolerance);
      setCalculation({ key, result });
    } catch (e) { setCalculation(null); setError(e instanceof Error ? e.message : 'Arama tamamlanamadı.'); }
  };
  return <div className="space-y-6"><div className="workspace-heading"><div><h1>Hedef prim</h1><p>Faiz, taşıma ve IV sabit kaynak eğrisinden gelir; uygun strike aranır.</p></div><AskAssistant text={assistantPrompt} /></div><TradeConditions /><section className="workspace-panel"><h2>Arama koşulları</h2><div className="workspace-toolbar"><label className="desk-field">Opsiyon<select value={type} onChange={e => useAnalysisDraft.getState().selectQuote(e.target.value as 'Call' | 'Put', position)}><option>Put</option><option>Call</option></select></label><label className="desk-field">Müşteri yönü<select value={position} onChange={e => useAnalysisDraft.getState().selectQuote(type, e.target.value as 'Long' | 'Short')}><option value="Short">Satış · prim alır</option><option value="Long">Alış · prim öder</option></select></label><label className="desk-field">Hedef prim<NumberInput aria-label="Hedef prim" value={target} onValueChange={setTarget} /></label><label className="desk-field">Prim bazı<select value={unit} onChange={e => setUnit(e.target.value as PremiumUnit)}><option value="pct_spot">% spot nominali</option><option value="pct_strike">% strike nominali</option><option value="total_usd">USD toplam</option><option value="usd_per_unit">USD / ons</option></select></label><label className="desk-field">Alt strike · spot %<NumberInput value={lower} onValueChange={setLower} /></label><label className="desk-field">Üst strike · spot %<NumberInput value={upper} onValueChange={setUpper} /></label></div><button className="desk-button desk-button-primary" onClick={search} disabled={feed.loading}>Terminal eğrisinde ara ↗</button></section>{error && <p className="desk-policy" role="status">{error}</p>}{calculation && (calculation.key === key ? <ResultCard artifact={{ kind: 'search', result: calculation.result }} /> : <p className="desk-policy">Koşullar veya veri değişti. Güncel sonuç için yeniden ara.</p>)}<p className="desk-policy">Hedefe ulaşmak için volatilite uydurulmaz. Sonuçlar tanımlı strike aralığında ve hedef toleransı içinde aranır. Bulunamazsa en yakın sonucun hedefi karşılamadığı açıkça belirtilir.</p></div>;
}
