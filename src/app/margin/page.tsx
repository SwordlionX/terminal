import { db } from '@/services/mockDb';
import { marginService } from '@/services/margin.service';
import { RiskWorkspace } from '@/features/risk/risk-workspace';
import { activeTrade } from '@/lib/workspace';
export const dynamic = 'force-dynamic';
export default async function RiskPage() {
  const [results, trades] = await Promise.all([marginService.evaluateAllCustomers(), db.trades.findMany()]);
  const open = trades.filter(activeTrade), names = new Map(results.map(r => [r.customer.id, r.customer.companyName]));
  return <RiskWorkspace observedAt={new Date().toISOString()} rows={results.map(({ customer, margin }) => ({ id: customer.id, name: customer.companyName, branch: customer.branch, margin, open: open.filter(t => t.customerId === customer.id).length, nextExpiry: open.filter(t => t.customerId === customer.id).map(t => t.expiryDate.slice(0, 10)).sort()[0] ?? null }))} expiries={open.map(t => ({ id: t.id, customerName: names.get(t.customerId) ?? 'Müşteri', product: t.underlying, position: t.position, date: t.expiryDate, notional: t.spot * t.contractSize }))} />;
}
