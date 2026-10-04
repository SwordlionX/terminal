"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
          <DialogTitle>{editing ? 'İşlemi düzenle' : 'Yeni işlem ekle'}</DialogTitle>
          <DialogDescription>Hisse, maliyet ve prim girin; anlık fiyatla kâr/zarar hesaplanır.</DialogDescription>
        </DialogHeader>
        <div className="stock-dialog-fields">
          {/* Native datalist: listede olmayan bir BIST kodu da elle yazılabilir. */}
          <label className="desk-field stock-dialog-wide">Hisse
            <input list="bist-tickers" value={draft.code} disabled={editing} placeholder="THYAO" onChange={e => set('code', e.target.value.toUpperCase())} />
          </label>
          <datalist id="bist-tickers">{BIST_TICKERS.map(t => <option key={t.code} value={t.code}>{t.name}</option>)}</datalist>
          <label className="desk-field stock-dialog-wide">İşlem tipi
            <select value={draft.tradeType} onChange={e => set('tradeType', normalizeStockTradeType(e.target.value) ?? 'put_sell')}>
              {STOCK_TRADE_TYPES.map(t => <option key={t} value={t}>{STOCK_TRADE_LABELS[t]}</option>)}
            </select>
          </label>
          <label className="desk-field">{isOpt ? 'Kullanım fiyatı · TL' : 'Maliyet fiyatı · TL'}
            <input type="number" step="0.01" placeholder="0,00" value={draft.basePrice} onChange={e => set('basePrice', e.target.value)} />
          </label>
          <label className="desk-field">Miktar · lot
            <input type="number" step="1" placeholder="0" value={draft.quantity} onChange={e => set('quantity', e.target.value)} />
          </label>
          <label className="desk-field stock-dialog-wide">{!isOpt ? 'Ek gelir / prim · TL toplam' : draft.tradeType.endsWith('_sell') ? 'Alınan prim · TL toplam' : 'Ödenen prim · TL toplam'}
            <input type="number" step="0.01" placeholder="0,00" value={draft.premium} onChange={e => set('premium', e.target.value)} />
          </label>
        </div>
        {!editing && <p className="desk-muted">Kod Yahoo&apos;da bulunamazsa işlem eklenmez.</p>}
        {error && <p className="desk-policy" role="status">{error}</p>}
        <button className="desk-button desk-button-primary" onClick={onSave} disabled={saving}>{saving ? 'Kaydediliyor…' : editing ? 'Güncelle' : 'İşlemi ekle'}</button>
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

  const signed = (v: number) => `${v >= 0 ? '+' : ''}${fmtTl(v)} TL`;
  const tone = (v: number) => (v >= 0 ? 'trade-value-profit' : 'trade-value-loss');
  const unpriced = symbols.filter(s => !quotes[s]).length;
  return (
    <div className="desk-workspace">
      <div className="workspace-heading">
        <div><h1>Portföy takip</h1><p>BIST · prim ve kâr/zarar takibi</p></div>
        <div className="workspace-toolbar" style={{ margin: 0 }}>
          <span className="desk-muted">Son güncelleme {lastUpdated ? lastUpdated.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—'}</span>
          <button className="desk-button" onClick={() => void refreshQuotes(symbols)} disabled={loading}>{loading ? 'Yenileniyor…' : 'Yenile'}</button>
          <button className="desk-button desk-button-primary" onClick={openAdd}>Yeni işlem ekle</button>
        </div>
      </div>

      <div className="workspace-metrics">
        <div><span>Toplam net K/Z · prim dahil</span><strong className={symbols.length ? tone(totalPnl) : undefined}>{symbols.length ? signed(totalPnl) : '—'}</strong><small>{unpriced ? `${unpriced} pozisyonun fiyatı alınamadı; toplam eksik` : 'Anlık fiyatla'}</small></div>
        <div><span>Takip edilen pozisyon</span><strong>{symbols.length}</strong></div>
        <div><span>Fiyat kaynağı</span><strong>Yahoo</strong><small>Dakikada bir yenilenir · tutarlar TL</small></div>
      </div>

      {symbols.length === 0 && !loading ? (
        <section className="workspace-panel"><p className="workspace-empty">Henüz takip edilen işlem yok. Takibe başlamak için işlem ekle.</p></section>
      ) : (
        <section className="position-register">
          <div className="workspace-table-scroll"><table className="workspace-table">
            <thead><tr><th>Hisse</th><th>İşlem</th><th className="number">Strike / maliyet</th><th className="number">Lot</th><th className="number">Prim</th><th className="number">Başabaş</th><th className="number">Fiyat</th><th className="number">Günlük</th><th className="number">Net K/Z</th><th /></tr></thead>
            <tbody>{symbols.map(symbol => {
              const input = positions[symbol], data = quotes[symbol];
              const pnl = data ? calculatePnL(input, data.price) : null;
              // previousClose gelmediğinde yüzde değişim hesaplanmaz.
              const pct = data && data.previousClose ? ((data.price - data.previousClose) / data.previousClose) * 100 : null;
              const be = stockBreakEven(input.tradeType, input.basePrice, input.quantity, input.premium);
              const above = stockProfitSide(input.tradeType) === 'above';
              return <tr key={symbol}>
                <td><strong>{toBistCode(symbol)}</strong><small>{bistName(symbol)}</small></td>
                <td>{STOCK_TRADE_SHORT[input.tradeType]}</td>
                <td className="number">{fmtTl(input.basePrice)}</td>
                <td className="number">{input.quantity.toLocaleString('tr-TR')}</td>
                <td className="number">{fmtTl(input.premium)}</td>
                <td className="number" title={be == null ? undefined : `${fmtTl(be)} TL seviyesinin ${above ? 'üstü' : 'altı'} kâr`}>{be == null ? '—' : `${fmtTl(be)} ${above ? '↑' : '↓'}`}</td>
                <td className="number">{data ? fmtTl(data.price) : loading ? '…' : 'Alınamadı'}</td>
                <td className={`number ${pct == null ? '' : tone(pct)}`}>{pct == null ? '—' : `${pct >= 0 ? '+' : '−'}%${fmtTl(Math.abs(pct))}`}</td>
                <td className={`number ${pnl == null ? '' : tone(pnl)}`}>{pnl == null ? '—' : signed(pnl)}</td>
                <td><div className="workspace-toolbar" style={{ margin: 0, flexWrap: 'nowrap' }}><button className="desk-button" onClick={() => openEdit(symbol)}>Düzenle</button><button className="desk-button" onClick={() => void handleDelete(symbol)}>Sil</button></div></td>
              </tr>;
            })}</tbody>
          </table></div>
        </section>
      )}
      <details className="workspace-notes"><summary>Başabaş</summary><p>{BREAKEVEN_INFO}</p></details>

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
