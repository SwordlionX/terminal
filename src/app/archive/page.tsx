import { findArchivedTrades } from '@/repositories/trade-lifecycle.repository';
import { db } from '@/services/mockDb';
import { PositionsWorkspace } from '@/features/crm/positions-workspace';
export const dynamic = 'force-dynamic';
export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; trade?: string }>;
}) {
  const query = await searchParams;
  const [trades, customers] = await Promise.all([db.trades.findMany(), db.customers.findMany()]);
  const archived = await findArchivedTrades();
  return (
    <PositionsWorkspace
      settlements={archived.map(a => ({ id: a.trade.id, closedAt: a.closedAt, expirySpot: a.expirySpot }))}
      archive
      initialCustomer={query.customer}
      initialTrade={query.trade}
      trades={trades}
      customers={customers.map(c => ({ id: c.id, companyName: c.companyName }))}
    />
  );
}
