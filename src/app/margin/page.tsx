import { marginService } from "@/services/margin.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function GlobalMarginDashboard() {
  const allEvaluations = await marginService.evaluateAllCustomers();

  let totalRequired = 0;
  let totalAvailable = 0;
  let totalMissing = 0;

  allEvaluations.forEach(e => {
    totalRequired += e.margin.totalRequiredMargin;
    totalAvailable += e.margin.totalCollateralValue;
    totalMissing += e.margin.missingMargin;
  });

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Hazine Teminat Yönetimi (Margin Dashboard)</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Required Margin</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalRequired)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Available Collateral (Haircut Sonrası)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">{formatCurrency(totalAvailable)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Missing Margin</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-500">{formatCurrency(totalMissing)}</div>
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
                <TableHead className="text-right">Required Margin</TableHead>
                <TableHead className="text-right">Available Collateral</TableHead>
                <TableHead className="text-right">Missing Margin</TableHead>
                <TableHead className="text-center">Zarar / Teminat</TableHead>
                <TableHead>Durum / Aksiyon</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allEvaluations.map(({ customer, margin }) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">
                    <a href={`/customers/${customer.id}/margin`} className="text-primary hover:underline">
                      {customer.companyName}
                    </a>
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(margin.totalRequiredMargin)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(margin.totalCollateralValue)}</TableCell>
                  <TableCell className="text-right text-rose-500">
                    {margin.missingMargin > 0 ? formatCurrency(margin.missingMargin) : '-'}
                  </TableCell>
                  <TableCell className="text-center font-mono">
                    %{(margin.marginCallRatio * 100).toFixed(1)}
                  </TableCell>
                  <TableCell>
                    {margin.status === 'SAFE' && <Badge variant="outline" className="border-emerald-500 text-emerald-500">GÜVENLİ</Badge>}
                    {margin.status === 'DEFICIT' && <Badge variant="outline" className="border-yellow-500 text-yellow-500">EKSİK TEMİNAT</Badge>}
                    {margin.status === 'MARGIN_CALL' && <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-500">TEMİNAT ÇAĞRISI (&gt;%40)</Badge>}
                    {margin.status === 'WARNING_60' && <Badge variant="secondary" className="bg-orange-500/20 text-orange-500">STOP UYARISI (&gt;%60)</Badge>}
                    {margin.status === 'STOP_LOSS_80' && <Badge variant="destructive">ANINDA STOP (&gt;%80)</Badge>}
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
