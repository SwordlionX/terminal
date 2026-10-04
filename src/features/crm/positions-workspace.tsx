"use client";
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Customer, Trade } from '@/types';
import { activeTrade, metalProduct, tradeLeg } from '@/lib/workspace';
import { WorkspaceContext, AskAssistant } from '@/components/workspace-context';
import { AnalysisWorkspace } from '@/features/pricing/analysis-workspace';
import { useMarketData } from '@/store/marketData';
import { analysisMoney, analysisNumber } from '@/features/pricing/position-analysis-view';

function SavedPositionAnalysis({ trades }: { trades: Trade[] }) {
  const product = metalProduct(trades[0].underlying)!;
  const currentProduct = useMarketData(s => s.product);
  useEffect(() => {
    const md = useMarketData.getState();
    if (md.product !== product) md.setProduct(product, md.spot, md.lease, md.vol);
    md.setField('tradeDate', new Date().toISOString().slice(0, 10));
    md.setField('manualSpot', false); md.setField('manualVol', false);
  }, [product]);
  if (currentProduct !== product) return <p className="workspace-empty">Seçili ürünün eğrisi yükleniyor…</p>;
  return <AnalysisWorkspace initialLegs={trades.map(tradeLeg)} title="Seçili pozisyonun analizi" />;
}

