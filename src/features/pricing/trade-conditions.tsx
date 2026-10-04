"use client";
import { useMarketData } from '@/store/marketData';
import { NumberInput } from '@/components/ui/number-input';
export function TradeConditions() {
  const md = useMarketData();
  return <section className="workspace-panel"><div className="workspace-toolbar"><div className="desk-segments">{['XAU', 'XAG'].map(p => <button key={p} aria-pressed={md.product === p} onClick={() => md.setProduct(p, md.spot, md.lease, md.vol)}>{p}</button>)}</div><label className="desk-field">Strike · USD/ons<NumberInput aria-label="Araç kullanım fiyatı" value={md.strike} onValueChange={v => md.setField('strike', v)} /></label><label className="desk-field">Miktar · ons<NumberInput aria-label="Araç işlem miktarı" value={md.contractSize} onValueChange={v => md.setField('contractSize', v)} /></label><label className="desk-field">Vade<input aria-label="Araç vadesi" type="date" value={md.expiryDate} onChange={e => md.setField('expiryDate', e.target.value)} /></label></div><p className="workspace-muted">Araçlar aynı işlem koşullarını paylaşır. Spot, faiz, taşıma ve IV terminal eğrisinden gelir.</p></section>;
}
