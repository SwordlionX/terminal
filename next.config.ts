import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack workspace kökünü bu projeye sabitle.
  // Aksi halde ev dizinindeki (C:\Users\User) başıboş package-lock.json yüzünden
  // Turbopack kökü tüm ev dizini seçiyor ve Downloads/AppData/node_modules dahil
  // her şeyi tarıyor -> dev sunucusu felaket yavaşlıyor.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
