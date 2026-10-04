"use client";
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Archive, ChartNoAxesCombined, ChevronDown, CircleDollarSign, PanelLeft, Settings, Shield, Sparkles, Terminal, Users, Wallet } from 'lucide-react';
import { useWorkspace } from '@/store/workspace';
import { TerminalAssistantLauncher } from '@/features/assistant/terminal-assistant-launcher';
import { areaLabels, workspaceArea } from '@/lib/workspace';

const tools = [['/', 'Ana fiyatlama'], ['/pricing/reverse-engineering', 'Hedef prim'], ['/pricing/position-analysis', 'Pozisyon analizi'], ['/pricing/delta-hedge', 'Delta hedge']] as const;
const groups = [
  { label: 'MÜŞTERİ VE İŞLEMLER', items: [['/trades', 'Pozisyonlar', Wallet], ['/customers', 'Müşteriler', Users], ['/archive', 'İşlem arşivi', Archive]] },
  { label: 'PİYASA VE RİSK', items: [['/margin', 'Risk ve teminat', Shield], ['/curves', 'Eğriler ve veri', ChartNoAxesCombined]] },
  { label: 'SİSTEM', items: [['/settings', 'Ayarlar', Settings], ['/stock-tracker', 'Portföy takip', Activity]] },
] as const;

export function TerminalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(), open = useWorkspace(s => s.assistantOpen);
  const [collapsed, setCollapsed] = useState(false), [mobileOpen, setMobileOpen] = useState(false), [pricingOpen, setPricingOpen] = useState(true);
  const pricing = pathname === '/' || pathname.startsWith('/pricing');
  const closeMenu = () => setMobileOpen(false);
  return <div className={`terminal-shell sidebar-shell ${collapsed ? 'sidebar-collapsed' : ''} ${mobileOpen ? 'sidebar-mobile-open' : ''} ${open ? 'assistant-is-open' : ''}`}>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Menüyü kapat" onClick={closeMenu} />}
    <aside id="terminal-navigation" className="terminal-sidebar" aria-label="Terminal menüsü">
      <Link href="/" onClick={closeMenu} className="sidebar-brand" aria-label="Terminal X fiyatlama"><Terminal size={20} /><span>TERMINAL / X<small>Opsiyon masası</small></span></Link>
      <nav aria-label="Çalışma alanları">
        <p className="sidebar-group-label">ÇALIŞMA ALANI</p>
        <button className="sidebar-item" aria-expanded={pricingOpen} aria-controls="pricing-submenu" data-active={pricing} onClick={() => { if (collapsed) setCollapsed(false); setPricingOpen(!pricingOpen || collapsed); }} title="Fiyatlama"><CircleDollarSign size={17} /><span>Fiyatlama</span><ChevronDown size={14} className={pricingOpen ? 'sidebar-chevron expanded' : 'sidebar-chevron'} /></button>
        {pricingOpen && <div id="pricing-submenu" className="sidebar-submenu">{tools.map(([href, label]) => <Link key={href} href={href} onClick={closeMenu} aria-current={pathname === href ? 'page' : undefined}><span className="sidebar-dot" />{label}</Link>)}</div>}
        {groups.map(group => <div key={group.label}><p className="sidebar-group-label">{group.label}</p>{group.items.map(([href, label, Icon]) => <Link className="sidebar-item" key={href} title={label} href={href} onClick={closeMenu} aria-current={pathname === href || pathname.startsWith(href + '/') ? 'page' : undefined}><Icon size={17} /><span>{label}</span></Link>)}</div>)}
      </nav>
      <div className="sidebar-footer">XAU / XAG <span>· AVRUPA TİPİ</span></div>
    </aside>
    <div className="terminal-main">
      <header className="workspace-header"><button className="sidebar-toggle desk-button" aria-label="Menüyü aç veya daralt" aria-controls="terminal-navigation" onClick={() => { if (window.matchMedia('(max-width:900px)').matches) { setCollapsed(false); setMobileOpen(!mobileOpen); } else setCollapsed(!collapsed); }}><PanelLeft size={17} /></button><div><strong>{pathname === '/' || pathname === '/pricing/barrier' ? 'Ana fiyatlama' : tools.find(([href]) => href === pathname)?.[1] ?? areaLabels[workspaceArea(pathname)]}</strong><small>Opsiyon çalışma alanı</small></div><span className="header-status"><i />TERMINAL</span></header>
      <div className="workspace-body"><main id="workspace-content" className="workspace-content">{children}</main></div>
      <footer className="workspace-footer"><span>TERMINAL X / METALS DESK</span><span>Avrupa tipi · CME / SOFR proxy</span><Link href="/settings">Veri yönetimi ↗</Link></footer>
    </div>
    <button id="terminal-assistant-launcher" className="assistant-floating-launcher" aria-expanded={open} aria-controls="terminal-assistant-panel" onClick={() => useWorkspace.getState().toggle()}><Sparkles size={18} />{open ? 'Asistanı kapat' : 'Terminal Asistanı'}</button>
    <TerminalAssistantLauncher />
  </div>;
}
