"use client";

import { useRef, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Sparkles } from 'lucide-react';

const AssistantPanel = dynamic(() => import('./terminal-assistant').then(mod => mod.TerminalAssistant), {
  ssr: false,
  loading: () => <p role="status" className="fixed right-5 bottom-24 z-40 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground">Asistan açılıyor…</p>,
});

export function TerminalAssistantLauncher() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  return <>
    <div role="status" aria-live="polite" aria-atomic="true" className={notice ? 'fixed right-5 bottom-24 z-40 max-w-[calc(100vw-2.5rem)] rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground shadow-lg' : 'sr-only'}>{notice}</div>
    <button id="terminal-assistant-launcher" onClick={() => { setMounted(true); setOpen(v => !v); }} aria-expanded={open} aria-label={open ? 'Asistanı kapat' : 'Terminal asistanını aç'} className="fixed right-5 bottom-5 z-40 flex min-h-11 items-center gap-2.5 rounded-full border border-primary/30 bg-primary px-5 py-3.5 text-sm font-semibold text-primary-foreground shadow-lg transition motion-reduce:transition-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
      <Sparkles size={18} />Terminal Asistanı
    </button>
    {mounted && <AssistantPanel open={open} onOpenChange={setOpen} onApplied={() => {
      setNotice('Hesap fiyatlama formuna uygulandı. Güncel verilerle yeniden fiyatlayabilirsin.');
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(''), 8000);
    }} />}
  </>;
}
