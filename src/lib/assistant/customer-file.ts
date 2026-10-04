import { db } from '@/services/mockDb';
import { resolveWorkspace } from './workspace-context';
import type { ScreenContext, WorkspaceSnapshot } from './types';

export async function readCustomerFile(
  query: string,
  screen: ScreenContext,
): Promise<{
  matches: { id: string; name: string }[];
  truncated: boolean;
  snapshot?: WorkspaceSnapshot;
}> {
  const fold = (s: string) => s.normalize('NFKC').toLocaleLowerCase('tr-TR').trim();
  const name = fold(query);
  if (name.length < 2 || name.length > 100) throw new Error('En az iki karakterlik müşteri adı gerekli.');
  const customers = await db.customers.findMany();
  const exact = customers.filter(c => fold(c.companyName) === name);
  const found = exact.length ? exact : customers.filter(c => fold(c.companyName).includes(name));
  const matches = found.slice(0, 8).map(c => ({ id: c.id, name: c.companyName }));
  // A partial name must never silently pick one person's financial file.
  if (found.length !== 1) return { matches, truncated: found.length > matches.length };
  const result = await resolveWorkspace({ area: 'customers', customerId: found[0].id }, screen);
  return { matches, truncated: false, snapshot: result.snapshot };
}
