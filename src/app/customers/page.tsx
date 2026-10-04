import { CustomerFile } from '@/features/crm/customer-file';
export const dynamic = 'force-dynamic';
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ customer?: string; tab?: string }> }) {
  const query = await searchParams;
  return <CustomerFile id={query.customer} tab={query.tab} />;
}
