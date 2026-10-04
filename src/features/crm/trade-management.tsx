"use client";

import { useState } from "react";
import { Trade } from "@/types";
import { BarrierHistoryCheck } from "@/features/crm/barrier-history-check";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { deleteTradeAction, settleTradeAction, addManualTradeAction } from "@/app/customers/[id]/actions";
import { MarginEngine } from "@/lib/margin/engine";
import { InfoHint } from "@/components/ui/info-hint";
import { BREAKEVEN_INFO } from "@/lib/greeks-info";
import { breakEvenSpot, profitSideOf, breakEvenLabel } from "@/lib/math/breakeven";
import Link from "next/link";
import { valuationTotal, type TradeValuations } from '@/lib/pricing/trade-valuation';
import { TradeValue, ValuationDetails } from './trade-value';
import { formatDate, formatMoney, formatNumber, formatPercent } from '@/lib/format';
import { istanbulToday } from '@/lib/dates';

export function TradeManagement({ customerId, trades, valuations = {} }: { customerId: string, trades: Trade[], valuations?: TradeValuations }) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [settleTrade, setSettleTrade] = useState<Trade | null>(null);
  
  // Add Trade Form State
  const [formData, setFormData] = useState({
    underlying: "XAU",
    type: "Call",
    position: "Long",
    strike: "",
    spot: "",
    contractSize: "",
    premium: "",
    tradeDate: istanbulToday(),
    expiryDate: "",
    useManualMargin: false,
    manualMarginRate: "",
    initialCollateral: "",
    collateralAssetCode: "Nakit-USD",
    isBarrier: false,
    barrierType: "Knock Out Up",
    barrierLevel: "",
    barrierStyle: "Amerikan", // tüm bariyerlerimiz sürekli gözlemli (bkz. forma düşen not)
  });

  const [settleSpot, setSettleSpot] = useState("");
  const [addingTrade, setAddingTrade] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('open');
  const [search, setSearch] = useState('');
  const activeTrades = trades.filter(t => (statusFilter === 'all' || (statusFilter === 'closed' ? t.status === 'Closed' : t.status !== 'Closed')) && (t.id + ' ' + t.underlying + ' ' + t.type + ' ' + t.position).toLowerCase().includes(search.toLowerCase()));
  const cashflow = trades.filter(t=>t.status !== 'Closed').reduce((sum,t)=>sum+(t.position==='Short'?1:-1)*t.premium,0);
  const total = valuationTotal(trades, valuations);

  const formatCurrency = (val: number | null) => formatMoney(val ?? 0);

  // Dinamik Teminat Hesaplama
  const requiredMarginCalc = () => {
    if (!formData.underlying || !formData.spot || !formData.contractSize || !formData.expiryDate || !formData.tradeDate) return 0;
    const days = Math.max(1, (new Date(formData.expiryDate).getTime() - new Date(formData.tradeDate).getTime()) / 86400000);
    const rate = formData.useManualMargin && formData.manualMarginRate 
      ? Number(formData.manualMarginRate) / 100 
      : MarginEngine.getBaseMarginRate(formData.underlying, days);
    return Number(formData.spot) * Number(formData.contractSize) * rate;
  };
  const requiredMargin = requiredMarginCalc();

  const handleAddTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addingTrade) return; // çift tıklamayı engelle
    setAddingTrade(true);
    setAddError(null);
    const submitData = {
      ...formData,
      manualMarginRate: formData.useManualMargin ? (Number(formData.manualMarginRate) / 100).toString() : undefined,
      initialCollateral: formData.initialCollateral,
      collateralAssetCode: formData.collateralAssetCode,
      isBarrier: formData.isBarrier,
      barrierType: formData.barrierType,
      barrierLevel: formData.barrierLevel,
      barrierStyle: formData.barrierStyle,
    };
    try {
      await addManualTradeAction(customerId, submitData);
      setIsAddOpen(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "İşlem eklenemedi.");
    } finally {
      setAddingTrade(false);
    }
  };

  const handleSettleTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settleTrade || !settleSpot || settling) return;
    setSettling(true);
    setSettleError(null);
    try {
      await settleTradeAction(customerId, settleTrade.id, Number(settleSpot));
      setSettleTrade(null);
    } catch (err) {
      setSettleError(err instanceof Error ? err.message : "Vade sonucu kaydedilemedi.");
    } finally {
      setSettling(false);
    }
  };

  return (
    <div className="customer-trade-register"><div className="workspace-metrics" style={{padding:'0 20px'}}><div><span>Açık işlem</span><strong>{trades.filter(t=>t.status!=='Closed').length}</strong></div><div><span>Geçmiş net prim · açık işlemler</span><strong>{formatCurrency(cashflow)}</strong></div><div><span>Güncel K/Z · giriş primi dahil</span><strong>{total.pnl === null ? 'Eksik değerleme' : formatCurrency(total.pnl)}</strong><small>{total.valued} / {total.count} açık işlem değerlendi</small></div></div>
      <div className="workspace-heading">
        <h2>İşlem kayıtları</h2>
        <div className="workspace-toolbar" style={{ margin: 0 }}>
          <Link href={`/archive?customer=${encodeURIComponent(customerId)}`} className="desk-button">İşlem arşivi</Link>
          <button onClick={() => { setAddError(null); setIsAddOpen(true); }} className="desk-button desk-button-primary">Geçmiş işlem kaydı ekle</button>
        </div>
      </div><div className="workspace-toolbar" style={{padding:'0 20px'}}><div className="workspace-tabs" style={{margin:0}}>{[['open','Açık'],['closed','Sonuçlanmış'],['all','Tümü']].map(([key,label])=><button key={key} aria-pressed={statusFilter===key} onClick={()=>setStatusFilter(key)}>{label}</button>)}</div><input className="workspace-search" aria-label="Müşterinin işlemlerinde ara" placeholder="İşlem, ürün veya yön ara…" value={search} onChange={e=>setSearch(e.target.value)} /></div>
      <ValuationDetails values={valuations} />
      <div className="workspace-table-scroll">
        <table className="workspace-table">
          <thead>
            <tr>
              <th>İşlem Tarihi</th>
              <th>Vade</th>
              <th>Ürün</th>
              <th>Pozisyon</th>
              <th>Strike</th>
              <th>
                Başabaş <InfoHint label="Başabaş nedir" text={BREAKEVEN_INFO} />
              </th>
              <th>Miktar</th>
              <th className="number">Giriş primi · USD / %</th><th className="number">Pozisyon değeri · prim hariç</th><th className="number">Güncel K/Z · prim dahil</th><th>Durum</th>
              <th>Vade sonucu K/Z</th>
              <th>İşlem</th>
            </tr>
          </thead>
          <tbody>
            {activeTrades.map(t => (
              <tr key={t.id}>
                <td>{formatDate(t.tradeDate)}</td>
                <td>{formatDate(t.expiryDate)}</td>
                <td>
                  <strong>{t.underlying}</strong>
                  {t.barrierType && <small title={`${t.barrierType} @ ${t.barrierLevel} (${t.barrierStyle})`}>Bariyer {t.barrierType} · {formatNumber(t.barrierLevel ?? NaN)}</small>}
                  {t.barrierType && <BarrierHistoryCheck customerId={customerId} tradeId={t.id} />}
                </td>
                <td>{t.position === 'Long' ? 'Alış' : 'Satış'} · {t.type}</td>
                <td>{formatNumber(t.strike)}</td>
                <td className="number">
                  {(() => {
                    const be = breakEvenSpot(t.type, t.strike, t.premium, t.contractSize);
                    if (be == null) return '—';
                    const above = profitSideOf(t.type, t.position) === 'above';
                    return (
                      <span title={breakEvenLabel(t.type, t.position, be)}>
                        {formatNumber(be)}
                        {' '}{above ? '↑' : '↓'}
                        {t.barrierType && <span title="Bariyerli — bariyere değilmediği varsayımıyla">*</span>}
                      </span>
                    );
                  })()}
                </td>
                <td title={`${t.contractSize} ons`}>{formatNumber(t.contractSize)}</td>
                <td className="number">{formatCurrency(t.premium)}<small>{t.spot*t.contractSize>0 ? formatPercent(t.premium/(t.spot*t.contractSize)*100) : '—'} · giriş nominali</small></td>
                <td className="number"><TradeValue value={valuations[t.id]} field="positionValue" /></td>
                <td className="number"><TradeValue value={valuations[t.id]} field="pnl" /></td>
                <td>
                  {t.status === 'Closed' ? 'Sonuçlandı' : t.expiryDate.slice(0,10)<=istanbulToday() ? 'Vade sonucu bekleniyor' : 'Açık'}
                </td>
                <td className={`number ${t.status === 'Closed' && t.pnl !== null ? t.pnl >= 0 ? 'trade-value-profit' : 'trade-value-loss' : ''}`}>
                  {t.status === 'Closed' && t.pnl !== null ? formatCurrency(t.pnl) : '—'}
                </td>
                <td>
                  <div className="workspace-toolbar" style={{ margin: 0, flexWrap: 'nowrap' }}><Link className="desk-button" href={`/trades?trade=${encodeURIComponent(t.id)}`} title="Pozisyon masasında incele">İncele ↗</Link>
                    {t.status !== 'Closed' && t.expiryDate.slice(0, 10) <= istanbulToday() && (
                      <button className="desk-button" onClick={() => { setSettleError(null); setSettleSpot(""); setSettleTrade(t); }}>Vade sonucu</button>
                    )}
                    <button className="desk-button" onClick={() => deleteTradeAction(customerId, t.id)} disabled={t.status === 'Closed'}>Sil</button>
                  </div>
                </td>
              </tr>
            ))}
            {activeTrades.length === 0 && (
              <tr>
                <td colSpan={13} className="workspace-empty">Müşteriye ait işlem bulunmamaktadır.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Erişilebilir Dialog: Escape/dışa tıklama/odak tuzağı base-ui'den gelir. */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Geçmiş işlem kaydı ekle</DialogTitle></DialogHeader>
          <form onSubmit={handleAddTrade} className="stock-dialog-fields">
            <label className="desk-field">Ürün<select value={formData.underlying} onChange={e => setFormData({...formData, underlying: e.target.value})}><option value="XAU">XAU · Altın</option><option value="XAG">XAG · Gümüş</option></select></label>
            <label className="desk-field">Müşteri yönü<select value={formData.position} onChange={e => setFormData({...formData, position: e.target.value})}><option value="Long">Alış · prim öder</option><option value="Short">Satış · prim alır</option></select></label>
            <label className="desk-field">Opsiyon<select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}><option>Call</option><option>Put</option></select></label>
            <label className="desk-field">Kullanım fiyatı · USD/ons<input type="number" step="any" value={formData.strike} onChange={e => setFormData({...formData, strike: e.target.value})} required /></label>
            <label className="desk-field">Giriş spotu · USD/ons<input type="number" step="any" value={formData.spot} onChange={e => setFormData({...formData, spot: e.target.value})} required /></label>
            <label className="desk-field">Miktar · ons<input type="number" step="any" value={formData.contractSize} onChange={e => setFormData({...formData, contractSize: e.target.value})} required /></label>
            <label className="desk-field">Toplam prim · USD<input type="number" step="any" value={formData.premium} onChange={e => setFormData({...formData, premium: e.target.value})} required /></label>
            <label className="desk-field">İşlem tarihi<input type="date" value={formData.tradeDate} onChange={e => setFormData({...formData, tradeDate: e.target.value})} required /></label>
            <label className="desk-field">Vade<input type="date" value={formData.expiryDate} onChange={e => setFormData({...formData, expiryDate: e.target.value})} required /></label>

            <div className="desk-barrier-control stock-dialog-wide">
              <label className="desk-checkbox"><input type="checkbox" checked={formData.isBarrier} onChange={e => setFormData({...formData, isBarrier: e.target.checked})} />Bariyerli işlem</label>
              {/* Bu masanın bütün bariyerleri sürekli (Amerikan) gözlemlidir; gözlem tipi seçilmez. */}
              {formData.isBarrier && <div className="stock-dialog-fields" style={{ marginTop: 12 }}>
                <label className="desk-field">Bariyer yapısı<select value={formData.barrierType} onChange={e => setFormData({...formData, barrierType: e.target.value})}><option value="Knock Out Up">Yukarı knock-out</option><option value="Knock Out Down">Aşağı knock-out</option><option value="Knock In Up">Yukarı knock-in</option><option value="Knock In Down">Aşağı knock-in</option></select></label>
                <label className="desk-field">Bariyer · USD/ons<input type="number" step="any" value={formData.barrierLevel} onChange={e => setFormData({...formData, barrierLevel: e.target.value})} required={formData.isBarrier} /></label>
                <small className="desk-muted stock-dialog-wide">Sürekli gözlem (Amerikan bariyer) · kullanım vade sonunda</small>
              </div>}
            </div>

            <div className="desk-barrier-control stock-dialog-wide">
              <div className="workspace-heading" style={{ marginBottom: 12 }}><h3>Teminat ve risk ayarları</h3><span className="desk-muted">Sistemin talep ettiği teminat: <strong>{formatCurrency(requiredMargin)}</strong></span></div>
              <div className="stock-dialog-fields">
                <div>
                  <label className="desk-checkbox"><input type="checkbox" checked={formData.useManualMargin} onChange={e => setFormData({...formData, useManualMargin: e.target.checked})} />Manuel teminat oranı</label>
                  {formData.useManualMargin && <label className="desk-field" style={{ marginTop: 10 }}>Oran · %<input type="number" step="any" placeholder="Örn: 71" value={formData.manualMarginRate} onChange={e => setFormData({...formData, manualMarginRate: e.target.value})} required /></label>}
                </div>
                <div className="stock-dialog-fields" style={{ gridTemplateColumns: 'minmax(0,1fr)', gap: 10 }}>
                  <label className="desk-field">Başlangıç teminatı<select value={formData.collateralAssetCode} onChange={e => setFormData({...formData, collateralAssetCode: e.target.value})}><option value="Nakit-USD">Nakit USD</option><option value="Nakit-XAU">Altın (XAU) · ons</option><option value="Nakit-XAG">Gümüş (XAG) · ons</option></select></label>
                  <label className="desk-field">{formData.collateralAssetCode === 'Nakit-USD' ? 'Tutar · USD' : 'Miktar · ons'}<input type="number" step="any" value={formData.initialCollateral} onChange={e => setFormData({...formData, initialCollateral: e.target.value})} /></label>
                  {formData.collateralAssetCode === 'Nakit-USD'
                    ? <button type="button" className="desk-button" onClick={() => setFormData({...formData, initialCollateral: requiredMargin.toString()})}>Talep edilen tutarı aktar</button>
                    : <small className="desk-muted">Canlı ons fiyatıyla değerlenir (haircut 0).</small>}
                </div>
              </div>
            </div>

            {addError && <p className="desk-policy stock-dialog-wide" role="alert">{addError}</p>}
            <div className="workspace-toolbar stock-dialog-wide" style={{ justifyContent: 'flex-end', margin: 0 }}>
              <button type="button" className="desk-button" onClick={() => setIsAddOpen(false)} disabled={addingTrade}>İptal</button>
              <button type="submit" className="desk-button desk-button-primary" disabled={addingTrade}>{addingTrade ? 'Kaydediliyor…' : 'Kaydet'}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={settleTrade !== null} onOpenChange={(o) => { if (!o) setSettleTrade(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Vade sonucunu kaydet</DialogTitle>
            <DialogDescription>{settleTrade && `${settleTrade.underlying} · ${settleTrade.position === 'Long' ? 'Alış' : 'Satış'} ${settleTrade.type} · strike ${formatNumber(settleTrade.strike)}`}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSettleTrade} className="stock-dialog-fields" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
            <label className="desk-field">Gerçekleşen vade sonu spotu · USD/ons<input type="number" step="any" value={settleSpot} onChange={e => setSettleSpot(e.target.value)} required autoFocus /></label>
            {settleError && <p className="desk-policy" role="alert">{settleError}</p>}
            <div className="workspace-toolbar" style={{ justifyContent: 'flex-end', margin: 0 }}>
              <button type="button" className="desk-button" onClick={() => setSettleTrade(null)} disabled={settling}>İptal</button>
              <button type="submit" className="desk-button desk-button-primary" disabled={settling}>{settling ? 'Kaydediliyor…' : 'Sonucu kaydet ve arşivle'}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
