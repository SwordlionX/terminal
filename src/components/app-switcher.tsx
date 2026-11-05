'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, FileText, Terminal } from 'lucide-react';

export function AppSwitcher() {
  const invoices = usePathname().startsWith('/fatura-takip');
  return (
    <details className="app-switcher">
      <summary aria-label="Uygulama değiştir">
        {invoices ? <FileText size={20} /> : <Terminal size={20} />}
        <span>
          {invoices ? 'FATURA TAKİP' : 'TERMINAL / X'}
          <small>{invoices ? 'Firma ve kullanım takibi' : 'Opsiyon masası'}</small>
        </span>
        <ChevronDown size={14} />
      </summary>
      <nav aria-label="Uygulamalar">
        <Link
          href="/"
          aria-current={!invoices ? 'page' : undefined}
          onClick={e => e.currentTarget.closest('details')?.removeAttribute('open')}
        >
          <Terminal size={17} />
          <span>
            Opsiyon Terminali<small>Fiyatlama, müşteri ve risk</small>
          </span>
        </Link>
        <Link
          href="/fatura-takip"
          aria-current={invoices ? 'page' : undefined}
          onClick={e => e.currentTarget.closest('details')?.removeAttribute('open')}
        >
          <FileText size={17} />
          <span>
            Fatura Takip<small>Faturalar ve kullanım geçmişi</small>
          </span>
        </Link>
      </nav>
    </details>
  );
}
