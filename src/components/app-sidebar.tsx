import {
  LayoutDashboard, Users, Calculator, Briefcase,
  ShieldAlert, Settings, PieChart
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
  SidebarHeader,
  SidebarFooter
} from "@/components/ui/sidebar";

const items = [
  { title: "Ana Ekran", url: "/dashboard", icon: LayoutDashboard },
  { title: "Müşteriler", url: "/customers", icon: Users },
  { title: "Fiyatlama", url: "/", icon: Calculator },
  { title: "Risk Merkezi", url: "/risk", icon: ShieldAlert },
  { title: "Teminat (Margin)", url: "/margin", icon: PieChart },
  { title: "İşlemler", url: "/trades", icon: Briefcase },
  { title: "Ayarlar", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarHeader>
        <div className="flex h-12 items-center px-4 font-bold text-lg tracking-tight text-primary">
          Ucan Finans
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Terminal Modülleri</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton>
                    <a href={item.url} className="flex items-center gap-2">
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
