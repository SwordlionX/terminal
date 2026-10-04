"use client";

import { useState } from "react";
import { Trade } from "@/types";
import { BarrierHistoryCheck } from "@/features/crm/barrier-history-check";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { deleteTradeAction, settleTradeAction, addManualTradeAction } from "@/app/customers/[id]/actions";
import { Plus, Trash2, CheckCircle } from "lucide-react";
import { MarginEngine } from "@/lib/margin/engine";
import { InfoHint } from "@/components/ui/info-hint";
import { BREAKEVEN_INFO } from "@/lib/greeks-info";
import { breakEvenSpot, profitSideOf, breakEvenLabel } from "@/lib/math/breakeven";
import Link from "next/link";
import { valuationTotal, type TradeValuations } from '@/lib/pricing/trade-valuation';
import { TradeValue, ValuationDetails } from './trade-value';
import { formatNumber } from '@/lib/format';

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
    tradeDate: new Date().toISOString().split('T')[0],
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

  const formatCurrency = (val: number | null) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val || 0) + ' USD';

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
        <div className="flex items-center gap-2">
          <Link href={`/archive?customer=${encodeURIComponent(customerId)}`} className="rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">
            İşlem Arşivi
          </Link>
          <Button onClick={() => { setAddError(null); setIsAddOpen(true); }} size="sm" className="desk-button desk-button-primary">
            <Plus className="w-4 h-4 mr-2" />
            Geçmiş işlem kaydı ekle
          </Button>
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
                <span className="inline-flex items-center gap-1.5">
                  Başabaş
                  <InfoHint label="Başabaş nedir" text={BREAKEVEN_INFO} />
                </span>
              </th>
              <th>Miktar</th>
              <th className="number">Giriş primi · USD / %</th><th className="number">Pozisyon değeri · prim hariç</th><th className="number">Güncel K/Z · prim dahil</th><th>Durum</th>
              <th>Vade sonucu K/Z</th>
              <th className="text-right">Aksiyon</th>
            </tr>
          </thead>
          <tbody>
            {activeTrades.map(t => (
              <tr key={t.id}>
                <td>{new Date(t.tradeDate).toLocaleDateString()}</td>
                <td>{new Date(t.expiryDate).toLocaleDateString()}</td>
                <td className="font-bold">
                  {t.underlying}
                  {t.barrierType && (
                    <Badge variant="outline" className="ml-2 h-5 text-[10px] px-1.5 border-zinc-700 text-zinc-400 font-normal" title={`${t.barrierType} @ ${t.barrierLevel} (${t.barrierStyle})`}>
                      Bariyer {t.barrierLevel}
                    </Badge>
                  )}
                  {t.barrierType && <BarrierHistoryCheck customerId={customerId} tradeId={t.id} />}
                </td>
                <td>
                  <span className={t.position === 'Long' ? 'text-emerald-500' : 'text-rose-500'}>{t.position}</span> {t.type}
                </td>
                <td>{formatNumber(t.strike)}</td>
                <td className="font-mono">
                  {(() => {
                    const be = breakEvenSpot(t.type, t.strike, t.premium, t.contractSize);
                    if (be == null) return <span className="text-zinc-600">-</span>;
                    const above = profitSideOf(t.type, t.position) === 'above';
                    return (
                      <span title={breakEvenLabel(t.type, t.position, be)}>
                        {be.toFixed(2)}
                        <span className={`ml-1 text-[10px] ${above ? 'text-emerald-500' : 'text-rose-500'}`}>{above ? '↑' : '↓'}</span>
                        {t.barrierType && <span className="text-amber-600" title="Bariyerli — bariyere değilmediği varsayımıyla">*</span>}
                      </span>
                    );
                  })()}
                </td>
                <td title={`${t.contractSize} ons`}>{formatNumber(t.contractSize)}</td>
                <td className="number">{formatCurrency(t.premium)}<small>{t.spot*t.contractSize>0 ? '%' + (t.premium/(t.spot*t.contractSize)*100).toLocaleString('tr-TR',{maximumFractionDigits:2}) : '—'} · giriş nominali</small></td>
                <td className="number"><TradeValue value={valuations[t.id]} field="positionValue" /></td>
                <td className="number"><TradeValue value={valuations[t.id]} field="pnl" /></td>
                <td>
                  <Badge variant={t.status === 'Closed' ? 'secondary' : 'default'}>{t.status === 'Closed' ? 'Sonuçlandı' : t.expiryDate.slice(0,10)<=new Date().toISOString().slice(0,10) ? 'Vade sonucu bekleniyor' : 'Açık'}</Badge>
                </td>
                <td className={t.pnl && t.pnl >= 0 ? "text-emerald-500" : t.pnl && t.pnl < 0 ? "text-rose-500" : ""}>
                  {t.status === 'Closed' && t.pnl !== null ? formatCurrency(t.pnl) : '—'}
                </td>
                <td className="text-right">
                  <div className="flex justify-end gap-2"><Link className="desk-link" href={`/trades?trade=${encodeURIComponent(t.id)}`} title="Pozisyon masasında incele">İncele ↗</Link>
                    {t.status !== 'Closed' && t.expiryDate.slice(0, 10) <= new Date().toISOString().slice(0, 10) && (
                      <Button size="icon" variant="outline" className="h-8 w-8 text-zinc-300" onClick={() => { setSettleError(null); setSettleSpot(""); setSettleTrade(t); }} title="Vade sonucunu kaydet">
                        <CheckCircle className="h-4 w-4" />
                      </Button>
                    )}
                    <Button 
                      size="icon" 
                      variant="outline" 
                      className="h-8 w-8 text-rose-500" 
                      onClick={() => deleteTradeAction(customerId, t.id)}
                      title="Sil" disabled={t.status === 'Closed'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {activeTrades.length === 0 && (
              <tr>
                <td colSpan={13} className="text-center text-muted-foreground py-8">Müşteriye ait işlem bulunmamaktadır.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Trade Modal — erişilebilir Dialog (Escape/dışa tıklama/odak tuzağı base-ui'den gelir) */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader className="mb-4">
              <DialogTitle>Geçmiş işlem kaydı ekle</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddTrade} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-zinc-400">Ürün</label>
                  <input type="text" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm mt-1" value={formData.underlying} onChange={e => setFormData({...formData, underlying: e.target.value})} required />
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Yön ve Tip</label>
                  <div className="flex gap-2 mt-1">
                    <select className="w-1/2 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" value={formData.position} onChange={e => setFormData({...formData, position: e.target.value})}>
                      <option>Long</option>
                      <option>Short</option>
                    </select>
                    <select className="w-1/2 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
                      <option>Call</option>
                      <option>Put</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Strike (Kullanım Fiyatı)</label>
                  <input type="number" step="any" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm mt-1" value={formData.strike} onChange={e => setFormData({...formData, strike: e.target.value})} required />
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Giriş Spot Fiyatı</label>
                  <input type="number" step="any" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm mt-1" value={formData.spot} onChange={e => setFormData({...formData, spot: e.target.value})} required />
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Miktar (Sözleşme Büyüklüğü)</label>
                  <input type="number" step="any" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm mt-1" value={formData.contractSize} onChange={e => setFormData({...formData, contractSize: e.target.value})} required />
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Toplam Prim (USD)</label>
                  <input type="number" step="any" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm mt-1" value={formData.premium} onChange={e => setFormData({...formData, premium: e.target.value})} required />
                </div>
                <div>
                  <label className="text-xs text-zinc-400">İşlem Tarihi</label>
                  <input type="date" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm mt-1" value={formData.tradeDate} onChange={e => setFormData({...formData, tradeDate: e.target.value})} required />
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Vade Tarihi</label>
                  <input type="date" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm mt-1" value={formData.expiryDate} onChange={e => setFormData({...formData, expiryDate: e.target.value})} required />
                </div>
              </div>

              {/* Bariyer Alanı */}
              <div className="border-t border-zinc-700 pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <input type="checkbox" id="isBarrier" checked={formData.isBarrier} onChange={e => setFormData({...formData, isBarrier: e.target.checked})} className="rounded bg-zinc-900 border-zinc-700" />
                  <label htmlFor="isBarrier" className="text-xs font-medium">Bariyerli İşlem</label>
                </div>
                {formData.isBarrier && (
                  <div className="grid grid-cols-3 gap-3 bg-zinc-800/50 p-3 rounded border border-zinc-700">
                    <div>
                      <label className="text-[10px] text-zinc-400 uppercase tracking-wider">Bariyer Cinsi</label>
                      <select className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs mt-1" value={formData.barrierType} onChange={e => setFormData({...formData, barrierType: e.target.value})}>
                        <option>Knock Out Up</option>
                        <option>Knock Out Down</option>
                        <option>Knock In Up</option>
                        <option>Knock In Down</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-400 uppercase tracking-wider">Bariyer Değeri</label>
                      <input type="number" step="any" className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs mt-1" value={formData.barrierLevel} onChange={e => setFormData({...formData, barrierLevel: e.target.value})} required={formData.isBarrier} />
                    </div>
                    {/* Gözlem tipi SEÇİLMİYOR: bu masanın tüm bariyerleri sürekli (Amerikan)
                        gözlemli — vade boyunca herhangi bir anda seviyeye değerse işlem ölür.
                        Seçenek olarak durduğunda yanlışlıkla "Avrupa" kaydedilebiliyordu ve
                        kayıt sözleşmeyle çelişiyordu; alan sabit yazılıyor. */}
                    <div>
                      <label className="text-[10px] text-zinc-400 uppercase tracking-wider">Gözlem Tipi</label>
                      <div className="w-full bg-zinc-900/60 border border-zinc-700 rounded px-2 py-1.5 text-xs mt-1 text-zinc-300">
                        Amerikan (sürekli)
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Teminat & Özel Oranlar Alanı */}
              <div className="mt-6 border-t border-zinc-700 pt-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-emerald-400">Teminat ve Risk Ayarları</h3>
                  <div className="text-sm">
                    <span className="text-zinc-400">Sistemin Talep Ettiği Teminat: </span>
                    <span className="font-bold text-white">{formatCurrency(requiredMargin)}</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-zinc-800/50 p-3 rounded border border-zinc-700">
                    <div className="flex items-center gap-2 mb-2">
                      <input type="checkbox" id="useManualMargin" checked={formData.useManualMargin} onChange={e => setFormData({...formData, useManualMargin: e.target.checked})} className="rounded bg-zinc-900 border-zinc-700" />
                      <label htmlFor="useManualMargin" className="text-xs font-medium">Manuel Teminat Oranı Gir</label>
                    </div>
                    {formData.useManualMargin && (
                      <div className="flex items-center gap-2">
                        <input type="number" step="any" placeholder="Örn: 71" className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm" value={formData.manualMarginRate} onChange={e => setFormData({...formData, manualMarginRate: e.target.value})} required />
                        <span className="text-sm text-zinc-400">%</span>
                      </div>
                    )}
                  </div>

                  <div className="bg-zinc-800/50 p-3 rounded border border-zinc-700">
                    <label className="text-xs font-medium mb-2 block">Başlangıçta Yatırılan Teminat</label>
                    <div className="space-y-2">
                      <select className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs" value={formData.collateralAssetCode} onChange={e => setFormData({...formData, collateralAssetCode: e.target.value})}>
                        <option value="Nakit-USD">Nakit USD</option>
                        <option value="Nakit-XAU">Altın (XAU) — ons</option>
                        <option value="Nakit-XAG">Gümüş (XAG) — ons</option>
                      </select>
                      <div className="flex gap-2">
                        <input type="number" step="any" placeholder={formData.collateralAssetCode === 'Nakit-USD' ? 'Tutar (USD)' : 'Miktar (ons)'} className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm" value={formData.initialCollateral} onChange={e => setFormData({...formData, initialCollateral: e.target.value})} />
                        {formData.collateralAssetCode === 'Nakit-USD' && (
                          <Button type="button" variant="outline" size="sm" onClick={() => setFormData({...formData, initialCollateral: requiredMargin.toString()})} className="px-2" title="Gerekeni Aktar">
                            Ayarla
                          </Button>
                        )}
                      </div>
                      {formData.collateralAssetCode !== 'Nakit-USD' && (
                        <p className="text-[10px] text-zinc-500">Ons cinsinden girin; canlı ons fiyatıyla değerlenir (haircut 0).</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {addError && <p className="text-xs text-rose-500">{addError}</p>}
              <div className="flex justify-end gap-3 mt-6">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)} disabled={addingTrade}>İptal</Button>
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" disabled={addingTrade}>
                  {addingTrade ? "Kaydediliyor..." : "Kaydet"}
                </Button>
              </div>
            </form>
        </DialogContent>
      </Dialog>

      {/* Settle Trade Modal — erişilebilir Dialog */}
      <Dialog open={settleTrade !== null} onOpenChange={(o) => { if (!o) setSettleTrade(null); }}>
        <DialogContent className="sm:max-w-sm">
            <DialogHeader className="mb-4">
              <DialogTitle>Vade sonucunu kaydet</DialogTitle>
              <DialogDescription>
                {settleTrade && `${settleTrade.underlying} ${settleTrade.position} ${settleTrade.type} Strike: ${settleTrade.strike}`}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSettleTrade} className="space-y-4">
              <div>
                <label className="text-xs text-zinc-400">Gerçekleşen vade sonu spotu</label>
                <input 
                  type="number" 
                  step="any" 
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm mt-1" 
                  value={settleSpot} 
                  onChange={e => setSettleSpot(e.target.value)} 
                  required 
                  autoFocus
                />
              </div>
              {settleError && <p className="text-xs text-rose-500">{settleError}</p>}
              <div className="flex justify-end gap-3 mt-6">
                <Button type="button" variant="outline" onClick={() => setSettleTrade(null)} disabled={settling}>İptal</Button>
                <Button type="submit" className="bg-zinc-700 hover:bg-zinc-600" disabled={settling}>
                  {settling ? "Kaydediliyor…" : "Sonucu kaydet ve arşivle"}
                </Button>
              </div>
            </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
