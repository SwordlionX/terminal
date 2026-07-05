import { db } from "@/services/mockDb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default async function PortfolioPage() {
  const trades = await db.trades.findMany();
  const customers = await db.customers.findMany();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Portföy ve Açık İşlemler</h1>

      <Card>
        <CardHeader>
          <CardTitle>Tüm Pozisyonlar</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Müşteri</TableHead>
                <TableHead>İşlem Tarihi</TableHead>
                <TableHead>Vade</TableHead>
                <TableHead>Ürün</TableHead>
                <TableHead>Yön</TableHead>
                <TableHead>Tip</TableHead>
                <TableHead className="text-right">Nominal Tutar</TableHead>
                <TableHead className="text-right">Tahsil Edilen Prim</TableHead>
                <TableHead className="text-right">Güncel MTM</TableHead>
                <TableHead>Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((t) => {
                const customer = customers.find(c => c.id === t.customerId);
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{customer?.companyName || 'Bilinmiyor'}</TableCell>
                    <TableCell>{new Date(t.tradeDate).toLocaleDateString('tr-TR')}</TableCell>
                    <TableCell>{new Date(t.expiryDate).toLocaleDateString('tr-TR')}</TableCell>
                    <TableCell>{t.underlying}</TableCell>
                    <TableCell>
                      <Badge variant={t.position === 'Long' ? 'default' : 'destructive'}>{t.position}</Badge>
                    </TableCell>
                    <TableCell>{t.type}</TableCell>
                    <TableCell className="text-right">-</TableCell>
                    <TableCell className="text-right">${t.premium.toLocaleString('en-US', {minimumFractionDigits: 2})}</TableCell>
                    <TableCell className="text-right">-</TableCell>
                    <TableCell>
                      <Badge variant="outline">{t.status}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {trades.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    Gösterilecek işlem bulunamadı. Lütfen "Pricing" sayfasından yeni işlem kaydedin.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
