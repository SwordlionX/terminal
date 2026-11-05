import type { Metadata } from 'next';
import './invoices.css';
export const metadata: Metadata = {
  title: 'Fatura Takip | 3N Finans',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function InvoiceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
