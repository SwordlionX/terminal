import { evaluatePortfolio } from "@/services/portfolio.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function BranchManagerDashboard() {
  const { customers } = await evaluatePortfolio();

  const fc = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Şube Yönetim Konsolu</h1>

      <Card>
        <CardHeader>
          <CardTitle>Müşteri Risk ve Teminat Özeti</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Müşteri</TableHead>
                <TableHead>Şube</TableHead>
                <TableHead className="text-center">Açık İşlemler</TableHead>
                <TableHead className="text-right">Nominal Hacim</TableHead>
                <TableHead className="text-right">Güncel MTM</TableHead>
                <TableHead className="text-right">Sürdürme Teminatı</TableHead>
                <TableHead className="text-right">Mevcut Teminat</TableHead>
                <TableHead className="text-right">Açık/Fazla Teminat</TableHead>
                <TableHead>Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map(({ customer, openTrades, totalNotional, totalMtm, totalMaintenanceMargin, margin }) => {
                const excess = margin.totalCollateralValue - margin.totalRequiredMargin;
                return (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">
                      <a href={`/customers/${customer.id}`} className="text-primary hover:underline">{customer.companyName}</a>
                    </TableCell>
                    <TableCell>{customer.branch}</TableCell>
                    <TableCell className="text-center">{openTrades}</TableCell>
                    <TableCell className="text-right font-mono">{fc(totalNotional)}</TableCell>
                    <TableCell className={`text-right font-mono ${totalMtm >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fc(totalMtm)}</TableCell>
                    <TableCell className="text-right font-mono">{fc(totalMaintenanceMargin)}</TableCell>
                    <TableCell className="text-right font-mono">{fc(margin.totalCollateralValue)}</TableCell>
                    <TableCell className={`text-right font-mono ${excess >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fc(excess)}</TableCell>
                    <TableCell>
                      {margin.status === 'SAFE' && <Badge variant="outline" className="border-emerald-500 text-emerald-500">GÜVENLİ</Badge>}
                      {margin.status === 'MARGIN_CALL' && <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-500">TEMİNAT ÇAĞRISI</Badge>}
                      {margin.status === 'WARNING_60' && <Badge variant="secondary" className="bg-orange-500/20 text-orange-500">STOP UYARISI</Badge>}
                      {margin.status === 'STOP_LOSS_80' && <Badge variant="destructive">ANINDA STOP</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
