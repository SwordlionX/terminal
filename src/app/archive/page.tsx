import { TradeArchive } from "@/features/crm/trade-archive";
import { findArchivedTrades } from "@/repositories/trade-lifecycle.repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const customerId = typeof params.customer === "string" ? params.customer : undefined;
  const records = await findArchivedTrades(customerId);

  return <TradeArchive records={records} customerId={customerId} />;
}
