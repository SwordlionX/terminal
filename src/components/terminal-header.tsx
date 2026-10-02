"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";

const routeTitles: Record<string, string> = {
  "/": "Ana Fiyatlama",
  "/dashboard": "Ana Ekran",
  "/pricing/reverse-engineering": "Tersine Mühendislik",
  "/pricing/delta-hedge": "Delta Hedge",
  "/margin": "Risk ve Teminat",
  "/customers": "Müşteriler",
  "/trades": "İşlemler",
  "/archive": "İşlem Arşivi",
  "/stock-tracker": "Portföy Takip",
  "/settings": "Ayarlar",
};

export function TerminalHeader() {
  const pathname = usePathname();
  const title = routeTitles[pathname] ?? routeTitles[Object.keys(routeTitles).find((route) => route !== "/" && pathname.startsWith(`${route}/`)) ?? ""] ?? "Opsiyon Terminali";

  return (
    <header className="sticky top-0 z-20 flex h-[68px] shrink-0 items-center justify-between border-b border-border/70 bg-background/90 px-4 backdrop-blur-xl md:px-7">
      <div className="flex min-w-0 items-center gap-3 md:gap-4">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
        <div className="h-7 w-px bg-border/80" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-foreground">{title}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Opsiyon çalışma alanı</p>
        </div>
      </div>
      <div className="hidden items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60 sm:flex">
        <span className="size-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgb(34_211_238/50%)]" />
        Terminal
      </div>
    </header>
  );
}
