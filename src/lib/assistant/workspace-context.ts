import { db } from '@/services/mockDb';
import { marginService } from '@/services/margin.service';
import { activeTrade, metalProduct, validateWorkspace, type WorkspaceSelection } from '@/lib/workspace';
import type { ScreenContext, WorkspaceSnapshot } from './types';
export async function resolveWorkspace(value: unknown, screen: ScreenContext): Promise<{ selection: WorkspaceSelection; snapshot: WorkspaceSnapshot; screen: ScreenContext }> {
  const selection = validateWorkspace(value), observedAt = new Date().toISOString();
  let selectedTrades = selection.tradeIds?.length ? (await db.trades.findMany()).filter(t => selection.tradeIds!.includes(t.id)) : [];
  if (selection.tradeIds?.length !== undefined && selectedTrades.length !== selection.tradeIds.length) throw new Error('Seçili işlem artık bulunmuyor. Ekranı yenile.');
  const customerId = selection.customerId ?? selectedTrades[0]?.customerId;
  if (selectedTrades.some(t => t.customerId !== customerId)) throw new Error('Asistan bağlamında aynı müşterinin işlemlerini seç.');
  const customer = customerId ? await db.customers.findById(customerId) : null;
  if (customerId && !customer) throw new Error('Seçili müşteri bulunamadı.');
  let totalTrades = selectedTrades.length;
  if (customer && !selection.tradeIds?.length) {
    const all = await db.trades.findByCustomerId(customer.id), open = all.filter(activeTrade); totalTrades = open.length;
    selectedTrades = open.slice(0, 8);
  }
  const trades = selectedTrades.map(t => ({ id: t.id, customerId: t.customerId, product: metalProduct(t.underlying),
    underlying: t.underlying, type: t.type, position: t.position, strike: t.strike, expiryDate: t.expiryDate.slice(0, 10),
    originalTradeDate: t.tradeDate.slice(0, 10), contractSize: t.contractSize, premiumTotal: t.premium,
    entryPremiumPerUnit: t.contractSize > 0 ? t.premium / t.contractSize : null, status: t.status,
    barrier: t.barrierType ? { type: t.barrierType, level: t.barrierLevel, style: t.barrierStyle, historyRequired: true } : null }));
  const margin = customer ? await marginService.evaluateCustomerMargin(customer.id) : undefined;
  const snapshot: WorkspaceSnapshot = { area: selection.area, observedAt, customer: customer ? { id: customer.id, name: customer.companyName } : undefined,
    trades, totalTrades, truncated: totalTrades > trades.length, margin: margin ? { ...margin, method: 'Brüt intrinsic zarar; prim hariç. Model MTM değildir. Kaynak alınamazsa kayıtlı spot/teminat değerleri kullanılabilir.' } : undefined };
  if (selection.area === 'risk' && !customer) {
    const [results, all] = await Promise.all([marginService.evaluateAllCustomers(), db.trades.findMany()]);
    snapshot.riskSummary = { customerCount: results.length, openTrades: all.filter(activeTrade).length,
      cureAmount: results.reduce((s, r) => s + r.margin.cureAmount, 0),
      priorities: [...results].filter(r => r.margin.status !== 'SAFE' || r.margin.dataWarning).sort((a, b) => b.margin.cureAmount - a.margin.cureAmount).slice(0, 8).map(r => ({ customerId: r.customer.id, name: r.customer.companyName, cureAmount: r.margin.cureAmount, status: r.margin.status, dataWarning: r.margin.dataWarning })) };
  }
  const first = trades.length === 1 ? trades[0] : null;
  const currentScreen = trades.length ? { ...screen, tradeDate: observedAt.slice(0, 10) } : screen;
  return { selection, snapshot, screen: first?.product ? { ...currentScreen, product: first.product, type: first.type, position: first.position, strike: first.strike, contractSize: first.contractSize, expiryDate: first.expiryDate } : currentScreen };
}
