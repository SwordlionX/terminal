"use client";

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { NumberInput } from '@/components/ui/number-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { addManualTradeAction } from '@/app/customers/[id]/actions';
import { quoteOption } from '@/lib/assistant/pricing';
import type { MarketSnapshot, Product, Quote, ScreenContext } from '@/lib/assistant/types';
import { expiryPayoffLimits } from '@/lib/pricing/position-analysis';
import { useAnalysisDraft } from '@/store/analysis-draft';
import { TERMINAL_DESIGN } from '@/lib/terminal-design';
import { usePricingModel } from './use-pricing-model';
import { SmileChart } from './smile-chart';
import { VolatilityTermChart } from './volatility-term-chart';
import { analysisMoney, analysisNumber } from './position-analysis-view';

function BookQuote({ quote }: { quote: Quote | null }) {
  const [open, setOpen] = useState(false), [customers, setCustomers] = useState<{ id: string; companyName: string }[]>([]);
  const [customer, setCustomer] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const show = async () => {
    setOpen(true); setMessage('');
    try { const r = await fetch('/api/customers'); if (!r.ok) throw new Error(); const data = await r.json(); if (!Array.isArray(data)) throw new Error(); setCustomers(data); }
    catch { setMessage('Müşteri listesi alınamadı.'); }
  };
  const save = async () => {
    if (!quote || !customer || busy) return;
    setBusy(true); setMessage('');
    try {
      await addManualTradeAction(customer, { tradeDate: quote.inputs.tradeDate, expiryDate: quote.inputs.expiryDate,
        underlying: quote.product, type: quote.type, position: quote.position, spot: quote.inputs.spot,
        strike: quote.inputs.strike, volatility: quote.effectiveVol / 100, contractSize: quote.inputs.contractSize, premium: quote.premiumTotal });
      setMessage('İşlem kaydı oluşturuldu.');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Kayıt oluşturulamadı.'); }
    finally { setBusy(false); }
  };
  return <><button className="desk-button" disabled={!quote} onClick={show}>Müşteriye kaydet ↗</button><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>İşlemi müşteriye kaydet</DialogTitle><DialogDescription>Terminalin hesapladığı koşullarla kayıt oluşturur; emir göndermez.</DialogDescription></DialogHeader><label className="desk-field">Müşteri<select value={customer} onChange={e => setCustomer(e.target.value)}><option value="">Müşteri seçin</option>{customers.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}</select></label>{quote && <p className="desk-muted">{quote.position} {quote.type} · {quote.product} · {quote.inputs.contractSize} birim · {quote.inputs.expiryDate} · {analysisMoney(quote.premiumTotal)}</p>}<button className="desk-button desk-button-primary" disabled={!customer || !quote || busy || message === 'İşlem kaydı oluşturuldu.'} onClick={save}>{busy ? 'Kaydediliyor…' : 'Kaydı oluştur'}</button><p role="status">{message}</p></DialogContent></Dialog></>;
}

export function TerminalWorkspace() {
  const { md, feed } = usePricingModel(); const router = useRouter();
  const type = useAnalysisDraft(s => s.quoteType), position = useAnalysisDraft(s => s.quotePosition);
  const selectQuote = useAnalysisDraft(s => s.selectQuote);
  const setType = (next: 'Call' | 'Put') => selectQuote(next, position);
  const setPosition = (next: 'Long' | 'Short') => selectQuote(type, next);
  const [curveTab, setCurveTab] = useState<'smile' | 'term'>('smile');
  const pricing = useMemo(() => {
    try {
      if (feed.loading) return { quote: null, error: 'Terminal verisi yükleniyor…' };
      const market: MarketSnapshot = { product: md.product as Product, spot: feed.spot?.price ?? null,
        spotAt: feed.spot ? new Date(feed.spot.quoteAt ?? feed.spot.at).toISOString() : null, spotSource: feed.spot?.source ?? '',
        spotStale: feed.spot?.stale, surface: feed.surface, surfaceSource: feed.surfaceSource };
      const quote = quoteOption({ type, position, strike: md.strike, expiryDate: md.expiryDate, contractSize: md.contractSize }, { ...md, product: md.product as Product } as ScreenContext, market);
      return { quote, error: null };
    } catch (e) { return { quote: null, error: e instanceof Error ? e.message : 'Fiyatlama yapılamadı.' }; }
  }, [md, feed, type, position]);
  const q = pricing.quote, unit = ['XAU', 'XAG'].includes(md.product) ? 'ons' : 'adet';
  const days = q ? (Date.parse(q.inputs.expiryDate) - Date.parse(q.inputs.tradeDate)) / 86400000 : 0;
  const fwd = q?.forward ?? (q ? q.inputs.spot * Math.exp((q.inputs.rate - q.inputs.lease) / 100 * days / q.inputs.basis) : 0);
  const limits = q ? expiryPayoffLimits([q], [q.premiumPerUnit]) : null;
  const analyze = () => {
    useAnalysisDraft.getState().seed(md.product, [{ option: { type, position, strike: md.strike, expiryDate: md.expiryDate, contractSize: md.contractSize } }]);
    router.push('/pricing/position-analysis');
  };
  const ticket = <section className="desk-ticket analysis-panel"><div className="analysis-panel-head"><p className="desk-eyebrow">İŞLEM KOŞULLARI</p><span className="desk-muted">Avrupa tipi</span></div>
    <div className="desk-product-tabs">{(['XAU', 'XAG'] as const).map(p => <button key={p} aria-pressed={md.product === p} onClick={() => md.setProduct(p, md.spot, md.lease, md.vol)}>{p}<small>{p === 'XAU' ? 'ALTIN' : 'GÜMÜŞ'}</small></button>)}</div>
    <div className="desk-ticket-fields"><label className="desk-field">Opsiyon<select value={type} onChange={e => setType(e.target.value as 'Call' | 'Put')}><option>Put</option><option>Call</option></select></label><label className="desk-field">Müşteri yönü<select value={position} onChange={e => setPosition(e.target.value as 'Long' | 'Short')}><option value="Short">Satış · prim alır</option><option value="Long">Alış · prim öder</option></select></label><label className="desk-field">Miktar · {unit}<NumberInput aria-label="İşlem miktarı" value={md.contractSize} onValueChange={n => md.setField('contractSize', n)} /></label><label className="desk-field">Kullanım fiyatı · USD/{unit}<NumberInput aria-label="Kullanım fiyatı" value={md.strike} onValueChange={n => md.setField('strike', n)} /></label><label className="desk-field">Değerleme tarihi<input type="date" value={md.tradeDate} onChange={e => md.setField('tradeDate', e.target.value)} /></label><label className="desk-field">Vade<input type="date" value={md.expiryDate} onChange={e => md.setField('expiryDate', e.target.value)} /></label><label className="desk-field">Gün bazı<select value={md.basis} onChange={e => md.setField('basis', Number(e.target.value))}><option value="365">ACT / 365</option><option value="360">ACT / 360</option></select></label></div>
    <p className="analysis-footnote">Spot, faiz, taşıma ve IV terminal kaynağından gelir. Manuel piyasa girdisi, eğri–fiyat tutarlılığını bozar.</p>
    {(md.manualSpot || md.manualVol) && <button className="desk-button" onClick={() => { md.setField('manualSpot', false); md.setField('manualVol', false); }}>Otomatik kaynağa dön</button>}
  </section>;
  const quote = <section className="desk-quote analysis-panel"><div className="analysis-panel-head"><p className="desk-eyebrow">{md.product} / MÜŞTERİ {position === 'Short' ? 'SATIŞI' : 'ALIŞI'} / {type.toUpperCase()}</p><span className="desk-tag">ENDİKATİF</span></div>
    <div className="desk-quote-values"><div><p>Müşterinin {position === 'Short' ? 'alacağı' : 'ödeyeceği'} toplam prim</p><strong>{q ? analysisNumber(q.premiumTotal) : '—'}<small> USD</small></strong><span>{q ? analysisNumber(q.premiumPerUnit, 4) : '—'} USD / {unit}</span></div><div><p>Spot nominalinin yüzdesi</p><strong>{q ? analysisNumber(q.premiumPctSpot) : '—'}<small> %</small></strong><span>Toplam prim / (spot × miktar)</span></div></div>
    {pricing.error && <p role="status" className="desk-policy">{pricing.error}</p>}
    <div className="desk-market-facts"><div><span>Terminal spotu</span><strong>{feed.spot ? analysisNumber(feed.spot.price) : '—'}</strong></div><div><span>Model forward</span><strong>{q ? analysisNumber(fwd) : '—'}</strong></div><div><span>Smile IV</span><strong>{q ? '%' + analysisNumber(q.effectiveVol) : '—'}</strong></div><div><span>Yüzey tarihi</span><strong>{feed.surface?.fetchedISO.slice(0, 10) ?? 'Veri yok'}</strong></div></div>
    {q && feed.surface?.curves && <p className="desk-muted">Seçili vade · USD faiz %{analysisNumber(q.inputs.rate * q.inputs.basis / 365, 4)} · Metal taşıması (proxy) %{analysisNumber(q.inputs.lease * q.inputs.basis / 365, 4)} · Sürekli yıllık oran / ACT {q.inputs.basis}</p>}
    <div className="desk-actions"><button className="desk-button desk-button-primary" disabled={!q} onClick={analyze}>Pozisyonu analiz et ↗</button><BookQuote quote={q} /><button className="desk-button" disabled={feed.loading} onClick={feed.refetch}>Kayıtlı veriyi oku</button></div>
    <p className="analysis-footnote">{feed.spot?.source ?? 'Spot kaynağı bekleniyor'} · {q?.volMode ?? 'IV bekleniyor'} · Model fiyatı işlem yapılabilir banka kotasyonu değildir.</p>
  </section>;
  const risk = <aside className="desk-risk analysis-panel"><p className="desk-eyebrow">RİSKİN KARŞILIĞI</p>{[['Delta', q ? analysisNumber(q.delta, 3) + ' ' + unit : '—'], ['Gamma', q ? analysisNumber(q.gamma, 5) : '—'], ['Vega / vol puanı', q ? analysisMoney(q.vega) : '—'], ['Theta / gün', q ? analysisMoney(q.theta) : '—']].map(([name, value]) => <div className="desk-risk-item" key={name}><span>{name}</span><strong>{value}</strong></div>)}<div className="desk-risk-note"><p>Vade sonu azami kayıp</p><strong>{!limits ? '—' : limits.maxLoss === null ? 'Teorik olarak sınırsız' : analysisMoney(limits.maxLoss)}</strong><p>{type === 'Put' && position === 'Short' ? 'Short put kaybı, dayanak sıfıra düştüğünde sonludur.' : type === 'Call' && position === 'Short' ? 'Korumasız short call yukarı yönlü sınırsız kayıp taşıyabilir.' : 'Long opsiyonda vade sonu azami kayıp ödenen primdir.'}</p></div></aside>;
  return <div className={`desk-workspace desk-${TERMINAL_DESIGN}`}>
    <div className="desk-hero"><div><p className="desk-eyebrow">{TERMINAL_DESIGN === 'meridian' ? 'MERIDIAN / KIYMETLİ METALLER' : 'TERMINAL X / PRECIOUS METALS DESK'}</p><h1>{TERMINAL_DESIGN === 'meridian' ? 'Opsiyon fiyatlama' : 'Opsiyon fiyatlama'}</h1><p>XAU / XAG · terminal eğrisi · müşteri perspektifi</p></div><div className="desk-hero-mark" aria-hidden="true">{TERMINAL_DESIGN === 'meridian' ? '╱╲' : 'X / 01'}</div></div>
    <div className="desk-main-grid">{ticket}{quote}    <section className="desk-curve"><div className="analysis-panel-head"><div><p className="desk-eyebrow">EĞRİYİ İNCELE</p><h2>Geniş analiz alanı</h2></div><div className="desk-segments"><button aria-pressed={curveTab === 'smile'} onClick={() => setCurveTab('smile')}>Smile</button><button aria-pressed={curveTab === 'term'} onClick={() => setCurveTab('term')}>Vade yapısı</button></div></div>
      {curveTab === 'smile' ? <SmileChart surface={feed.surface} fwd={fwd} strike={md.strike} daysToExpiry={days} valuationDate={md.tradeDate} sourceLabel={feed.surfaceSource ?? undefined} /> : <VolatilityTermChart surface={feed.surface} valuationDate={md.tradeDate} onSelect={date => md.setField('expiryDate', date)} />}
    </section>
{risk}</div>
    <div className="desk-tool-grid"><Link href="/pricing/position-analysis"><span>01 / POZİSYON</span><h2>Tek bir fiyatla kalma.</h2><p>Fiyat × tarih haritası, birleşik K/Z, delta/gamma ve hedge alternatifleri.</p></Link><Link href="/pricing/reverse-engineering"><span>02 / HEDEF</span><h2>Hedef primi değerlendir.</h2><p>Mevcut terminal araçlarıyla işlem koşullarını ve prim hedefini incele.</p></Link><Link href="/pricing/barrier"><span>03 / GELİŞMİŞ</span><h2>Bariyer ve delta hedge.</h2><p>Bariyer gözlemi, yardımcı smile ve mevcut motorun gelişmiş araçları.</p></Link></div>
    <div className="desk-policy">{feed.surface?.curves ? 'Vade bazlı USD iskonto ve metal taşıma faktörleri kullanılıyor. CME/SOFR endikatif proxy; banka kira kotasyonu değildir. Eğri ve IV aynı sürümde.' : 'Yeni faiz/taşıma eğrisi henüz yüklenmedi. Eksik veri manuel oranla tamamlanmaz.'}</div>
    {(feed.error || feed.quoteError) && <p role="status" className="desk-policy">{feed.error ?? feed.quoteError}</p>}
    {q && <details className="workspace-muted"><summary>Veri tarihi ve model sınırları · {q.warnings.length} not</summary>{q.warnings.map((warning, i) => <p className="analysis-footnote" key={i}>{warning}</p>)}</details>}
    <footer className="desk-footer"><strong>TERMINAL X / {TERMINAL_DESIGN === 'meridian' ? 'MERIDIAN' : 'DESK 01'}</strong><span>Avrupa tipi · müşteri perspektifi · ortak fiyatlama motoru</span><Link href="/pricing/delta-hedge">Delta hedge ↗</Link></footer>
  </div>;
}
