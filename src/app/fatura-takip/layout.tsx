import type { Metadata, Viewport } from 'next';
import './invoices.css';
export const metadata: Metadata = {
  title: 'Fatura Takip | 3N Finans',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
  applicationName: 'Fatura Takip',
  description: '3N Finans mesnet, firma ve fatura takibi',
  manifest: '/fatura-takip/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Fatura Takip', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/fatura-takip/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/fatura-takip/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#152c45',
  colorScheme: 'light',
};
export default function InvoiceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
