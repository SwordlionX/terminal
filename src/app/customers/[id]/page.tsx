import { CustomerFile } from '@/features/crm/customer-file';
export const dynamic = 'force-dynamic';
export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <CustomerFile id={id} tab={query.tab} />;
}
