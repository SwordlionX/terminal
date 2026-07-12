import { evaluatePortfolio } from "@/services/portfolio.service";
import { marginService } from "@/services/margin.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function BranchManagerDashboard() {
  // Teminat: PnL/smile'a bağımlı değil, her zaman hesaplanır.
  const marginResults = await marginService.evaluateAllCustomers();

  // PnL/nominal: canlı spot alınamazsa hata fırlatabilir — teminat tablosunu etkilemesin diye ayrı try/catch.
  let pnlByCustomer = new Map<string, { openTrades: number; totalNotional: number; totalPnl: number }>();
  let pnlError: string | null = null;
  try {
    const { customers } = await evaluatePortfolio();
    pnlByCustomer = new Map(customers.map(c => [c.customer.id, c]));
  } catch (e) {
    pnlError = e instanceof Error ? e.message : "PnL hesaplanamadı.";
  }

  const fc = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Şube Yönetim Konsolu</h1>

      {pnlError && (
        <div className="rounded-md border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-400">
          PnL/Nominal hesaplanamadı: {pnlError} Teminat sütunları etkilenmez.
        </div>
      )}

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
                <TableHead className="text-right">Açık Poz. K/Z</TableHead>
                <TableHead className="text-right">Zarar</TableHead>
                <TableHead className="text-right">Mevcut Teminat</TableHead>
                <TableHead className="text-center">Zarar / Teminat</TableHead>
                <TableHead className="text-right">Gerekli Ek Teminat</TableHead>
                <TableHead>Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {marginResults.map(({ customer, margin }) => {
                const pnl = pnlByCustomer.get(customer.id);
                return (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">
                      <a href={`/customers/${customer.id}`} className="text-primary hover:underline">{customer.companyName}</a>
                    </TableCell>
                    <TableCell>{customer.branch}</TableCell>
                    <TableCell className="text-center">{pnl ? pnl.openTrades : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{pnl ? fc(pnl.totalNotional) : "—"}</TableCell>
                    <TableCell className={`text-right font-mono ${pnl && pnl.totalPnl >= 0 ? "text-emerald-500" : pnl ? "text-rose-500" : ""}`}>{pnl ? fc(pnl.totalPnl) : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-rose-500">{fc(margin.totalMtmLoss)}</TableCell>
                    <TableCell className="text-right font-mono">{fc(margin.totalCollateralValue)}</TableCell>
                    <TableCell className="text-center font-mono">%{(margin.marginCallRatio * 100).toFixed(1)}</TableCell>
                    <TableCell className={`text-right font-mono ${margin.cureAmount > 0 ? "text-rose-500" : "text-zinc-500"}`}>{margin.cureAmount > 0 ? fc(margin.cureAmount) : "-"}</TableCell>
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
