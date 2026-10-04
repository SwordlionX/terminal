import { findArchivedTrades } from '@/repositories/trade-lifecycle.repository';
import { db } from '@/services/mockDb';
import { PositionsWorkspace } from '@/features/crm/positions-workspace';
export const dynamic = 'force-dynamic';
export default async function PositionsPage({ searchParams }: { searchParams: Promise<{ trade?: string; customer?: string }> }) {
  const [trades, customers, query] = await Promise.all([db.trades.findMany(), db.customers.findMany(), searchParams]);
  const archived = await findArchivedTrades();
  return <PositionsWorkspace settlements={archived.map(a => ({ id: a.trade.id, closedAt: a.closedAt, expirySpot: a.expirySpot }))} trades={trades} customers={customers.map(c => ({ id: c.id, companyName: c.companyName }))} initialTrade={query.trade} initialCustomer={query.customer} />;
}
