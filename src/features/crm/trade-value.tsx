import type { TradeValuation } from '@/lib/pricing/trade-valuation';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';

export function TradeValue({ value, field }: { value?: TradeValuation; field: 'positionValue' | 'pnl' }) {
  if (!value || value.state !== 'valued') return <span className="trade-value-missing">—<small>{value?.state === 'settled' ? 'Sonuçlanmış' : value?.reason ?? 'Değerleme yok'}</small></span>;
  const amount = value[field];
  return <span title={field === 'positionValue' ? 'Prim hariç · pozitif: varlık / negatif: yükümlülük' : 'Giriş primi dahil · müşterinin gerçekleşmemiş kâr/zararı'} className={field === 'pnl' ? amount! >= 0 ? 'trade-value-profit' : 'trade-value-loss' : undefined}>{formatMoney(amount!)}</span>;
}

export function ValuationDetails({ values }: { values: Record<string, TradeValuation> }) {
  const all = Object.values(values).filter(v => v.state === 'valued');
  if (!all.length) {
    const reasons = [...new Set(Object.values(values).filter(v => v.state === 'unavailable').map(v => v.reason).filter(Boolean))];
    return reasons.length ? <p className="valuation-data-age">{reasons.join(' ')}</p> : null;
  }
  const warnings = [...new Set(all.flatMap(v => v.warnings))];
  const dates = [...new Set(all.map(v => v.surfaceAt ? formatDate(v.surfaceAt) : 'Tarih yok'))].join(' / ');
  return <><p className="valuation-data-age">Endikatif değerleme: {formatDate(all[0].valuationDate)} · IV yüzeyi: {dates}</p>
    {warnings.filter(w => /^(Spot yenilenemedi|Yüzey verisi)/.test(w)).map(w => <p className="valuation-data-age" key={w}>{w}</p>)}
    <details className="workspace-notes valuation-details"><summary>Değerleme ve veri ayrıntıları</summary>
    <p className="workspace-muted">Güncel K/Z = prim hariç pozisyon değeri + giriş nakit akışı. Alışta giriş primi düşülür; satışta alınan prim eklenir. Endikatif model değeri · ACT/365.</p>
    {[...new Set(all.map(v => `Spot: ${v.spotAt ? formatDateTime(v.spotAt) : 'Tarih yok'} · Yüzey: ${v.surfaceAt ? formatDate(v.surfaceAt) : 'Tarih yok'}`))].map(text => <p className="workspace-muted" key={text}>{text}</p>)}
    {warnings.map(w => <p className="workspace-muted" key={w}>{w}</p>)}
  </details></>;
}
