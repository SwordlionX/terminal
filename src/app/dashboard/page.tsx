import { db } from "@/services/mockDb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default async function BranchManagerDashboard() {
  const customers = await db.customers.findMany();
  const portfolios = await Promise.all(customers.map(c => db.portfolio.findByCustomerId(c.id)));

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
                <TableHead className="text-right">Gerekli Teminat</TableHead>
                <TableHead className="text-right">Mevcut Teminat</TableHead>
                <TableHead className="text-right">Açık/Fazla Teminat</TableHead>
                <TableHead>Risk Seviyesi</TableHead>
                <TableHead>Son Aktivite</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c, i) => {
                const port = portfolios[i];
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.companyName}</TableCell>
                    <TableCell>{c.branch}</TableCell>
                    <TableCell className="text-center">{port.totalOpenPositions}</TableCell>
                    <TableCell className="text-right">-</TableCell>
                    <TableCell className="text-right">-</TableCell>
                    <TableCell className="text-right">-</TableCell>
                    <TableCell className="text-right">-</TableCell>
                    <TableCell className="text-right">-</TableCell>
                    <TableCell>
                      <Badge variant="outline">{port.riskLevel || 'Pending Engine'}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(c.updatedDate).toLocaleDateString('tr-TR')}
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
