"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Küçük "i" bilgi baloncuğu — TIKLAMAYLA açılır/kapanır, sabit bir açıklama gösterir.
 *
 * Neden Base UI Tooltip DEĞİL: o bileşen hover/odak ile açılmak üzere tasarlanmış ve
 * kontrollü modda bile kendi açma/kapama kurallarını uyguluyor — tıklayınca açılıyor ama
 * kapanmıyordu (buton odakta kaldığı sürece yeniden açılıyor). Dokunmatik ekranda hover
 * da yok. Bu yüzden baloncuk burada elle yönetiliyor.
 *
 * Portal kullanılıyor: kartların bir kısmı `overflow-hidden` (ör. portföy kartları),
 * normal akışta baloncuk kırpılırdı.
 */
export function InfoHint({
  text,
  label,
  className,
}: {
  /** Gösterilecek SABİT açıklama (değişkenlere göre güncellenmez). */
  text: string;
  /** Ekran okuyucu etiketi, ör. "Delta nedir". */
  label: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const bubbleRef = React.useRef<HTMLDivElement>(null);

  const BUBBLE_W = 260;

  const place = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Simge hizasında ortala, ekran kenarlarına 8px pay bırakarak kırp.
    const left = Math.min(Math.max(8, r.left + r.width / 2 - BUBBLE_W / 2), window.innerWidth - BUBBLE_W - 8);
    setPos({ top: r.top, left });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || bubbleRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onMove = () => setOpen(false); // kaydırma/yeniden boyutlandırmada konum bozulmasın
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className={cn(
          "inline-flex items-center justify-center align-middle text-zinc-500 transition-colors hover:text-zinc-300 focus-visible:text-zinc-300 focus-visible:outline-none",
          open && "text-zinc-200",
          className,
        )}
      >
        <Info className="size-3.5" />
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={bubbleRef}
          role="tooltip"
          data-slot="info-hint"
          style={{ position: "fixed", top: pos.top, left: pos.left, width: BUBBLE_W, transform: "translateY(-100%) translateY(-8px)" }}
          className="z-[100] rounded-md bg-zinc-100 px-3 py-2 text-xs leading-relaxed text-zinc-900 shadow-lg ring-1 ring-black/10 dark:bg-zinc-50"
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
