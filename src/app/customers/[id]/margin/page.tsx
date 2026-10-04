import { redirect } from 'next/navigation';
export default async function CustomerMarginPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/customers/${encodeURIComponent(id)}?tab=collateral`);
}
