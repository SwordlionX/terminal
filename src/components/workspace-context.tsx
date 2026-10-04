'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useWorkspace } from '@/store/workspace';
import type { WorkspaceArea } from '@/lib/workspace';
export function WorkspaceContext({
  area,
  customerId,
  tradeIds,
  label,
}: {
  area: WorkspaceArea;
  customerId?: string;
  tradeIds?: string[];
  label: string;
}) {
  const pathname = usePathname(),
    ids = JSON.stringify(tradeIds ?? []);
  useEffect(() => {
    useWorkspace.getState().select({ area, pathname, customerId, tradeIds: JSON.parse(ids), label });
  }, [area, pathname, customerId, ids, label]);
  return null;
}
export function AskAssistant({
  text,
  children = 'Asistanla değerlendir ↗',
}: {
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <button className="desk-button" onClick={() => useWorkspace.getState().ask(text)}>
      {children}
    </button>
  );
}
