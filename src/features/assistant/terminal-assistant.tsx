"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useShallow } from 'zustand/react/shallow';
import { ArrowUp, Sparkles, Square, RotateCcw, Maximize2, Minimize2, LockKeyhole, X, ChevronRight } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useMarketData } from '@/store/marketData';
import type { AssistantArtifact, AssistantEvent, ScreenContext } from '@/lib/assistant/types';
import { MANUAL_PRICING_BLOCKED } from '@/lib/assistant/policy';

interface Message { id: number; role: 'user' | 'assistant'; text: string; artifacts: AssistantArtifact[]; error?: string }
interface Availability { ready: boolean; accessRequired: boolean }
const ResultCard = dynamic(() => import('./result-cards').then(mod => mod.ResultCard), {
  loading: () => <p role="status" className="rounded-xl border border-white/10 p-4 text-xs text-slate-300">Hesap kartı yükleniyor…</p>,
});
const iconButton = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-white/5 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300';
const suggestions = [
  { title: 'Pozisyonun haritasını gör', text: 'Ekrandaki koşullarla müşteri put satışının fiyat ve tarih kâr zarar haritasını, delta ve gamma riskini göster. Avrupa tipi opsiyon için vade öncesi kullanım varsayma.' },
  { title: 'Bir fiyat al', text: 'Ekrandaki girdilerle müşteri için put satışını fiyatla.' },
  { title: 'Hedef primi bul', text: 'Ekrandaki ürün ve vade için spot nominalinin %5’i kadar prim sağlayan müşteri put satışını bul.' },
  { title: 'Alternatifleri karşılaştır', text: 'Ekrandaki strike ile müşteri put satışı ve aynı vadede daha düşük strike put alımı eklenmiş yapıyı karşılaştır. Maliyet ve vade sonu grafiğini göster.' },
];

