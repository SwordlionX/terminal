import { db } from "@/services/mockDb";
import { evaluatePortfolio } from "@/services/portfolio.service";
import { marginService } from "@/services/margin.service";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CustomerTimeline } from "@/features/crm/customer-timeline";
import { CustomerNotes } from "@/features/crm/customer-notes";
import { TradeManagement } from "@/features/crm/trade-management";

function KPICard({ title, value, subtitle }: { title: string, value: React.ReactNode, subtitle?: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

export default async function CustomerDashboard(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const customer = await db.customers.findById(params.id);
  if (!customer) return notFound();

  const { trades: enrichedAll } = await evaluatePortfolio();
  const myEnriched = enrichedAll.filter(e => e.trade.customerId === params.id);
  const marginResult = await marginService.evaluateCustomerMargin(params.id);
  const portfolioTrades = await db.trades.findByCustomerId(params.id);

  const openTrades = portfolioTrades.filter(t => t.status === 'Open' || t.status === 'Near Expiry');
  const closedTrades = portfolioTrades.filter(t => t.status === 'Closed');

  const currentMtm = myEnriched.reduce((sum, e) => sum + (e.mtm || 0), 0);
  const usdNotional = myEnriched.reduce((sum, e) => sum + e.notional, 0);
  const maintenanceMargin = myEnriched.reduce((sum, e) => sum + e.maintenanceMargin, 0);
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const utilization = marginResult.totalCollateralValue > 0
    ? (marginResult.totalRequiredMargin / marginResult.totalCollateralValue) * 100 : 0;
  const riskLabel = marginResult.status === 'SAFE' ? 'Düşük'
    : marginResult.status === 'MARGIN_CALL' ? 'Teminat Çağrısı'
    : marginResult.status === 'WARNING_60' ? 'Yüksek' : 'Kritik';
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{customer.companyName}</h1>
          <p className="text-muted-foreground mt-1">Müşteri No: {customer.customerNumber} | Segment: {customer.customerSegment}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={customer.status === 'Active' ? 'default' : 'secondary'}>{customer.status}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Total Open Positions" value={openTrades.length} />
        <KPICard title="Current MTM" value={formatCurrency(currentMtm)} subtitle="Açık pozisyonların anlık MTM değeri" />
        <KPICard title="Realized PnL" value={formatCurrency(totalPnl)} subtitle="Vadesi kapanmış işlemlerin kâr/zararı" />
        <KPICard title="USD Notional" value={formatCurrency(usdNotional)} subtitle="Açık pozisyonların nominal değeri" />
        <KPICard title="Sürdürme Teminatı" value={formatCurrency(maintenanceMargin)} subtitle="Vade dilimine göre gereken teminat" />
        <KPICard title="Mevcut Teminat" value={formatCurrency(marginResult.totalCollateralValue)} subtitle="Haircut sonrası" />
        <KPICard title="Teminat Kullanımı" value={`%${utilization.toFixed(1)}`} subtitle="Gereken / Mevcut" />
        <KPICard title="Risk Seviyesi" value={riskLabel} subtitle={`Coverage %${(marginResult.coverageRatio * 100).toFixed(1)}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Müşteri Detayları</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted-foreground">Vergi No:</span> {customer.taxNumber}</div>
                <div><span className="text-muted-foreground">Şube:</span> {customer.branch}</div>
                <div><span className="text-muted-foreground">Portfolio Manager:</span> {customer.portfolioManager}</div>
                <div><span className="text-muted-foreground">Relationship Manager:</span> {customer.relationshipManager}</div>
                <div><span className="text-muted-foreground">Kayıt Tarihi:</span> {new Date(customer.createdDate).toLocaleDateString('tr-TR')}</div>
              </div>
            </CardContent>
          </Card>

          {/* İşlem Yönetimi Modülü */}
          <TradeManagement customerId={customer.id} trades={portfolioTrades} />

          <CustomerNotes customerId={customer.id} initialNotes={customer.notes} />
        </div>

        <div className="space-y-6">
          <CustomerTimeline customerId={customer.id} />
        </div>
      </div>
    </div>
  );
}
