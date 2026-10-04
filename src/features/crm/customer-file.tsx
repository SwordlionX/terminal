import { db } from '@/services/mockDb';
import { marginService, revalueCollaterals } from '@/services/margin.service';
import { collateralRepository } from '@/repositories/collateral.repository';
import { notFound } from 'next/navigation';
import { CustomerWorkspace } from './customer-workspace';
import { TradeManagement } from './trade-management';
import { CustomerNotes } from './customer-notes';
import { CustomerTimeline } from './customer-timeline';
import { DeleteCustomerButton } from './delete-customer-button';
import { CollateralManager } from '@/features/margin/collateral-manager';
import { MarginSimulation } from '@/features/margin/margin-simulation';
import { MarginStatusBadge, MarginRatioValue } from '@/features/margin/margin-status-badge';
import { AskAssistant } from '@/components/workspace-context';
import { activeTrade } from '@/lib/workspace';
import { formatMoney as analysisMoney } from '@/lib/format';

export async function CustomerFile({ id, tab }: { id?: string; tab?: string }) {
  const customers = await db.customers.findMany();
  const customer = id ? customers.find(c => c.id === id) : customers[0];
  if (id && !customer) notFound();
  const minimal = customers.map(c => ({ id: c.id, companyName: c.companyName, customerNumber: c.customerNumber, customerSegment: c.customerSegment }));
  if (!customer) return <CustomerWorkspace customers={minimal} selected={null} summary={null} trades={null} collateral={null} notes={null} />;
  const [trades, margin, collaterals, activity] = await Promise.all([db.trades.findByCustomerId(customer.id), marginService.evaluateCustomerMargin(customer.id), collateralRepository.findByCustomerId(customer.id).then(revalueCollaterals), db.activity.findByCustomerId(customer.id)]);
  const open = trades.filter(activeTrade), closed = trades.filter(t => t.status === 'Closed');
  const summary = <><div className="workspace-metrics"><div><span>Açık işlem</span><strong>{open.length}</strong><small>Vade öncesi fesih varsayılmaz.</small></div><div><span>Vade sonuçları · gerçekleşen K/Z</span><strong>{closed.some(t => t.pnl === null) ? 'Eksik sonuç' : analysisMoney(closed.reduce((s, t) => s + (t.pnl ?? 0), 0))}</strong></div><div><span>Gerekli ek teminat</span><strong>{analysisMoney(margin.cureAmount)}</strong><small>Prosedürün %35 hedefi</small></div></div><section className="workspace-panel"><div className="workspace-heading"><h2>Dosya bilgileri</h2><AskAssistant text="Seçili müşteri dosyasını oku. Açık işlemleri, vadesi yaklaşanları ve teminat durumunu özetleyerek müşteri görüşmesi için kısa bir hazırlık yap." /></div><dl className="customer-facts">{[['Müşteri numarası', customer.customerNumber], ['Segment', customer.customerSegment], ['Şube', customer.branch], ['Portföy yöneticisi', customer.portfolioManager], ['İlişki yöneticisi', customer.relationshipManager], ['Durum', customer.status === 'Active' ? 'Aktif' : 'Pasif']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl></section>{margin.dataWarning && <p className="desk-policy" style={{ marginTop: 20 }}>{margin.dataWarning}</p>}<div className="workspace-toolbar"><MarginStatusBadge dataWarning={margin.dataWarning} status={margin.status} withThresholds /><DeleteCustomerButton id={customer.id} name={customer.companyName} /></div></>;
  const collateral = <><div className="workspace-metrics"><div><span>Prosedür brüt zararı · prim hariç</span><strong>{analysisMoney(margin.totalMtmLoss)}</strong></div><div><span>Haircut sonrası teminat</span><strong>{analysisMoney(margin.totalCollateralValue)}</strong></div><div><span>Zarar / teminat</span><strong><MarginRatioValue margin={margin} /></strong></div></div>{margin.dataWarning && <p className="desk-policy">{margin.dataWarning}</p>}<p className="desk-policy">Bu ölçüm güncel spotun intrinsic etkisini teminat prosedürüne uygular. Opsiyonun zaman değerini içeren model K/Z veya erken kapatma bedeli değildir. Güncel spot alınamazsa kayıtlı değer kullanılır.</p><div className="workspace-grid"><CollateralManager customerId={customer.id} collaterals={collaterals} /><MarginSimulation initialLoss={margin.totalMtmLoss} initialCollateral={margin.totalCollateralValue} /></div></>;
  return <CustomerWorkspace key={customer.id} customers={minimal} selected={minimal.find(c => c.id === customer.id)!} tab={tab} summary={summary} trades={<TradeManagement customerId={customer.id} trades={trades} />} collateral={collateral} notes={<div className="space-y-6"><CustomerNotes customerId={customer.id} initialNotes={customer.notes} /><CustomerTimeline events={activity} /></div>} />;
}
