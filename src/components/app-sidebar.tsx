"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Archive,
  BriefcaseBusiness,
  ChevronDown,
  CircleDollarSign,
  LayoutDashboard,
  Settings,
  Shield,
  ShieldAlert,
  Terminal,
  TrendingUpDown,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const groups = [
  {
    title: "Çalışma Alanı",
    items: [
      { title: "Ana Ekran", url: "/dashboard", icon: LayoutDashboard },
      {
        title: "Fiyatlama",
        url: "/",
        icon: CircleDollarSign,
        children: [
          { title: "Ana Fiyatlama", url: "/" },
          { title: "Tersine Mühendislik", url: "/pricing/reverse-engineering", icon: TrendingUpDown },
          { title: "Delta Hedge", url: "/pricing/delta-hedge", icon: Shield },
        ],
      },
      { title: "Risk ve Teminat", url: "/margin", icon: ShieldAlert },
    ],
  },
  {
    title: "Müşteri & İşlemler",
    items: [
      { title: "Müşteriler", url: "/customers", icon: Users },
      { title: "İşlemler", url: "/trades", icon: BriefcaseBusiness },
      { title: "İşlem Arşivi", url: "/archive", icon: Archive },
      { title: "Portföy Takip", url: "/stock-tracker", icon: Activity },
    ],
  },
  {
    title: "Sistem",
    items: [{ title: "Ayarlar", url: "/settings", icon: Settings }],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const isPricingRoute = pathname === "/" || pathname.startsWith("/pricing");
  const [pricingOpen, setPricingOpen] = useState(isPricingRoute);

  return (
    <Sidebar variant="sidebar" collapsible="icon" className="border-r border-sidebar-border/80">
      <SidebarHeader className="px-3 pt-4">
        <div className="flex h-12 items-center gap-3 rounded-xl px-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
            <Terminal className="size-[18px]" />
          </div>
          <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <p className="truncate text-[11px] font-semibold tracking-[0.18em] text-cyan-300">TERMINAL</p>
            <p className="mt-1 truncate text-xs text-sidebar-foreground/60">Opsiyon Masası</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-1 px-2 pt-5">
        {groups.map((group) => (
          <SidebarGroup key={group.title} className="py-2">
            <SidebarGroupLabel className="px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/45">
              {group.title}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {group.items.map((item) => {
                  const children = "children" in item ? item.children : undefined;
                  const hasChildren = Boolean(children?.length);
                  const isActive = hasChildren
                    ? isPricingRoute
                    : pathname === item.url || (item.url !== "/" && pathname.startsWith(`${item.url}/`));

                  if (!hasChildren) {
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          isActive={isActive}
                          className="h-10 rounded-lg px-3 text-[13px] data-active:bg-cyan-400/10 data-active:text-cyan-200 data-active:shadow-[inset_2px_0_0_0_rgb(34_211_238)]"
                          render={
                            <Link href={item.url} className="flex items-center gap-3">
                              <item.icon className={cn(isActive && "text-cyan-300")} />
                              <span>{item.title}</span>
                            </Link>
                          }
                        />
                      </SidebarMenuItem>
                    );
                  }

                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => setPricingOpen((value) => !value)}
                        className="h-10 rounded-lg px-3 text-[13px] data-active:bg-cyan-400/10 data-active:text-cyan-200 data-active:shadow-[inset_2px_0_0_0_rgb(34_211_238)]"
                      >
                        <item.icon className={cn(isActive && "text-cyan-300")} />
                        <span>{item.title}</span>
                        <ChevronDown className={cn("ml-auto size-4 text-sidebar-foreground/45 transition-transform", pricingOpen && "rotate-180")} />
                      </SidebarMenuButton>
                      {pricingOpen && (
                        <SidebarMenuSub className="ml-5 mt-1 border-sidebar-border/70">
                          {children?.map((child) => {
                            const childActive = pathname === child.url;
                            return (
                              <SidebarMenuSubItem key={child.url}>
                                <SidebarMenuSubButton
                                  isActive={childActive}
                                  className="rounded-md text-xs data-active:bg-cyan-400/10 data-active:text-cyan-200"
                                  render={
                                    <Link href={child.url} className="flex items-center gap-2">
                                      {"icon" in child && child.icon ? <child.icon /> : <span className="ml-1 size-1.5 rounded-full bg-current" />}
                                      <span>{child.title}</span>
                                    </Link>
                                  }
                                />
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="px-4 pb-4 pt-2 group-data-[collapsible=icon]:hidden">
        <div className="border-t border-sidebar-border/70 pt-3 text-[10px] tracking-wide text-sidebar-foreground/40">
          OPSİYON MASASI <span className="px-1.5 text-sidebar-foreground/25">·</span> v1.0.0-beta
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
