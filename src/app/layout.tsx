import type { Metadata } from 'next';
import './globals.css';
import './terminal-design.css';
import { TERMINAL_DESIGN } from '@/lib/terminal-design';
import { TerminalShell } from '@/components/terminal-shell';
import './workspace.css';

export const metadata: Metadata = {
  title: 'Opsiyon Terminali',
  description: 'Kurumsal Opsiyon Terminali',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`h-full antialiased ${TERMINAL_DESIGN === 'terminal' ? 'dark' : ''}`}
      data-terminal-design={TERMINAL_DESIGN}
    >
      <body className="min-h-full overflow-x-hidden bg-background text-foreground">
        <TerminalShell>{children}</TerminalShell>
      </body>
    </html>
  );
}
