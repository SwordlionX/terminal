"use client";

import { useState } from "react";
import { Trade } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteTradeAction, settleTradeAction, addManualTradeAction } from "@/app/customers/[id]/actions";
import { Plus, Trash2, CheckCircle } from "lucide-react";
import { MarginEngine } from "@/lib/margin/engine";

export function TradeManagement({ customerId, trades }: { customerId: string, trades: Trade[] }) {
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
    useCustomHaircut: false,
    customHaircut: "",
    isBarrier: false,
    barrierType: "Knock Out Up",
    barrierLevel: "",
    barrierStyle: "Avrupa",
  });

  const [settleSpot, setSettleSpot] = useState("");

  const formatCurrency = (val: number | null) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

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
    const submitData = {
      ...formData,
      manualMarginRate: formData.useManualMargin ? (Number(formData.manualMarginRate) / 100).toString() : undefined,
      initialCollateral: formData.initialCollateral,
      collateralAssetCode: formData.collateralAssetCode,
      collateralHaircut: formData.useCustomHaircut ? (Number(formData.customHaircut) / 100).toString() : undefined,
      isBarrier: formData.isBarrier,
      barrierType: formData.barrierType,
      barrierLevel: formData.barrierLevel,
      barrierStyle: formData.barrierStyle,
    };
    await addManualTradeAction(customerId, submitData);
    setIsAddOpen(false);
  };

  const handleSettleTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settleTrade || !settleSpot) return;
    await settleTradeAction(customerId, settleTrade.id, Number(settleSpot));
    setSettleTrade(null);
  };

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Müşteri İşlemleri (Opsiyonlar)</CardTitle>
        <Button onClick={() => setIsAddOpen(true)} size="sm" className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="w-4 h-4 mr-2" />
          Yeni İşlem Ekle
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>İşlem Tarihi</TableHead>
              <TableHead>Vade</TableHead>
              <TableHead>Ürün</TableHead>
              <TableHead>Pozisyon</TableHead>
              <TableHead>Strike</TableHead>
              <TableHead>Miktar</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead>PnL</TableHead>
              <TableHead className="text-right">Aksiyon</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map(t => (
              <TableRow key={t.id}>
                <TableCell>{new Date(t.tradeDate).toLocaleDateString()}</TableCell>
                <TableCell>{new Date(t.expiryDate).toLocaleDateString()}</TableCell>
                <TableCell className="font-bold">
                  {t.underlying}
                  {t.barrierType && (
                    <Badge variant="outline" className="ml-2 h-5 text-[10px] px-1.5 border-slate-700 text-slate-400 font-normal" title={`${t.barrierType} @ ${t.barrierLevel} (${t.barrierStyle})`}>
                      Bariyer {t.barrierLevel}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <span className={t.position === 'Long' ? 'text-emerald-500' : 'text-rose-500'}>{t.position}</span> {t.type}
                </TableCell>
                <TableCell>{t.strike}</TableCell>
                <TableCell>{t.contractSize}</TableCell>
                <TableCell>
                  <Badge variant={t.status === 'Closed' ? 'secondary' : 'default'}>{t.status}</Badge>
                </TableCell>
                <TableCell className={t.pnl && t.pnl >= 0 ? "text-emerald-500" : t.pnl && t.pnl < 0 ? "text-rose-500" : ""}>
                  {formatCurrency(t.pnl)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {t.status !== 'Closed' && (
                      <Button size="icon" variant="outline" className="h-8 w-8 text-zinc-300" onClick={() => setSettleTrade(t)} title="Vadeyi Kapat">
                        <CheckCircle className="h-4 w-4" />
                      </Button>
                    )}
                    <Button 
                      size="icon" 
                      variant="outline" 
                      className="h-8 w-8 text-rose-500" 
                      onClick={() => deleteTradeAction(customerId, t.id)}
                      title="Sil"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {trades.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">Müşteriye ait işlem bulunmamaktadır.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* Add Trade Modal (Simple Overlay) */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-lg w-full max-w-lg">
            <h2 className="text-xl font-bold mb-4">Manuel İşlem (Opsiyon) Ekle</h2>
            <form onSubmit={handleAddTrade} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400">Ürün</label>
                  <input type="text" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1" value={formData.underlying} onChange={e => setFormData({...formData, underlying: e.target.value})} required />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Yön ve Tip</label>
                  <div className="flex gap-2 mt-1">
                    <select className="w-1/2 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" value={formData.position} onChange={e => setFormData({...formData, position: e.target.value})}>
                      <option>Long</option>
                      <option>Short</option>
                    </select>
                    <select className="w-1/2 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
                      <option>Call</option>
                      <option>Put</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400">Strike (Kullanım Fiyatı)</label>
                  <input type="number" step="any" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1" value={formData.strike} onChange={e => setFormData({...formData, strike: e.target.value})} required />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Giriş Spot Fiyatı</label>
                  <input type="number" step="any" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1" value={formData.spot} onChange={e => setFormData({...formData, spot: e.target.value})} required />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Miktar (Sözleşme Büyüklüğü)</label>
                  <input type="number" step="any" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1" value={formData.contractSize} onChange={e => setFormData({...formData, contractSize: e.target.value})} required />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Toplam Prim (USD)</label>
                  <input type="number" step="any" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1" value={formData.premium} onChange={e => setFormData({...formData, premium: e.target.value})} required />
                </div>
                <div>
                  <label className="text-xs text-slate-400">İşlem Tarihi</label>
                  <input type="date" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1" value={formData.tradeDate} onChange={e => setFormData({...formData, tradeDate: e.target.value})} required />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Vade Tarihi</label>
                  <input type="date" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1" value={formData.expiryDate} onChange={e => setFormData({...formData, expiryDate: e.target.value})} required />
                </div>
              </div>

              {/* Bariyer Alanı */}
              <div className="border-t border-slate-700 pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <input type="checkbox" id="isBarrier" checked={formData.isBarrier} onChange={e => setFormData({...formData, isBarrier: e.target.checked})} className="rounded bg-slate-900 border-slate-700" />
                  <label htmlFor="isBarrier" className="text-xs font-medium">Bariyerli İşlem</label>
                </div>
                {formData.isBarrier && (
                  <div className="grid grid-cols-3 gap-3 bg-slate-800/50 p-3 rounded border border-slate-700">
                    <div>
                      <label className="text-[10px] text-slate-400 uppercase tracking-wider">Bariyer Cinsi</label>
                      <select className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs mt-1" value={formData.barrierType} onChange={e => setFormData({...formData, barrierType: e.target.value})}>
                        <option>Knock Out Up</option>
                        <option>Knock Out Down</option>
                        <option>Knock In Up</option>
                        <option>Knock In Down</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 uppercase tracking-wider">Bariyer Değeri</label>
                      <input type="number" step="any" className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs mt-1" value={formData.barrierLevel} onChange={e => setFormData({...formData, barrierLevel: e.target.value})} required={formData.isBarrier} />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 uppercase tracking-wider">Gözlem Tipi</label>
                      <select className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs mt-1" value={formData.barrierStyle} onChange={e => setFormData({...formData, barrierStyle: e.target.value})}>
                        <option>Avrupa</option>
                        <option>Amerikan</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Teminat & Özel Oranlar Alanı */}
              <div className="mt-6 border-t border-slate-700 pt-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-emerald-400">Teminat ve Risk Ayarları</h3>
                  <div className="text-sm">
                    <span className="text-slate-400">Sistemin Talep Ettiği Teminat: </span>
                    <span className="font-bold text-white">{formatCurrency(requiredMargin)}</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-800/50 p-3 rounded border border-slate-700">
                    <div className="flex items-center gap-2 mb-2">
                      <input type="checkbox" id="useManualMargin" checked={formData.useManualMargin} onChange={e => setFormData({...formData, useManualMargin: e.target.checked})} className="rounded bg-slate-900 border-slate-700" />
                      <label htmlFor="useManualMargin" className="text-xs font-medium">Manuel Teminat Oranı Gir</label>
                    </div>
                    {formData.useManualMargin && (
                      <div className="flex items-center gap-2">
                        <input type="number" step="any" placeholder="Örn: 71" className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm" value={formData.manualMarginRate} onChange={e => setFormData({...formData, manualMarginRate: e.target.value})} required />
                        <span className="text-sm text-slate-400">%</span>
                      </div>
                    )}
                  </div>

                  <div className="bg-slate-800/50 p-3 rounded border border-slate-700">
                    <label className="text-xs font-medium mb-2 block">Başlangıçta Yatırılan Nakit Teminat</label>
                    <div className="flex gap-2">
                      <input type="number" step="any" placeholder="Tutar" className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm" value={formData.initialCollateral} onChange={e => setFormData({...formData, initialCollateral: e.target.value})} />
                      <Button type="button" variant="outline" size="sm" onClick={() => setFormData({...formData, initialCollateral: requiredMargin.toString()})} className="px-2" title="Gerekeni Aktar">
                        Ayarla
                      </Button>
                    </div>
                    {Number(formData.initialCollateral) > 0 && (
                      <div className="mt-3 space-y-3">
                        <div>
                          <label className="text-[10px] text-slate-400 uppercase tracking-wider">Teminat Türü</label>
                          <select className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs mt-1" value={formData.collateralAssetCode} onChange={e => setFormData({...formData, collateralAssetCode: e.target.value})}>
                            <option value="Nakit-USD">Nakit-USD</option>
                            <option value="Nakit-TRY">Nakit-TRY</option>
                            <option value="IDL-LKT-MPF">IDL-LKT-MPF</option>
                            <option value="DOL">DOL</option>
                            <option value="DigerFonlar">Diğer Fonlar</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="checkbox" id="useCustomHaircut" checked={formData.useCustomHaircut} onChange={e => setFormData({...formData, useCustomHaircut: e.target.checked})} className="rounded bg-slate-900 border-slate-700" />
                          <label htmlFor="useCustomHaircut" className="text-[10px] text-slate-300">Özel İskonto (Haircut) Belirle</label>
                        </div>
                        {formData.useCustomHaircut && (
                          <div className="flex items-center gap-2">
                            <input type="number" step="any" placeholder="Örn: 5" className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs" value={formData.customHaircut} onChange={e => setFormData({...formData, customHaircut: e.target.value})} required />
                            <span className="text-xs text-slate-400">%</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>İptal</Button>
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700">Kaydet</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settle Trade Modal */}
      {settleTrade && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-lg w-full max-w-sm">
            <h2 className="text-xl font-bold mb-4">Vade Sonu Kapat</h2>
            <p className="text-sm text-slate-400 mb-4">
              {settleTrade.underlying} {settleTrade.position} {settleTrade.type} Strike: {settleTrade.strike}
            </p>
            <form onSubmit={handleSettleTrade} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400">Kapanış Spot Fiyatı (Vade Sonu)</label>
                <input 
                  type="number" 
                  step="any" 
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm mt-1" 
                  value={settleSpot} 
                  onChange={e => setSettleSpot(e.target.value)} 
                  required 
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <Button type="button" variant="outline" onClick={() => setSettleTrade(null)}>İptal</Button>
                <Button type="submit" className="bg-zinc-700 hover:bg-zinc-600">Kapat ve Hesapla</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Card>
  );
}
