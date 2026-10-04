import type { Trade } from '@/types';
import type { MarketSnapshot, Quote, ScreenContext } from '../assistant/types';
import { quoteOption } from '../assistant/pricing';
import { metalProduct } from '../workspace';
import { dateDay } from './engine';

export interface TradeValuation {
  state: 'valued' | 'unavailable' | 'settled';
  positionValue: number | null;
  entryCashflow: number | null;
  pnl: number | null;
  valuationDate: string;
  spotAt: string | null;
  surfaceAt: string | null;
  warnings: string[];
  reason?: string;
}
export type TradeValuations = Record<string, TradeValuation>;

/** Customer perspective. Historical entry cashflow is never replaced with today's premium. */
export function valueTrade(trade: Trade, date: string, market?: MarketSnapshot): TradeValuation {
  const empty: TradeValuation = { state: 'unavailable', positionValue: null, entryCashflow: null, pnl: null,
    valuationDate: date, spotAt: null, surfaceAt: null, warnings: [] };
  const missing = (reason: string): TradeValuation => ({ ...empty, reason });
  if (trade.status === 'Closed') return { ...empty, state: 'settled', pnl: trade.pnl != null && Number.isFinite(trade.pnl) ? trade.pnl : null,
    reason: 'Gerçekleşen vade sonucu; güncel değerleme yapılmaz.' };
  if (!Number.isFinite(dateDay(trade.tradeDate.slice(0, 10))) || !Number.isFinite(dateDay(trade.expiryDate.slice(0, 10))))
    return missing('İşlem tarihi veya vade geçersiz.');
  if (trade.status === 'Expired' || trade.expiryDate.slice(0, 10) <= date)
    return missing('Vade sonucu bekleniyor; vade sonu spotu gerekli.');
  if (trade.tradeDate.slice(0, 10) > date) return missing('İşlem tarihi henüz gelmedi.');
  if (trade.barrierType) return missing('Güncel bariyer değeri için geçmiş gözlem bilgisi gerekli.');
  const product = metalProduct(trade.underlying);
  if (!product) return missing('Yalnız XAU / XAG değerlenir.');
  if (!['Call', 'Put'].includes(trade.type) || !['Long', 'Short'].includes(trade.position) ||
    !Number.isFinite(trade.premium) || trade.premium < 0 || !Number.isFinite(trade.contractSize) || trade.contractSize <= 0 ||
    !Number.isFinite(trade.strike) || trade.strike <= 0) return missing('İşlem koşulları veya giriş primi geçersiz.');
  if (!market) return missing('Terminal piyasa verisi okunamadı.');
  try {
    const screen: ScreenContext = { product, spot: 0, rate: 0, lease: 0, vol: 0, manualSpot: false, manualVol: false,
      strike: trade.strike, contractSize: trade.contractSize, tradeDate: date, expiryDate: trade.expiryDate.slice(0, 10), basis: 365 };
    const q: Quote = quoteOption({ product, type: trade.type, position: trade.position, strike: trade.strike,
      expiryDate: screen.expiryDate, tradeDate: date, contractSize: trade.contractSize, basis: 365 }, screen, market);
    const sign = trade.position === 'Long' ? 1 : -1;
    const positionValue = sign * q.premiumTotal, entryCashflow = -sign * trade.premium;
    const pnl = positionValue + entryCashflow;
    if (!Number.isFinite(pnl)) return missing('Kâr/zarar sayı sınırını aşıyor.');
    return { state: 'valued', positionValue, entryCashflow, pnl, valuationDate: date,
      spotAt: q.spotAt, surfaceAt: q.surfaceAt, warnings: q.warnings };
  } catch (e) { return missing(e instanceof Error ? e.message : 'Terminal bu işlemi değerleyemedi.'); }
}

/** An incomplete portfolio must not look like a complete zero or partial total. */
export function valuationTotal(trades: Trade[], values: TradeValuations) {
  const open = trades.filter(t => t.status !== 'Closed');
  const priced = open.filter(t => values[t.id]?.state === 'valued');
  return { count: open.length, valued: priced.length, missing: open.length - priced.length,
    pnl: priced.length === open.length ? priced.reduce((sum, t) => sum + values[t.id].pnl!, 0) : null };
}
