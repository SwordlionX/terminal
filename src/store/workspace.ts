'use client';
import { create } from 'zustand';
import type { WorkspaceSelection } from '@/lib/workspace';
export const useWorkspace = create<{
  assistantOpen: boolean;
  selection: (WorkspaceSelection & { pathname: string; label: string }) | null;
  prompt: { id: number; text: string } | null;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  select: (selection: WorkspaceSelection & { pathname: string; label: string }) => void;
  ask: (text: string) => void;
}>(set => ({
  assistantOpen: false,
  selection: null,
  prompt: null,
  toggle: () => set(s => ({ assistantOpen: !s.assistantOpen })),
  setOpen: assistantOpen => set({ assistantOpen }),
  select: selection => set({ selection }),
  ask: text => set({ assistantOpen: true, prompt: { id: Date.now(), text } }),
}));
