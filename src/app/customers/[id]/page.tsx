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

  // Teminat, PnL/smile yeniden değerlemesinden bağımsız hesaplanır — sadece canlı spot + strike
  // kullanır, bu yüzden evaluatePortfolio() hata verse bile çalışmaya devam eder.
  const marginResult = await marginService.evaluateCustomerMargin(params.id);
  const portfolioTrades = await db.trades.findByCustomerId(params.id);
  const activity = await db.activity.findByCustomerId(params.id);

  // PnL: Black-Scholes/smile YOK, sadece canlı spot + strike (intrinsic - prim). Yine de canlı spot
  // alınamazsa evaluatePortfolio() hata fırlatabilir; bu durumda teminat/risk kartları etkilenmesin
  // diye try/catch'e alıyoruz.
  let myEnriched: Awaited<ReturnType<typeof evaluatePortfolio>>["trades"] = [];
  let pnlError: string | null = null;
  try {
    const { trades: enrichedAll } = await evaluatePortfolio();
    myEnriched = enrichedAll.filter(e => e.trade.customerId === params.id);
  } catch (e) {
    pnlError = e instanceof Error ? e.message : "PnL hesaplanamadı.";
  }

  const openTrades = portfolioTrades.filter(t => t.status === 'Open' || t.status === 'Near Expiry');
  const closedTrades = portfolioTrades.filter(t => t.status === 'Closed');

  // Açık işlemler için tabloda gösterilen PnL artık DB'ye yazılmıyor (bkz. portfolio.service.ts) —
  // canlı hesaplanan değeri burada işlem listesine bindiriyoruz. Kapalı işlemlerde stored pnl kalır
  // (settleTradeAction'ın gerçekleşen K/Z'si, geçmişe dönük değişmemeli).
  const livePnlById = new Map(myEnriched.map(e => [e.trade.id, e.pnl]));
  const tradesForManagement = pnlError
    ? portfolioTrades
    : portfolioTrades.map(t => (livePnlById.has(t.id) ? { ...t, pnl: livePnlById.get(t.id) ?? t.pnl } : t));

  const unrealizedPnl = myEnriched.reduce((sum, e) => sum + (e.pnl || 0), 0);
  const usdNotional = myEnriched.reduce((sum, e) => sum + e.notional, 0);
  const realizedPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
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

      {pnlError && (
        <div className="rounded-md border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-400">
          PnL hesaplanamadı: {pnlError} Teminat/risk kartları etkilenmez (ayrı ve sadece canlı spota bağlı hesaplanıyor).
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Total Open Positions" value={openTrades.length} />
        <KPICard title="Açık Pozisyon K/Z" value={pnlError ? "—" : formatCurrency(unrealizedPnl)} subtitle="Bugün kapatılsa ne kadar kâr/zarar (intrinsic - prim)" />
        <KPICard title="Realized PnL" value={formatCurrency(realizedPnl)} subtitle="Vadesi kapanmış işlemlerin kâr/zararı" />
        <KPICard title="USD Notional" value={pnlError ? "—" : formatCurrency(usdNotional)} subtitle="Açık pozisyonların nominal değeri" />
        <KPICard title="Zarar (Açık Poz.)" value={formatCurrency(marginResult.totalMtmLoss)} subtitle="Vadedeki brüt intrinsic zarar (prim hariç)" />
        <KPICard title="Mevcut Teminat" value={formatCurrency(marginResult.totalCollateralValue)} subtitle="Haircut sonrası, canlı" />
        <KPICard title="Zarar / Teminat" value={`%${(marginResult.marginCallRatio * 100).toFixed(1)}`} subtitle="Çağrı eşiği %39" />
        <KPICard
          title="Gerekli Ek Teminat"
          value={marginResult.cureAmount > 0 ? formatCurrency(marginResult.cureAmount) : "-"}
          subtitle="Oranı %35'e indirmek için"
        />
        <KPICard title="Risk Seviyesi" value={riskLabel} subtitle={`Zarar/Teminat %${(marginResult.marginCallRatio * 100).toFixed(1)}`} />
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
          <TradeManagement customerId={customer.id} trades={tradesForManagement} />

          <CustomerNotes customerId={customer.id} initialNotes={customer.notes} />
        </div>

        <div className="space-y-6">
          <CustomerTimeline events={activity} />
        </div>
      </div>
    </div>
  );
}
