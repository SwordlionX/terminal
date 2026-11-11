import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Üretim: uygulama, bakım betikleri ve güncel route tipleri denetlenir.
  // Yerel deney dosyaları ve eski dev route çıktıları build kapsamına girmez.
  typescript: {
    tsconfigPath: process.env.NODE_ENV === "production" ? "tsconfig.build.json" : "tsconfig.json",
  },
  // Turbopack workspace kökünü bu projeye sabitle.
  // Aksi halde ev dizinindeki (C:\Users\User) başıboş package-lock.json yüzünden
  // Turbopack kökü tüm ev dizini seçiyor ve Downloads/AppData/node_modules dahil
  // her şeyi tarıyor -> dev sunucusu felaket yavaşlıyor.
  turbopack: {
    root: __dirname,
  },
  // Fatura Takip holds financial data: no framing, no referrer leakage of the setup link,
  // no plugin/base hijacking. Script sources are left to the framework defaults.
  async headers() {
    const invoiceHeaders = [
      {
        key: "Content-Security-Policy",
        value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
      },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    ];
    return [
      { source: "/fatura-takip", headers: invoiceHeaders },
      { source: "/fatura-takip/:path*", headers: invoiceHeaders },
      { source: "/api/fatura/:path*", headers: invoiceHeaders },
    ];
  },
};

export default nextConfig;
