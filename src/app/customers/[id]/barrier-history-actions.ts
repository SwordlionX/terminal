'use server';

import { db } from '@/services/mockDb';
import { validateId } from '@/lib/trade-validation';
import { checkTradeBarrierHistory } from '@/services/barrier-history.service';

export async function checkBarrierHistoryAction(customerId: string, tradeId: string) {
  validateId(customerId);
  validateId(tradeId, 'İşlem');
  const trades = await db.trades.findByCustomerId(customerId);
  const trade = trades.find(item => item.id === tradeId);
  if (!trade) throw new Error('Bu müşteriye ait işlem bulunamadı.');
  return checkTradeBarrierHistory(trade);
}
