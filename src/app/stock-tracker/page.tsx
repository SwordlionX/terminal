"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, RefreshCcw, Activity, Plus, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { InfoHint } from '@/components/ui/info-hint';
import { BREAKEVEN_INFO } from '@/lib/greeks-info';
import {
  BIST_TICKERS, SYMBOL_RE, bistName, toBistCode, toYahooSymbol,
  STOCK_TRADE_TYPES, STOCK_TRADE_LABELS, STOCK_TRADE_SHORT, StockTradeType,
  isOptionTrade, stockPnL, stockBreakEven, stockProfitSide, normalizeStockTradeType,
} from '@/lib/bist';

type StockData = {
  price: number;
  /** Yahoo bunu her zaman vermez (seans dışı / yeni sembol) — null olabilir. */
  previousClose: number | null;
};

type UserInputs = {
  tradeType: StockTradeType;
  basePrice: number;
  quantity: number;
  premium: number;
};

/* Ağ çağrıları bileşenin DIŞINDA: içlerinde setState yok, yalnız veri döndürürler.
   Efekt gövdesinden senkron setState çağrılmaması için gerekli (react-hooks kuralı) —
   durum güncellemeleri her zaman await'lerden SONRA, tek yerde yapılır. */

async function loadStock(symbol: string): Promise<StockData | null> {
  try {
    const res = await fetch(`/api/stocks?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) return null;
    return (await res.json()) as StockData;
  } catch {
    return null;
  }
}

/** Yalnız TAKİP EDİLEN semboller çekilir — BIST listesinin tamamı değil. */
async function loadQuotes(symbols: string[]): Promise<Record<string, StockData>> {
  const entries = await Promise.all(
    symbols.map(async (s) => [s, await loadStock(s)] as const),
  );
  const out: Record<string, StockData> = {};
  for (const [symbol, data] of entries) if (data) out[symbol] = data;
  return out;
}

async function loadPositions(): Promise<Record<string, UserInputs> | null> {
  try {
    const res = await fetch('/api/stocks/positions');
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.positions as Record<string, UserInputs>) ?? null;
  } catch (error) {
    console.error('Failed to fetch positions from DB', error);
    return null;
  }
}

/** Kar/zarar — yön mantığı lib/bist.ts'te (dört opsiyon yönü + düz hisse). */
const calculatePnL = (i: UserInputs, price: number) =>
  stockPnL(i.tradeType, price, i.basePrice, i.quantity, i.premium);

const fmtTl = (v: number) =>
  new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);

/* ------------------------------------------------------------------ */
/* İşlem ekleme / düzenleme formu                                      */
/* ------------------------------------------------------------------ */

interface DraftState {
  code: string;
  tradeType: StockTradeType;
  basePrice: string;
  quantity: string;
  premium: string;
}

const EMPTY_DRAFT: DraftState = { code: '', tradeType: 'put_sell', basePrice: '', quantity: '100', premium: '' };

function TradeDialog({
  open, onOpenChange, draft, setDraft, editing, onSave, saving, error,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: DraftState;
  setDraft: React.Dispatch<React.SetStateAction<DraftState>>;
  editing: boolean;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  const set = <K extends keyof DraftState>(k: K, v: DraftState[K]) => setDraft(prev => ({ ...prev, [k]: v }));
  const isOpt = isOptionTrade(draft.tradeType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'İşlemi Düzenle' : 'Yeni İşlem Ekle'}</DialogTitle>
          <DialogDescription>
            Hisse, maliyet ve prim girin — anlık fiyat çekilip kar/zarar hesaplanır.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-zinc-400">Hisse</Label>
            {/* Yazarak arama için native datalist: 57 kodda ayrı bir arama bileşenine
                gerek yok ve listede OLMAYAN bir kod da elle yazılabiliyor. */}
            <Input
              list="bist-tickers"
              value={draft.code}
              disabled={editing}
              placeholder="THYAO"
              onChange={e => set('code', e.target.value.toUpperCase())}
              className="font-mono uppercase"
            />
            <datalist id="bist-tickers">
              {BIST_TICKERS.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}
            </datalist>
            {!editing && (
              <p className="text-[11px] text-zinc-500">
                Listeden seçebilir ya da BIST kodunu yazabilirsiniz. Kod Yahoo&apos;da bulunamazsa işlem eklenmez.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-zinc-400">İşlem Tipi</Label>
            {/* items: Base UI'ın Select.Value'su bu eşleme olmadan ham değeri ("put_sell") basar. */}
            <Select
              value={draft.tradeType}
              items={STOCK_TRADE_LABELS}
              onValueChange={(v: string | null) => set('tradeType', normalizeStockTradeType(v) ?? 'put_sell')}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STOCK_TRADE_TYPES.map(t => (
                  <SelectItem key={t} value={t}>{STOCK_TRADE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-zinc-400">
                {isOpt ? 'Kullanım Fiyatı (Strike)' : 'Maliyet Fiyatı'}
              </Label>
              <Input
                type="number" step="0.01" placeholder="0.00"
                value={draft.basePrice}
                onChange={e => set('basePrice', e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-zinc-400">Miktar (Lot)</Label>
              <Input
                type="number" step="1" placeholder="0"
                value={draft.quantity}
                onChange={e => set('quantity', e.target.value)}
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-zinc-400">
              {!isOpt ? 'Ek Gelir / Prim (TL, toplam)'
                : draft.tradeType.endsWith('_sell') ? 'Alınan Prim (TL, toplam)'
                : 'Ödenen Prim (TL, toplam)'}
            </Label>
            <Input
              type="number" step="0.01" placeholder="0.00"
              value={draft.premium}
              onChange={e => set('premium', e.target.value)}
              className="font-mono"
            />
          </div>

          {error && <p className="text-xs text-rose-500">{error}</p>}

          <Button className="w-full" onClick={onSave} disabled={saving}>
            {saving ? 'Kaydediliyor…' : editing ? 'Güncelle' : 'İşlemi Ekle'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

export default function StockTrackerPage() {
  const [quotes, setQuotes] = useState<Record<string, StockData>>({});
  const [positions, setPositions] = useState<Record<string, UserInputs>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const symbols = useMemo(() => Object.keys(positions).sort(), [positions]);

  /** Elle "Yenile" ve 60 sn'lik otomatik tazeleme — yalnız fiyatları çeker. */
  const refreshQuotes = useCallback(async (syms: string[]) => {
    if (syms.length === 0) { setLastUpdated(new Date()); return; }
    setLoading(true);
    try {
      setQuotes(await loadQuotes(syms));
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  // İlk yükleme: pozisyonlar (DB) → o sembollerin fiyatları. State yalnızca await'lerden
  // sonra ve bileşen hâlâ takılıyken güncellenir.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const pos = await loadPositions();
      if (!alive) return;
      const syms = Object.keys(pos ?? {});
      if (pos) setPositions(pos);
      const q = syms.length ? await loadQuotes(syms) : {};
      if (!alive) return;
      setQuotes(q);
      setLastUpdated(new Date());
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  // Fiyat tazeleme — dakikada bir (metal spot TTL'siyle aynı ritim).
  useEffect(() => {
    if (symbols.length === 0) return;
    const id = setInterval(() => { void refreshQuotes(symbols); }, 60000);
    return () => clearInterval(id);
  }, [symbols, refreshQuotes]);

  const openAdd = () => {
    setDraft(EMPTY_DRAFT);
    setEditing(false);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (symbol: string) => {
    const p = positions[symbol];
    setDraft({
      code: toBistCode(symbol),
      tradeType: p.tradeType,
      basePrice: String(p.basePrice),
      quantity: String(p.quantity),
      premium: String(p.premium),
    });
    setEditing(true);
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setFormError(null);
    const symbol = toYahooSymbol(draft.code);
    if (!SYMBOL_RE.test(symbol)) { setFormError('Geçersiz hisse kodu.'); return; }

    const basePrice = parseFloat(draft.basePrice);
    const quantity = parseFloat(draft.quantity);
    const premium = parseFloat(draft.premium || '0');
    if (!Number.isFinite(basePrice) || basePrice < 0) { setFormError('Maliyet/kullanım fiyatı geçersiz.'); return; }
    if (!Number.isFinite(quantity) || quantity <= 0) { setFormError('Miktar 0’dan büyük olmalı.'); return; }
    if (!Number.isFinite(premium)) { setFormError('Prim geçersiz.'); return; }

    setSaving(true);
    try {
      // Önce sembolün gerçekten çözüldüğünü doğrula — aksi halde takip listesine
      // fiyatı hiç gelmeyecek ölü bir satır eklenirdi.
      const quote = await loadStock(symbol);
      if (!quote) { setFormError(`${toBistCode(symbol)} için fiyat alınamadı — kodu kontrol edin.`); return; }

      const res = await fetch('/api/stocks/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, tradeType: draft.tradeType, basePrice, quantity, premium }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setFormError(body?.error ?? 'Kaydedilemedi.'); return; }

      setPositions(prev => ({ ...prev, [symbol]: { tradeType: draft.tradeType, basePrice, quantity, premium } }));
      setQuotes(prev => ({ ...prev, [symbol]: quote }));
      setLastUpdated(new Date());
      setDialogOpen(false);
    } catch {
      setFormError('Kaydedilemedi — bağlantı hatası.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (symbol: string) => {
    if (!window.confirm(`${toBistCode(symbol)} takip listesinden çıkarılsın mı?`)) return;
    const res = await fetch(`/api/stocks/positions?symbol=${encodeURIComponent(symbol)}`, { method: 'DELETE' });
    if (!res.ok) return;
    setPositions(prev => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });
  };

  const totalPnl = symbols.reduce((sum, s) => {
    const q = quotes[s];
    return q ? sum + calculatePnL(positions[s], q.price) : sum;
  }, 0);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 p-6 font-sans selection:bg-indigo-500/30">
      <div className="max-w-6xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-neutral-900/50 p-6 rounded-3xl border border-neutral-800/50 backdrop-blur-xl">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent flex items-center gap-3">
              <Activity className="w-8 h-8 text-indigo-400" />
              Anlık Portföy Takibi
            </h1>
            <p className="text-neutral-400 mt-2">
              BIST hisseleri · Turso veritabanı ile eşzamanlı müşteri prim ve kar/zarar durumu.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-neutral-400 text-right hidden sm:block">
              <div>Son Güncelleme</div>
              <div className="font-mono text-neutral-200">
                {lastUpdated ? lastUpdated.toLocaleTimeString('tr-TR') : '--:--:--'}
              </div>
            </div>
            <Button
              onClick={() => void refreshQuotes(symbols)}
              disabled={loading}
              variant="outline"
              className="rounded-xl border-neutral-700"
            >
              <RefreshCcw className={`w-4 h-4 sm:mr-2 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Yenile</span>
            </Button>
            <Button
              onClick={openAdd}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_rgba(79,70,229,0.4)]"
            >
              <Plus className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Yeni İşlem Ekle</span>
            </Button>
          </div>
        </div>

        {/* Toplam */}
        {symbols.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 rounded-2xl bg-neutral-900/40 border border-neutral-800/50">
            <span className="text-sm text-neutral-400 uppercase tracking-wider font-semibold">
              Toplam Net Kar / Zarar ({symbols.length} pozisyon)
            </span>
            <span className={`text-2xl font-black font-mono tracking-tighter ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalPnl >= 0 ? '+' : ''}{fmtTl(totalPnl)} <span className="text-base">₺</span>
            </span>
          </div>
        )}

        {/* Boş durum */}
        {symbols.length === 0 && !loading && (
          <Card className="bg-neutral-900/60 border-neutral-800/60 rounded-3xl">
            <CardContent className="py-16 text-center space-y-4">
              <Activity className="w-10 h-10 mx-auto text-neutral-700" />
              <div className="text-neutral-300 font-medium">Henüz takip edilen işlem yok</div>
              <p className="text-sm text-neutral-500 max-w-md mx-auto">
                &quot;Yeni İşlem Ekle&quot; ile bir BIST hissesi, maliyet ve prim girin; anlık fiyat
                çekilip kar/zarar hesaplanır.
              </p>
              <Button onClick={openAdd} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl">
                <Plus className="w-4 h-4 mr-2" /> Yeni İşlem Ekle
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Pozisyon kartları */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {symbols.map((symbol) => {
            const input = positions[symbol];
            const data = quotes[symbol];
            const code = toBistCode(symbol);
            const pnl = data ? calculatePnL(input, data.price) : 0;
            const isProfit = pnl >= 0;

            // previousClose gelmediğinde yüzde değişim HESAPLANMAZ (eskiden 0'a bölünüp
            // ekrana "NaN%" yazıyordu); rozet yerine "—" gösterilir.
            const pct = data && data.previousClose
              ? ((data.price - data.previousClose) / data.previousClose) * 100
              : null;
            const isPriceUp = (pct ?? 0) >= 0;

            return (
              <Card key={symbol} className="bg-neutral-900/60 border-neutral-800/60 backdrop-blur-md rounded-3xl overflow-hidden shadow-2xl transition-all duration-500 hover:border-neutral-700/80 hover:bg-neutral-900/80">
                <div className={`h-2 w-full bg-gradient-to-r ${
                  input.tradeType === 'long' ? 'from-indigo-500 to-cyan-500'
                    : input.tradeType.endsWith('_sell') ? 'from-amber-500 to-orange-600'
                    : 'from-sky-500 to-blue-600'
                }`} />

                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-2xl font-bold text-white tracking-tight font-mono">{code}</CardTitle>
                      <CardDescription className="text-neutral-400 mt-1 truncate">{bistName(symbol)}</CardDescription>
                      <Badge variant="outline" className="mt-2 border-neutral-700 text-neutral-300 text-[11px]">
                        {STOCK_TRADE_SHORT[input.tradeType]}
                      </Badge>
                    </div>

                    <div className="text-right shrink-0">
                      {data ? (
                        <>
                          <div className="text-3xl font-mono font-bold text-white tracking-tighter">
                            ₺{fmtTl(data.price)}
                          </div>
                          {pct != null ? (
                            <Badge variant="outline" className={`mt-2 font-mono ${isPriceUp ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                              {isPriceUp ? <ArrowUpIcon className="w-3 h-3 mr-1" /> : <ArrowDownIcon className="w-3 h-3 mr-1" />}
                              {Math.abs(pct).toFixed(2)}%
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="mt-2 font-mono border-neutral-700 text-neutral-500">
                              — değişim yok
                            </Badge>
                          )}
                        </>
                      ) : loading ? (
                        <div className="animate-pulse bg-neutral-800 h-10 w-24 rounded-lg" />
                      ) : (
                        <div className="flex items-center gap-1.5 text-amber-500 text-xs">
                          <AlertTriangle className="w-4 h-4" /> fiyat alınamadı
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5">
                  <div className="grid grid-cols-4 gap-3 p-4 bg-neutral-950/50 rounded-2xl border border-neutral-800/50 text-sm">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-neutral-500">
                        {isOptionTrade(input.tradeType) ? 'Kullanım' : 'Maliyet'}
                      </div>
                      <div className="font-mono text-neutral-200 mt-0.5">₺{fmtTl(input.basePrice)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-neutral-500">Miktar</div>
                      <div className="font-mono text-neutral-200 mt-0.5">{input.quantity} lot</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-neutral-500">Prim</div>
                      <div className="font-mono text-neutral-200 mt-0.5">₺{fmtTl(input.premium)}</div>
                    </div>
                    {/* Başabaş — net K/Z'nin sıfırlandığı hisse fiyatı, ok yönü kâr tarafını gösterir. */}
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-neutral-500 flex items-center gap-1">
                        Başabaş
                        <InfoHint label="Başabaş nedir" text={BREAKEVEN_INFO} />
                      </div>
                      {(() => {
                        const be = stockBreakEven(input.tradeType, input.basePrice, input.quantity, input.premium);
                        if (be == null) return <div className="font-mono text-neutral-600 mt-0.5">—</div>;
                        const above = stockProfitSide(input.tradeType) === 'above';
                        const reached = data ? (above ? data.price >= be : data.price <= be) : null;
                        return (
                          <div
                            className={`font-mono mt-0.5 ${reached == null ? 'text-neutral-200' : reached ? 'text-emerald-400' : 'text-red-400'}`}
                            title={`${fmtTl(be)} ₺ seviyesinin ${above ? 'ÜSTÜ' : 'ALTI'} kâr`}
                          >
                            ₺{fmtTl(be)}
                            <span className="ml-1 text-[10px]">{above ? '↑' : '↓'}</span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className={`p-6 rounded-2xl border transition-all duration-300 relative overflow-hidden ${
                    isProfit
                      ? 'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_30px_rgba(16,185,129,0.1)]'
                      : 'bg-red-500/10 border-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.1)]'
                  }`}>
                    <div className={`absolute -right-20 -top-20 w-40 h-40 blur-3xl opacity-20 rounded-full ${isProfit ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <div className="flex justify-between items-center relative z-10">
                      <div>
                        <div className={`text-sm font-semibold uppercase tracking-wider ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                          Net {isProfit ? 'Kar' : 'Zarar'} Durumu
                        </div>
                        <div className="text-neutral-400 text-xs mt-1">
                          {data ? 'Anlık fiyata göre hesaplanmıştır' : 'Fiyat bekleniyor'}
                        </div>
                      </div>
                      <div className={`text-4xl font-black font-mono tracking-tighter ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isProfit ? '+' : ''}{fmtTl(pnl)} <span className="text-xl">₺</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" className="border-neutral-700 rounded-xl" onClick={() => openEdit(symbol)}>
                      <Pencil className="w-3.5 h-3.5 mr-1.5" /> Düzenle
                    </Button>
                    <Button variant="outline" size="sm" className="border-neutral-700 text-rose-400 hover:text-rose-300 rounded-xl" onClick={() => void handleDelete(symbol)}>
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Sil
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <TradeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        draft={draft}
        setDraft={setDraft}
        editing={editing}
        onSave={() => void handleSave()}
        saving={saving}
        error={formError}
      />
    </div>
  );
}