export function TerminalAssistant({ open, onOpenChange, onApplied }: {
  open: boolean; onOpenChange: (open: boolean) => void; onApplied?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [code, setCode] = useState('');
  const [accessError, setAccessError] = useState('');
  const [accessBusy, setAccessBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [hasNewResponse, setHasNewResponse] = useState(false);
  const conversation = useRef<string | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const scrollContent = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const following = useRef(true);
  const md = useMarketData(useShallow(s => ({ product: s.product, contractSize: s.contractSize,
    tradeDate: s.tradeDate, expiryDate: s.expiryDate, manualSpot: s.manualSpot, manualVol: s.manualVol })));
  useEffect(() => {
    if (!open || !messages.length) return;
    if (following.current) {
      const frame = requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' }));
      return () => cancelAnimationFrame(frame);
    }
    if (messages.some(m => m.role === 'assistant' && (m.text || m.artifacts.length || m.error))) {
      const frame = requestAnimationFrame(() => setHasNewResponse(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [messages, status, open, busy]);
  useEffect(() => {
    if (!open || !messages.length || !scrollContent.current) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      if (following.current) frame = requestAnimationFrame(() => bottom.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' }));
    });
    observer.observe(scrollContent.current);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [open, messages.length]);
  useEffect(() => () => { abort.current?.abort(); }, []);

  const checkAvailability = useCallback(async () => {
    setAvailability(null);
    try {
      const res = await fetch('/api/assistant', { cache: 'no-store' });
      if (!res.ok) throw new Error('status');
      setAvailability(await res.json());
    } catch { setAvailability({ ready: false, accessRequired: false }); }
  }, []);
  useEffect(() => { if (open) void checkAvailability(); }, [open, checkAvailability]);
  const unlock = async () => {
    setAccessBusy(true); setAccessError('');
    try {
      const res = await fetch('/api/assistant/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      if (!res.ok) throw new Error('Erişim sağlanamadı. Kodu kontrol edin.');
      setCode(''); await checkAvailability();
    } catch (e) { setAccessError(e instanceof Error ? e.message : 'Erişim sağlanamadı.'); }
    finally { setAccessBusy(false); }
  };
  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !availability?.ready || availability.accessRequired) return;
    const userId = ++nextId.current, assistantId = ++nextId.current;
    setMessages(prev => [...prev, { id: userId, role: 'user', text, artifacts: [] }, { id: assistantId, role: 'assistant', text: '', artifacts: [] }]);
    following.current = true; setHasNewResponse(false); setAnnouncement('');
    setDraft(''); setBusy(true); setStatus('İsteğin değerlendiriliyor…');
    const controller = new AbortController(); abort.current = controller;
    const update = (fn: (m: Message) => Message) => setMessages(prev => prev.map(m => m.id === assistantId ? fn(m) : m));
    let complete = false, failed = false;
    try {
      const { product, spot, strike, rate, lease, vol, manualVol, manualSpot, contractSize, basis, tradeDate, expiryDate } = useMarketData.getState();
      const context = { product, spot, strike, rate, lease, vol, manualVol, manualSpot, contractSize, basis, tradeDate, expiryDate } as ScreenContext;
      const res = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, context, conversation: conversation.current }), signal: controller.signal });
      if (!res.ok) {
        const body = await res.json();
        if (res.status === 401) setAvailability(v => v ? { ...v, accessRequired: true } : { ready: true, accessRequired: true });
        throw new Error(body.error || 'Asistan isteği tamamlayamadı.');
      }
      if (!res.body) throw new Error('Asistan yanıtı alınamadı.');
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      const processLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as AssistantEvent | { type: 'conversation'; token: string };
        if (event.type === 'status') setStatus(event.text);
        else if (event.type === 'artifact') update(m => ({ ...m, artifacts: [...m.artifacts, event.artifact] }));
        else if (event.type === 'text') update(m => ({ ...m, text: m.text + event.text }));
        else if (event.type === 'error') { complete = true; failed = true; update(m => ({ ...m, error: event.text })); }
        else if (event.type === 'conversation') conversation.current = event.token;
        else if (event.type === 'done') complete = true;
      };
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        lines.forEach(processLine);
      }
      buffer += decoder.decode();
      if (buffer.trim()) processLine(buffer);
      if (!complete) throw new Error('Bağlantı kesildi veya süre doldu. Gelen hesap kartları korunuyor.');
    } catch (e) {
      failed = true;
      update(m => ({ ...m, error: controller.signal.aborted ? 'İstek durduruldu. Gelen hesap kartları korunuyor.'
        : e instanceof Error ? e.message : 'Asistan isteği tamamlayamadı.' }));
    } finally { if (abort.current === controller) {
      abort.current = null; setBusy(false); setStatus('');
      setAnnouncement(controller.signal.aborted ? 'İstek durduruldu.' : failed ? 'Yanıt tamamlanamadı. Ayrıntılar sohbette.' : 'Asistan yanıtı tamamlandı.');
    } }
  };
  const reset = () => { if (busy) return; setMessages([]); conversation.current = undefined; setDraft(''); setAnnouncement('Yeni sohbet açıldı.'); setHasNewResponse(false); following.current = true; composer.current?.focus(); };
  const days = Math.round((Date.parse(md.expiryDate) - Date.parse(md.tradeDate)) / 86400000);

  return <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent showCloseButton={false} finalFocus={() => document.getElementById('terminal-assistant-launcher')} className={`gap-0 border-border bg-background p-0 text-foreground motion-reduce:transition-none ${expanded ? '!w-full sm:!max-w-[900px]' : '!w-full sm:!max-w-[560px]'}`}>
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-5 py-5">
          <div className="flex min-w-0 gap-3"><span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-200/20 bg-cyan-200/10 min-[380px]:flex"><Sparkles size={19} className="text-cyan-200" /></span>
            <div className="min-w-0"><SheetTitle className="text-base text-white">Terminal Asistanı</SheetTitle><SheetDescription className="mt-1 text-xs text-slate-400">Fiyatla, karşılaştır, birlikte değerlendir.</SheetDescription></div></div>
          <div className="flex gap-1">
            <button onClick={reset} disabled={busy} aria-label="Yeni sohbet" title="Yeni sohbet" className={iconButton}><RotateCcw size={18} /></button>
            <button onClick={() => setExpanded(v => !v)} aria-label={expanded ? 'Paneli küçült' : 'Paneli genişlet'} className={`${iconButton} hidden sm:flex`}>{expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
            <button onClick={() => onOpenChange(false)} aria-label="Asistanı kapat" className={iconButton}><X size={19} /></button>
          </div>
        </header>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/5 bg-white/[0.025] px-5 py-2.5 text-xs text-slate-400">
          <span className="flex items-center gap-1.5 text-cyan-200"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />{md.product}</span>
          <span>{Number.isFinite(days) && days > 0 ? `${days} gün` : 'Vade kontrol edilmeli'}</span><span>{md.contractSize.toLocaleString('tr-TR')} {md.product === 'XAU' || md.product === 'XAG' ? 'ons' : 'adet'}</span>
          <span className="ml-auto text-slate-400">Aktif ekran bağlamı</span>
        </div>
        <p className="shrink-0 border-b border-white/5 px-5 py-2 text-xs leading-relaxed text-slate-400">Yalnız terminal eğrisiyle fiyatlama. Manuel piyasa varsayımları eğriyle tutarlılığı bozar.</p>
        {(md.manualSpot || md.manualVol) && <p role="alert" className="shrink-0 border-b border-amber-300/15 bg-amber-300/5 px-5 py-2 text-xs leading-relaxed text-amber-200">{MANUAL_PRICING_BLOCKED}</p>}
        <div ref={scrollArea} onScroll={e => {
          const area = e.currentTarget;
          following.current = area.scrollHeight - area.scrollTop - area.clientHeight < 96;
          if (following.current) setHasNewResponse(false);
        }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          <div ref={scrollContent}>
          {!messages.length && <div className="py-7">
            <p className="text-xs font-semibold tracking-[0.2em] text-cyan-200">TERMINAL X</p>
            <h2 className="mt-3 text-2xl font-semibold leading-tight tracking-tight">Bugün neyi<br />değerlendirelim?</h2>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">Hedefini veya pozisyonunu anlat. Terminal verileriyle fiyatları ve alternatifleri birlikte inceleyelim.</p>
            <div className="mt-7 space-y-2">{suggestions.map(s => <button key={s.title} onClick={() => { setDraft(s.text); composer.current?.focus(); }} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3.5 text-left transition motion-reduce:transition-none hover:border-cyan-200/30 hover:bg-cyan-200/5 focus-visible:outline-2 focus-visible:outline-cyan-300">
              <span className="text-xs font-medium text-slate-200">{s.title}</span><ChevronRight size={15} className="text-slate-400" /></button>)}</div>
            <p className="mt-5 text-xs leading-relaxed text-slate-400">Bu örneklerin dışında da sorabilirsin. Bütün fiyatlar Terminal X motorundan gelir.</p>
          </div>}
          <div className="space-y-5">{messages.map(m => <article key={m.id} className={m.role === 'user' ? 'ml-8 rounded-2xl rounded-tr-sm border border-white/10 bg-white/5 px-4 py-3' : 'space-y-3'}>
            {m.role === 'assistant' && <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-cyan-200"><Sparkles size={12} />Terminal Asistanı</p>}
            {m.text && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-200">{m.text}</p>}
            {m.artifacts.map((artifact, i) => <ResultCard key={i} artifact={artifact} onApply={() => { onOpenChange(false); onApplied?.(); }} />)}
            {m.error && <p role="alert" className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-relaxed text-amber-200">{m.error}</p>}
          </article>)}</div>
          {busy && <p role="status" className="mt-4 flex items-center gap-2 text-xs text-cyan-200"><span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300 motion-reduce:animate-none" />{status}</p>}
          <div ref={bottom} />
          </div>
        </div>
        <footer className="shrink-0 border-t border-white/10 px-5 py-4">
          <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
          {hasNewResponse && <button type="button" onClick={() => {
            following.current = true; setHasNewResponse(false);
            bottom.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
          }} className="mb-3 min-h-11 w-full rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 text-xs text-cyan-200 focus-visible:outline-2 focus-visible:outline-cyan-300">Yeni yanıtı göster ↓</button>}
          {availability?.accessRequired ? <form onSubmit={e => { e.preventDefault(); void unlock(); }} className="space-y-2">
            <label htmlFor="assistant-access" className="flex items-center gap-2 text-xs text-slate-400"><LockKeyhole size={13} />Asistan erişim kodu</label>
            <div className="flex gap-2"><input id="assistant-access" type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-cyan-300/40" />
              <button disabled={accessBusy || !code} className="min-h-11 rounded-xl bg-cyan-300 px-4 text-xs font-semibold text-slate-950 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">Giriş</button></div>
            {accessError && <p role="alert" className="text-xs text-amber-200">{accessError}</p>}
          </form> : <>
            {!availability?.ready && <p role="status" className="mb-3 rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300">{availability ? 'Asistan bağlantısı hazır değil. Fiyatlama ekranını kullanmaya devam edebilirsin.' : 'Asistan bağlantısı kontrol ediliyor…'}</p>}
            <form onSubmit={e => { e.preventDefault(); void send(); }} className="rounded-2xl border border-white/15 bg-white/[0.04] p-3 focus-within:border-cyan-200/40">
              <textarea ref={composer} aria-label="Asistana mesaj" placeholder="Hedefini veya sorunu yaz…" value={draft} maxLength={4000} rows={2} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
                className="max-h-40 min-h-14 w-full resize-none bg-transparent text-sm leading-relaxed text-slate-100 outline-none placeholder:text-slate-400" />
              <div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-slate-400">Enter ile gönder · Shift + Enter ile yeni satır</span>
                {busy ? <button type="button" onClick={() => abort.current?.abort()} aria-label="İsteği durdur" className={`${iconButton} border border-white/15`}><Square size={17} /></button>
                  : <button type="submit" disabled={!draft.trim() || !availability?.ready || availability.accessRequired} aria-label="Mesajı gönder" className={`${iconButton} bg-cyan-300 !text-slate-950 hover:bg-cyan-200 disabled:bg-white/10 disabled:!text-slate-400`}><ArrowUp size={19} /></button>}
              </div>
            </form>
            <p className="mt-2 text-center text-xs text-slate-400">Endikatif sonuçlar · Hesap anındaki veri ve varsayımlar</p>
          </>}
        </footer>
      </SheetContent>
    </Sheet>
  </>;
}
