import Link from "next/link";
import { marginService } from "@/services/margin.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MarginStatusBadge, MarginRatioValue } from "@/features/margin/margin-status-badge";

export const dynamic = "force-dynamic";

export default async function GlobalMarginDashboard() {
  const allEvaluations = await marginService.evaluateAllCustomers();

  let totalLoss = 0;
  let totalAvailable = 0;
  let totalCure = 0;

  allEvaluations.forEach(e => {
    totalLoss += e.margin.totalMtmLoss;
    totalAvailable += e.margin.totalCollateralValue;
    totalCure += e.margin.cureAmount;
  });

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Hazine Teminat Yönetimi (Margin Dashboard)</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Toplam Zarar (Açık Pozisyonlar)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-500">{formatCurrency(totalLoss)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Toplam Mevcut Teminat (Haircut Sonrası)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">{formatCurrency(totalAvailable)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Toplam Gerekli Ek Teminat (%35 hedef)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-500">{formatCurrency(totalCure)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Müşteri Risk Durumları (Margin Call & Stop Out)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Müşteri</TableHead>
                <TableHead className="text-right">Zarar</TableHead>
                <TableHead className="text-right">Mevcut Teminat</TableHead>
                <TableHead className="text-right">Gerekli Ek Teminat</TableHead>
                <TableHead className="text-center">Zarar / Teminat</TableHead>
                <TableHead>Durum / Aksiyon</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allEvaluations.map(({ customer, margin }) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">
                    <Link href={`/customers/${customer.id}/margin`} className="text-primary hover:underline">
                      {customer.companyName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right text-rose-500">{formatCurrency(margin.totalMtmLoss)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(margin.totalCollateralValue)}</TableCell>
                  <TableCell className="text-right text-rose-500">
                    {margin.cureAmount > 0 ? formatCurrency(margin.cureAmount) : '-'}
                  </TableCell>
                  <TableCell className="text-center font-mono">
                    <MarginRatioValue margin={margin} />
                  </TableCell>
                  <TableCell>
                    <MarginStatusBadge status={margin.status} withThresholds />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
