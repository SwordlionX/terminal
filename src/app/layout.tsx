import type { Metadata } from "next";
import "./globals.css";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { TerminalHeader } from "@/components/terminal-header";
import { TerminalAssistantLauncher } from "@/features/assistant/terminal-assistant-launcher";

export const metadata: Metadata = {
  title: "Opsiyon Terminali",
  description: "Kurumsal Opsiyon Terminali",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className="h-full antialiased dark"
    >
      <body className="min-h-full overflow-x-hidden bg-background text-foreground">
        <SidebarProvider>
          <AppSidebar />
          <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
            <TerminalHeader />
            <div className="mx-auto w-full min-w-0 max-w-[1600px] flex-1 p-4 md:p-6 lg:p-8">
              {children}
            </div>
          </main>
        </SidebarProvider>
        <TerminalAssistantLauncher />
      </body>
    </html>
  );
}
