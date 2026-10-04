"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorkspace } from '@/store/workspace';
import { TerminalAssistantLauncher } from '@/features/assistant/terminal-assistant-launcher';
import { TERMINAL_DESIGN } from '@/lib/terminal-design';
import { workspaceArea } from '@/lib/workspace';
const navigation = [ ['/', 'Fiyatlama', 'pricing'], ['/trades', 'Pozisyonlar', 'positions'], ['/customers', 'Müşteriler', 'customers'], ['/margin', 'Risk ve Teminat', 'risk'], ['/curves', 'Eğriler ve Veri', 'curves'] ] as const;
const tools = [ ['/', 'Vanilya'], ['/pricing/reverse-engineering', 'Hedef prim'], ['/pricing/barrier', 'Bariyer'], ['/pricing/delta-hedge', 'Delta hedge'] ];
export function TerminalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(), open = useWorkspace(s => s.assistantOpen), area = workspaceArea(pathname);
  return <div className={`terminal-shell ${open ? 'assistant-is-open' : ''}`}>
    <header className="workspace-header"><Link href="/" className="workspace-brand" aria-label="Terminal X fiyatlama">{TERMINAL_DESIGN === 'meridian' ? 'MERIDIAN' : 'TERMINAL'}<span> / X</span></Link><div className="workspace-brand-note">KIYMETLİ METALLER<span>ENDİKATİF OPSİYON MASASI</span></div><button id="terminal-assistant-launcher" className="desk-button workspace-assistant-button" aria-expanded={open} aria-controls="terminal-assistant-panel" onClick={() => useWorkspace.getState().toggle()}>{open ? 'Asistanı kapat ×' : 'Asistan ↗'}</button></header>
    <nav className="workspace-navigation" aria-label="Çalışma alanları">{navigation.map(([href, label, key], i) => <Link key={href} href={href} aria-current={area === key ? 'page' : undefined}><small>0{i + 1}</small>{label}</Link>)}</nav>
    <div className="workspace-body"><main id="workspace-content" className="workspace-content">{area === 'pricing' && <nav className="workspace-tools" aria-label="Fiyatlama araçları">{tools.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</Link>)}</nav>}{children}</main><TerminalAssistantLauncher /></div>
    <footer className="workspace-footer"><span>{TERMINAL_DESIGN === 'meridian' ? 'MERIDIAN' : 'TERMINAL X'} / METALS DESK</span><span>Avrupa tipi · müşteri perspektifi · CME / SOFR proxy</span><Link href="/settings">Veri yönetimi ↗</Link></footer>
  </div>;
}
