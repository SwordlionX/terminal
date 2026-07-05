import { db } from "@/services/mockDb";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CustomerTimeline } from "@/features/crm/customer-timeline";
import { CustomerNotes } from "@/features/crm/customer-notes";

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

export default async function CustomerDashboard({ params }: { params: { id: string } }) {
  const customer = await db.customers.findById(params.id);
  if (!customer) return notFound();

  const portfolio = await db.portfolio.findByCustomerId(params.id);

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
        <KPICard title="Total Open Positions" value={portfolio.totalOpenPositions} />
        <KPICard title="USD Notional" value="-" subtitle="Waiting for Margin Engine" />
        <KPICard title="Current MTM" value="-" subtitle="Waiting for live portfolio data" />
        <KPICard title="Total Profit/Loss" value="-" subtitle="Waiting for Margin Engine" />
        <KPICard title="Required Margin" value="-" subtitle="Waiting for Margin Engine" />
        <KPICard title="Available Margin" value="-" subtitle="Waiting for Margin Engine" />
        <KPICard title="Margin Utilization" value="-" subtitle="Waiting for Margin Engine" />
        <KPICard title="Risk Level" value={portfolio.riskLevel || "-"} subtitle="Pending Risk Engine" />
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
          
          <CustomerNotes customerId={customer.id} initialNotes={customer.notes} />
        </div>

        <div className="space-y-6">
          <CustomerTimeline customerId={customer.id} />
        </div>
      </div>
    </div>
  );
}