export function PositionsWorkspace({ trades, customers, initialTrade, initialCustomer, archive = false, settlements = [] }: { trades: Trade[]; customers: Pick<Customer, 'id' | 'companyName'>[]; initialTrade?: string; initialCustomer?: string; archive?: boolean; settlements?: { id: string; closedAt: string | null; expirySpot: number | null }[] }) {
  const [filter, setFilter] = useState(archive || (initialTrade && trades.some(t => t.id === initialTrade && !activeTrade(t))) ? 'archive' : 'open'), [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>(initialTrade ? [initialTrade] : []);
  const pathname = usePathname();
  const names = useMemo(() => new Map(customers.map(c => [c.id, c.companyName])), [customers]);
  const today = new Date().toISOString().slice(0, 10);
  const matches = useMemo(() => trades.filter(t => {
    const days = (Date.parse(t.expiryDate) - Date.parse(today)) / 86400000;
    const status = filter === 'archive' ? !activeTrade(t) : filter === 'upcoming' ? activeTrade(t) && days <= 14 : activeTrade(t);
    return status && (!initialCustomer || t.customerId === initialCustomer) && `${names.get(t.customerId)} ${t.id} ${t.underlying} ${t.type} ${t.position}`.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr'));
  }), [trades, names, filter, today, search, initialCustomer]);
  const selected = trades.filter(t => selectedIds.includes(t.id) && matches.some(m => m.id === t.id));
  const choose = (trade: Trade, combine = false) => {
    const next = combine ? selectedIds.includes(trade.id) ? selectedIds.filter(id => id !== trade.id) : [...selectedIds, trade.id] : [trade.id];
    if (next.length > 8) return;
    setSelectedIds(next);
    const url = new URL(window.location.href); if (next.length) url.searchParams.set('trade', next[0]); else url.searchParams.delete('trade');
    window.history.replaceState(null, '', url.pathname + url.search);
  };
  const compatible = selected.length > 0 && selected.every(t => t.customerId === selected[0].customerId && metalProduct(t.underlying) === metalProduct(selected[0].underlying) && metalProduct(t.underlying) && !t.barrierType && activeTrade(t) && t.expiryDate.slice(0, 10) > today);
  const premium = selected.reduce((s, t) => s + (t.position === 'Short' ? 1 : -1) * t.premium, 0);
  const nominal = selected.reduce((s, t) => s + t.spot * t.contractSize, 0);
  return <div>
    <WorkspaceContext area="positions" label={selected.length ? `${names.get(selected[0].customerId) ?? 'Müşteri'} · ${selected.length} işlem` : 'Pozisyon masası · işlem seçilmedi'} customerId={selected[0]?.customerId} tradeIds={selected.map(t => t.id)} />
    <div className="workspace-heading"><div><h1>Pozisyon masası</h1></div><Link href="/pricing/position-analysis" className="desk-link">Yeni senaryo oluştur ↗</Link></div>
    <div className="workspace-toolbar"><div className="workspace-tabs" style={{ margin: 0 }}>{[['open', 'Açık işlemler'], ['upcoming', '14 gün / vadesi gelen'], ['archive', 'Vade sonuçları']].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setSelectedIds([]); }}>{label}</button>)}</div><input className="workspace-search" aria-label="Pozisyonlarda ara" placeholder="Müşteri, işlem veya ürün ara…" value={search} onChange={e => setSearch(e.target.value)} /></div>
    {initialCustomer && <p className="workspace-muted">Müşteri filtresi: {names.get(initialCustomer) ?? initialCustomer} · <Link className="desk-link" href={pathname}>Bütün müşteriler ↗</Link></p>}
    <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>Birleştir</th><th>Müşteri / işlem</th><th>Ürün / yön</th><th className="number">Strike</th><th>Vade</th><th className="number">Miktar · ons</th><th className="number">Giriş primi · USD / %</th><th>Durum</th></tr></thead><tbody>{matches.map(t => <tr key={t.id} data-selected={selectedIds.includes(t.id)}><td><input type="checkbox" aria-label={`${t.id} işlemini birleştir`} checked={selectedIds.includes(t.id)} onChange={() => choose(t, true)} /></td><td><button onClick={() => choose(t)}>{names.get(t.customerId) ?? 'Müşteri'}<small>{t.id}</small></button></td><td>{t.underlying}<small>{t.position === 'Short' ? 'Satış' : 'Alış'} · {t.type}{t.barrierType ? ' · Bariyer' : ''}</small></td><td className="number">{analysisNumber(t.strike)}</td><td>{t.expiryDate.slice(0, 10)}</td><td className="number">{analysisNumber(t.contractSize)}</td><td className="number">{analysisMoney(t.premium)}<small>{t.spot * t.contractSize > 0 ? `%${analysisNumber(t.premium / (t.spot * t.contractSize) * 100)}` : '—'} · giriş spot nominali</small></td><td>{t.status === 'Closed' ? 'Vade sonuçlandı' : t.status === 'Expired' ? 'Vadesi geldi' : t.expiryDate.slice(0, 10) <= today ? 'Vade sonucu bekleniyor' : 'Açık'}</td></tr>)}</tbody></table></div>
    {!matches.length && <p className="workspace-empty">Bu filtrede kayıt yok.</p>}
    <p className="workspace-muted" style={{ margin: '16px 0' }}>Birleşik analiz için aynı müşterinin ve metalin işlemlerini seç.</p>
    {selected.length > 0 && <section id="position-detail"><div className="workspace-heading"><div><h1>{names.get(selected[0].customerId)} / {selected[0].underlying}</h1><p>{selected.length} seçili bacak · müşteri perspektifi</p></div><AskAssistant text="Seçili kayıtlı pozisyonu oku. Geçmiş primini koruyarak fiyat ve tarih kâr zarar haritasını göster, ardından uygun koruma alternatiflerini değerlendir." /></div><div className="workspace-metrics"><div><span>Geçmiş net prim · + alınan / − ödenen</span><strong>{analysisMoney(premium)}</strong></div><div><span>Giriş spot nominalinin yüzdesi</span><strong>{nominal > 0 ? `%${analysisNumber(premium / nominal * 100)}` : '—'}</strong></div><div><span>Sözleşme durumu</span><strong style={{ fontSize: 17 }}>Avrupa tipi</strong><small>Ters işlem mevcut sözleşmeyi sona erdirmez.</small></div></div>
      {selected.filter(t => t.status === 'Closed').map(t => { const result = settlements.find(r => r.id === t.id); return <div key={t.id} className="workspace-panel" style={{ marginBottom: 16 }}><h2>{t.id} / gerçekleşen vade sonucu</h2><div className="workspace-metrics"><div><span>Gerçekleşen K/Z</span><strong>{t.pnl === null ? 'Kayıt yok' : analysisMoney(t.pnl)}</strong></div><div><span>Vade sonu spotu</span><strong>{result?.expirySpot == null ? 'Kayıt yok' : analysisNumber(result.expirySpot)}</strong></div><div><span>Sonuç kayıt zamanı</span><strong style={{ fontSize: 14 }}>{result?.closedAt ? new Date(result.closedAt).toLocaleString('tr-TR') : 'Eski kayıtta metadata yok'}</strong></div></div></div>; })}
      {compatible ? <SavedPositionAnalysis key={selected.map(t => t.id).join(',')} trades={selected} /> : <div className="desk-policy">{selected.some(t => t.barrierType) ? 'Bariyerli işlem için geçmiş bariyer gözlemi gerekli. Vanilya model analizi uygulanmaz.' : selected.some(t => !activeTrade(t) || t.expiryDate.slice(0, 10) <= today) ? 'Vadesi gelen veya sonuçlanmış işlem yeniden fiyatlanmaz. Gerçekleşen sonuç ve vade kayıtlarını müşteri dosyasında inceleyebilirsin.' : 'Birleşik analiz için aynı müşteri, aynı metal ve ileri vadeli vanilya işlemleri seç.'}<p><Link className="desk-link" href={`/customers/${selected[0].customerId}?tab=trades`}>Müşteri işlem kayıtları ↗</Link></p></div>}
    </section>}
  </div>;
}
