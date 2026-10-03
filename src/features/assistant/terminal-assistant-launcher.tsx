"use client";

import { useRef, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Sparkles } from 'lucide-react';

const AssistantPanel = dynamic(() => import('./terminal-assistant').then(mod => mod.TerminalAssistant), {
  ssr: false,
  loading: () => <p role="status" className="fixed right-5 bottom-24 z-40 rounded-xl border border-cyan-200/20 bg-[#09141e] px-4 py-3 text-sm text-cyan-100">Asistan açılıyor…</p>,
});

export function TerminalAssistantLauncher() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  return <>
    <div role="status" aria-live="polite" aria-atomic="true" className={notice ? 'fixed right-5 bottom-24 z-40 max-w-[calc(100vw-2.5rem)] rounded-xl border border-cyan-200/20 bg-[#12394a] px-4 py-3 text-sm text-cyan-50 shadow-lg' : 'sr-only'}>{notice}</div>
    <button id="terminal-assistant-launcher" onClick={() => { setMounted(true); setOpen(v => !v); }} aria-expanded={open} aria-label={open ? 'Asistanı kapat' : 'Terminal asistanını aç'} className="fixed right-5 bottom-5 z-40 flex min-h-11 items-center gap-2.5 rounded-full border border-cyan-200/30 bg-[#12394a] px-5 py-3.5 text-sm font-semibold text-cyan-50 shadow-[0_8px_40px_#0008] transition motion-reduce:transition-none hover:bg-[#184d63] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300">
      <Sparkles size={18} className="text-cyan-200" />Terminal Asistanı
    </button>
    {mounted && <AssistantPanel open={open} onOpenChange={setOpen} onApplied={() => {
      setNotice('Hesap fiyatlama formuna uygulandı. Güncel verilerle yeniden fiyatlayabilirsin.');
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(''), 8000);
    }} />}
  </>;
}
