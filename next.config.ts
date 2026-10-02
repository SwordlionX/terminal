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
};

export default nextConfig;
