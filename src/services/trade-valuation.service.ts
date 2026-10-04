import type { Trade } from '@/types';
import { terminalMarket } from '@/lib/assistant/market';
import { valuationToday } from '@/lib/assistant/policy';
import { valueTrade, type TradeValuations } from '@/lib/pricing/trade-valuation';
import { metalProduct } from '@/lib/workspace';

/** Read once per metal, reuse the same terminal snapshot for all rows; no DB writes or chain downloads. */
export async function valueTrades(trades: Trade[]): Promise<TradeValuations> {
  const date = valuationToday();
  const products = [
    ...new Set(
      trades
        .filter(
          t =>
            t.status !== 'Closed' &&
            t.status !== 'Expired' &&
            !t.barrierType &&
            t.tradeDate.slice(0, 10) <= date &&
            t.expiryDate.slice(0, 10) > date,
        )
        .map(t => metalProduct(t.underlying))
        .filter(p => p !== null),
    ),
  ];
  const snapshots = new Map(
    await Promise.all(products.map(async p => [p, await terminalMarket(p).catch(() => undefined)] as const)),
  );
  return Object.fromEntries(trades.map(t => [t.id, valueTrade(t, date, snapshots.get(metalProduct(t.underlying)!))]));
}
