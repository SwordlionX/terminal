import { evaluatePortfolio } from "@/services/portfolio.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function TradesBlotterPage() {
  const { trades, customers } = await evaluatePortfolio();

  const fc = (val: number | null) =>
    val == null ? "-" : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
  const anyLive = trades.some(t => t.spotIsLive);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">İşlemler (Portföy Takibi)</h1>
        <Badge variant="outline" className={anyLive ? "border-emerald-600 text-emerald-500" : "border-slate-700 text-slate-400"}>
          {anyLive ? "Canlı spot ile MTM" : "Canlı spot yok — giriş spotu ile MTM"}
        </Badge>
      </div>

      {/* Müşteri Özeti */}
      <Card>
        <CardHeader>
          <CardTitle>Müşteri Bazlı Özet</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Müşteri</TableHead>
                <TableHead className="text-center">Açık İşlem</TableHead>
                <TableHead className="text-right">Nominal</TableHead>
                <TableHead className="text-right">Aktif K/Z (MTM)</TableHead>
                <TableHead className="text-right">Sürdürme Teminatı</TableHead>
                <TableHead className="text-right">Mevcut Teminat</TableHead>
                <TableHead className="text-center">Coverage</TableHead>
                <TableHead>Durum</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map(({ customer, openTrades, totalNotional, totalMtm, totalMaintenanceMargin, margin }) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">
                    <a href={`/customers/${customer.id}`} className="text-primary hover:underline">{customer.companyName}</a>
                  </TableCell>
                  <TableCell className="text-center">{openTrades}</TableCell>
                  <TableCell className="text-right font-mono">{fc(totalNotional)}</TableCell>
                  <TableCell className={`text-right font-mono ${totalMtm >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fc(totalMtm)}</TableCell>
                  <TableCell className="text-right font-mono">{fc(totalMaintenanceMargin)}</TableCell>
                  <TableCell className="text-right font-mono">{fc(margin.totalCollateralValue)}</TableCell>
                  <TableCell className="text-center font-mono">{(margin.coverageRatio * 100).toFixed(1)}%</TableCell>
                  <TableCell>
                    {margin.status === 'SAFE' && <Badge variant="outline" className="border-emerald-500 text-emerald-500">GÜVENLİ</Badge>}
                    {margin.status === 'MARGIN_CALL' && <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-500">TEMİNAT ÇAĞRISI</Badge>}
                    {margin.status === 'WARNING_60' && <Badge variant="secondary" className="bg-orange-500/20 text-orange-500">STOP UYARISI</Badge>}
                    {margin.status === 'STOP_LOSS_80' && <Badge variant="destructive">ANINDA STOP</Badge>}
                  </TableCell>
                </TableRow>
              ))}
              {customers.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Müşteri yok.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Açık Pozisyonlar Blotter */}
      <Card>
        <CardHeader>
          <CardTitle>Açık Pozisyonlar</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Müşteri</TableHead>
                <TableHead>Ürün</TableHead>
                <TableHead>Pozisyon</TableHead>
                <TableHead className="text-right">Strike</TableHead>
                <TableHead className="text-right">Miktar</TableHead>
                <TableHead className="text-right">Vade (gün)</TableHead>
                <TableHead className="text-right">Spot</TableHead>
                <TableHead className="text-right">IV</TableHead>
                <TableHead className="text-right">Prim (Giriş)</TableHead>
                <TableHead className="text-right">Güncel Değer</TableHead>
                <TableHead className="text-right">MTM</TableHead>
                <TableHead className="text-right">Sürd. Teminatı</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map(e => (
                <TableRow key={e.trade.id}>
                  <TableCell className="font-medium">{e.customerName}</TableCell>
                  <TableCell className="font-bold">{e.trade.underlying}</TableCell>
                  <TableCell>
                    <span className={e.trade.position === 'Long' ? 'text-emerald-500' : 'text-rose-500'}>
                      {e.trade.position}
                    </span>{' '}{e.trade.type}
                  </TableCell>
                  <TableCell className="text-right font-mono">{e.trade.strike}</TableCell>
                  <TableCell className="text-right font-mono">{e.trade.contractSize}</TableCell>
                  <TableCell className="text-right font-mono">{e.daysToExpiry.toFixed(0)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {e.currentSpot?.toFixed(2)}
                    {!e.spotIsLive && <span className="text-slate-500" title="Canlı spot alınamadı — giriş spotu">*</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {e.usedVol != null ? `%${(e.usedVol * 100).toFixed(1)}` : '-'}
                    {e.volSource === 'trade' && <span className="text-slate-500" title="Smile yok — işlem vol'ü">*</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono">{fc(e.trade.premium)}</TableCell>
                  <TableCell className="text-right font-mono">{fc(e.currentValue)}</TableCell>
                  <TableCell className={`text-right font-mono font-bold ${(e.mtm || 0) >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fc(e.mtm)}</TableCell>
                  <TableCell className="text-right font-mono">{fc(e.maintenanceMargin)}</TableCell>
                </TableRow>
              ))}
              {trades.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                    Açık pozisyon yok. Fiyatlama ekranından veya müşteri sayfasından işlem ekleyin.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="text-[11px] text-slate-500 mt-3">
            MTM = güncel opsiyon değeri (smile IV + canlı spot, GK) − giriş primi. Sürdürme teminatı, vade dilimine göre
            teminat oranları tablosundan hesaplanır. Spot 5 dakikada bir tazelenir.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
