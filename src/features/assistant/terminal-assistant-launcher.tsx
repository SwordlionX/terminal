"use client";
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useWorkspace } from '@/store/workspace';
const AssistantPanel = dynamic(() => import('./terminal-assistant').then(mod => mod.TerminalAssistant), { ssr: false,
  loading: () => <aside className="assistant-dock" role="status">Asistan açılıyor…</aside> });
export function TerminalAssistantLauncher() {
  const open = useWorkspace(s => s.assistantOpen);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { if (open) { const frame = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(frame); } }, [open]);
  return mounted ? <AssistantPanel open={open} onOpenChange={useWorkspace.getState().setOpen} /> : null;
}
