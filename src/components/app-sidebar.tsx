"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, Calculator, Briefcase,
  ShieldAlert, Settings, PieChart, ChevronDown,
  TrendingUpDown, Shield
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarHeader,
  SidebarFooter
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const items = [
  { title: "Ana Ekran", url: "/dashboard", icon: LayoutDashboard },
  { title: "Müşteriler", url: "/customers", icon: Users },
  {
    title: "Fiyatlama",
    url: "/",
    icon: Calculator,
    children: [
      { title: "Ana Fiyatlama", url: "/" },
      { title: "Tersine Mühendislik", url: "/pricing/reverse-engineering", icon: TrendingUpDown },
      { title: "Delta Hedge", url: "/pricing/delta-hedge", icon: Shield },
    ],
  },
  { title: "Risk Merkezi", url: "/risk", icon: ShieldAlert },
  { title: "Teminat (Margin)", url: "/margin", icon: PieChart },
  { title: "İşlemler", url: "/trades", icon: Briefcase },
  { title: "Ayarlar", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();
  const isPricingRoute = pathname === "/" || pathname.startsWith("/pricing");
  const [pricingOpen, setPricingOpen] = useState(isPricingRoute);

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader>
        <div className="flex h-12 items-center px-4" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Terminal Modülleri</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const hasChildren = "children" in item && item.children && item.children.length > 0;
                const isActive = !hasChildren && pathname === item.url;

                if (!hasChildren) {
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton isActive={isActive} render={
                        <Link href={item.url} className="flex items-center gap-2">
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      } />
                    </SidebarMenuItem>
                  );
                }

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      isActive={isPricingRoute}
                      onClick={() => setPricingOpen((v) => !v)}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                      <ChevronDown className={cn("ml-auto size-4 transition-transform", pricingOpen && "rotate-180")} />
                    </SidebarMenuButton>
                    {pricingOpen && (
                      <SidebarMenuSub>
                        {item.children!.map((child) => {
                          const childActive = pathname === child.url;
                          return (
                            <SidebarMenuSubItem key={child.url}>
                              <SidebarMenuSubButton
                                isActive={childActive}
                                render={
                                  <Link href={child.url} className="flex items-center gap-2">
                                    {"icon" in child && child.icon ? <child.icon /> : null}
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
      </SidebarContent>
      <SidebarFooter>
        <div className="p-4 text-xs text-muted-foreground">
          v1.0.0-beta
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
