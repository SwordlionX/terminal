import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { GlobalSearch } from "@/components/global-search";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ucan Finans Terminal",
  description: "Kurumsal Hazine Opsiyon Terminali",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SidebarProvider>
          <AppSidebar />
          <main className="flex-1 overflow-auto">
            <header className="flex h-12 items-center border-b px-4 justify-between">
              <div className="flex items-center">
                <SidebarTrigger />
                <div className="ml-4 font-semibold text-sm">Hazine Yönetimi</div>
              </div>
              <GlobalSearch />
            </header>
            <div className="p-4 md:p-6 lg:p-8">
              {children}
            </div>
          </main>
        </SidebarProvider>
      </body>
    </html>
  );
}
