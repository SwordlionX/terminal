"use client";
import { TradeConditions } from '@/features/pricing/trade-conditions';
import { useAnalysisDraft } from '@/store/analysis-draft';
import { AskAssistant } from '@/components/workspace-context';
import { usePricingModel } from "@/features/pricing/use-pricing-model";
import { USD_TRY_RATE } from '@/lib/margin/config';
import { formatDateTime, formatMoney, formatNumber, formatPercent } from '@/lib/format';

const hedgeLabel = (units: number) => Math.abs(units) < 1e-9 ? 'NÖTR' : units > 0 ? 'AL' : 'SAT';

export default function DeltaHedgePricingPage() {
  const { md, feed, daysToExpiry, effVol, gr, priceable, unpriceableReason } = usePricingModel();
  const quoteType = useAnalysisDraft(s => s.quoteType), quotePosition = useAnalysisDraft(s => s.quotePosition);
  const barrier = useAnalysisDraft(s => s.quoteBarrier);
  const selectQuote = useAnalysisDraft(s => s.selectQuote);

  // Kote aralığı dışında (smile yok) delta üretilmez — ana fiyatlamayla aynı kural.
  const showHedge = priceable && gr != null;
  const unitDelta = showHedge ? (quoteType === 'Call' ? gr.call.delta : gr.put.delta) : 0;
  // Müşteri ve banka aynı sözleşmenin karşı taraflarıdır: banka deltası müşterininkinin tersidir.
  const customerDelta = (quotePosition === 'Long' ? 1 : -1) * unitDelta * md.contractSize;
  const bankDelta = -customerDelta;
  const bankHedge = -bankDelta;
  const hedgeUsd = Math.abs(bankHedge * md.spot);
  const spotTime = feed.spot ? formatDateTime(feed.spot.quoteAt ?? feed.spot.at) : null;

  return (
    <div className="desk-workspace">
      <div className="workspace-heading"><div><h1>Delta hedge</h1></div><AskAssistant text="Ekranda seçili opsiyon tipi, müşteri yönü, miktar ve vade ile bankanın delta hedge gereksinimini terminal motorunda hesapla. Hedge, mevcut Avrupa tipi sözleşmeyi sona erdirmez; spot hareketinde hedge ihtiyacının nasıl değiştiğini açıkla." /></div>
      <TradeConditions />
      <section className="workspace-panel" style={{ marginTop: 20 }}>
        <div className="workspace-toolbar" style={{ marginTop: 0 }}>
          <label className="desk-field">Opsiyon<select value={quoteType} onChange={e => selectQuote(e.target.value as 'Call' | 'Put', quotePosition)}><option>Put</option><option>Call</option></select></label>
          <label className="desk-field">Müşteri yönü<select value={quotePosition} onChange={e => selectQuote(quoteType, e.target.value as 'Long' | 'Short')}><option value="Short">Satış · prim alır</option><option value="Long">Alış · prim öder</option></select></label>
        </div>
        <div className="desk-market-facts" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
          <div><span>Terminal spotu</span><strong>{feed.spot ? `${formatNumber(feed.spot.price)} USD/ons` : '—'}</strong></div>
          <div><span>Kalan vade</span><strong>{formatNumber(daysToExpiry, 0)} gün</strong></div>
          <div><span>Smile IV</span><strong>{showHedge ? formatPercent(effVol) : '—'}</strong></div>
          <div><span>Kaynak</span><strong>{feed.spot?.source ?? 'Spot yok'}{spotTime ? ` · ${spotTime}` : ''}</strong></div>
        </div>
      </section>

      {barrier && <p className="desk-policy" role="status" style={{ marginTop: 20 }}>Ana fiyatlamada bariyer seçili. Bu ekran vanilya delta gösterir; bariyerli sözleşmenin deltası ana fiyatlamadaki risk kartındadır.</p>}
      {(feed.error || feed.quoteError) && <p className="desk-policy" role="status" style={{ marginTop: 20 }}>{feed.error ?? feed.quoteError}</p>}

      {showHedge ? (
        <>
          <div className="workspace-metrics">
            <div><span>Müşteri pozisyon deltası</span><strong>{formatNumber(customerDelta, 3)} ons</strong><small>{quotePosition === 'Long' ? 'Müşteri alışı' : 'Müşteri satışı'} · {quoteType} · birim delta {formatNumber(unitDelta, 4)}</small></div>
            <div><span>Banka deltası (karşı taraf)</span><strong>{formatNumber(bankDelta, 3)} ons</strong><small>Müşteri deltasının tersi</small></div>
            <div><span>Banka hedge işlemi · delta nötr</span><strong>{hedgeLabel(bankHedge)} {formatNumber(Math.abs(bankHedge), 3)} ons</strong><small>{formatMoney(hedgeUsd)} · {formatNumber(hedgeUsd * USD_TRY_RATE)} TL (USD/TRY {USD_TRY_RATE} sabit)</small></div>
          </div>
          <details className="workspace-notes"><summary>Hesap ayrıntıları</summary><p>Delta, terminal eğrisi ve smile IV ile sabit-IV kısmi türevdir. Hedge spot metal alım/satımıdır; Avrupa tipi sözleşmeyi sona erdirmez ve spot değiştikçe yeniden ayarlanmalıdır.</p></details>
        </>
      ) : (
        <p className="desk-policy" role="status" style={{ marginTop: 20 }}>Delta / hedge hesaplanamıyor: {unpriceableReason ?? 'Greeks hesaplanamadı.'}</p>
      )}
    </div>
  );
}
