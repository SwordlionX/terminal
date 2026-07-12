import { evaluatePortfolio, EnrichedTrade } from "@/services/portfolio.service";
import { marginService } from "@/services/margin.service";
import { db } from "@/services/mockDb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function TradesBlotterPage() {
  const now = new Date().getTime();
  // Teminat: PnL/smile'a bağımlı değil, her zaman hesaplanır.
  const marginResults = await marginService.evaluateAllCustomers();
  const tradeCollaterals = await marginService.evaluateAllTradeCollaterals();
  const collateralByTrade = new Map(tradeCollaterals.map(c => [c.tradeId, c]));

  // PnL/nominal: canlı spot alınamazsa hata fırlatabilir — teminat tablolarını etkilemesin diye ayrı try/catch.
  let trades: EnrichedTrade[] = [];
  let pnlByCustomer = new Map<string, { openTrades: number; totalNotional: number; totalPnl: number }>();
  let pnlError: string | null = null;
  try {
    const result = await evaluatePortfolio();
    trades = result.trades;
    pnlByCustomer = new Map(result.customers.map(c => [c.customer.id, c]));
  } catch (e) {
    pnlError = e instanceof Error ? e.message : "PnL hesaplanamadı.";
    // PnL hesaplanamasa da açık işlemleri (strike, spot, teminat vs.) göstermeye devam edelim.
    const openTrades = (await db.trades.findMany()).filter(t => t.status === 'Open' || t.status === 'Near Expiry');
    const customerNames = new Map((await db.customers.findMany()).map(c => [c.id, c.companyName]));
    trades = openTrades.map(t => ({
      trade: t,
      customerName: customerNames.get(t.customerId) || 'Bilinmiyor',
      initialDaysToExpiry: Math.max(1, (new Date(t.expiryDate).getTime() - new Date(t.tradeDate).getTime()) / 86400000),
      daysToExpiry: Math.max(0.5, (new Date(t.expiryDate).getTime() - now) / 86400000),
      currentSpot: collateralByTrade.get(t.id)?.currentSpot ?? t.spot,
      spotIsLive: collateralByTrade.get(t.id)?.spotIsLive ?? false,
      notional: (collateralByTrade.get(t.id)?.currentSpot ?? t.spot) * t.contractSize,
      pnl: null,
    }));
  }

  const fc = (val: number | null) =>
    val == null ? "-" : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
  const anyLive = trades.some(t => t.spotIsLive);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">İşlemler (Portföy Takibi)</h1>
        <Badge variant="outline" className={anyLive ? "border-emerald-600 text-emerald-500" : "border-zinc-700 text-zinc-400"}>
          {anyLive ? "Canlı spot ile PnL" : "Canlı spot yok — giriş spotu ile PnL"}
        </Badge>
      </div>

      {pnlError && (
        <div className="rounded-md border border-amber-800/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-400">
          PnL hesaplanamadı: {pnlError} Teminat sütunları etkilenmez (ayrı ve sadece canlı spota bağlı).
        </div>
      )}

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
                <TableHead className="text-right" title="Açık pozisyonların büyüklüğü: canlı spot × kontrat">Nominal</TableHead>
                <TableHead className="text-right underline decoration-dotted decoration-zinc-600 underline-offset-4" title="Gerçek kâr/zarar: intrinsic − prim (primi netler). Müşteri bugün kapatsa net sonuç.">Açık Poz. K/Z</TableHead>
                <TableHead className="text-right underline decoration-dotted decoration-zinc-600 underline-offset-4" title="Teminat için BRÜT zarar: intrinsic, prim HARİÇ. Sadece müşteri aleyhine (>0). Zarar/Teminat oranı bunu kullanır.">Zarar</TableHead>
                <TableHead className="text-right" title="Yatırılan teminatın canlı USD değeri (haircut sonrası)">Mevcut Teminat</TableHead>
                <TableHead className="text-center underline decoration-dotted decoration-zinc-600 underline-offset-4" title="Ana risk metriği = Zarar ÷ Mevcut Teminat. %39 çağrı, %60/%80 kapatma.">Zarar / Teminat</TableHead>
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
                    <TableCell className="text-center">{pnl ? pnl.openTrades : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{pnl ? fc(pnl.totalNotional) : "—"}</TableCell>
                    <TableCell className={`text-right font-mono ${pnl && pnl.totalPnl >= 0 ? "text-emerald-500" : pnl ? "text-rose-500" : ""}`}>{pnl ? fc(pnl.totalPnl) : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-rose-500">{fc(margin.totalMtmLoss)}</TableCell>
                    <TableCell className="text-right font-mono">{fc(margin.totalCollateralValue)}</TableCell>
                    <TableCell className="text-center font-mono">%{(margin.marginCallRatio * 100).toFixed(1)}</TableCell>
                    <TableCell>
                      {margin.status === 'SAFE' && <Badge variant="outline" className="border-emerald-500 text-emerald-500">GÜVENLİ</Badge>}
                      {margin.status === 'MARGIN_CALL' && <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-500">TEMİNAT ÇAĞRISI</Badge>}
                      {margin.status === 'WARNING_60' && <Badge variant="secondary" className="bg-orange-500/20 text-orange-500">STOP UYARISI</Badge>}
                      {margin.status === 'STOP_LOSS_80' && <Badge variant="destructive">ANINDA STOP</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
              {marginResults.length === 0 && (
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
                <TableHead className="text-right">Miktar (Baz)</TableHead>
                <TableHead className="text-right">Başlangıç (gün)</TableHead>
                <TableHead className="text-right">Kalan (gün)</TableHead>
                <TableHead className="text-right">Spot</TableHead>
                <TableHead className="text-right">Prim (Giriş)</TableHead>
                <TableHead className="text-right underline decoration-dotted decoration-zinc-600 underline-offset-4" title="Gerçek kâr/zarar: intrinsic (canlı spot) − prim.">PnL</TableHead>
                <TableHead className="text-right underline decoration-dotted decoration-zinc-600 underline-offset-4" title="Açılışta yatan teminatı belirleyen kaldıraç oranı (vade × varlık grubu tablosundan kilitli). Canlı risk takibinde kullanılmaz.">Teminat Oranı</TableHead>
                <TableHead className="text-right underline decoration-dotted decoration-zinc-600 underline-offset-4" title="İşlem başına BRÜT zarar (prim hariç). Teminat çağrısı bunu kullanır.">Zarar (USD)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map(e => {
                const tc = collateralByTrade.get(e.trade.id);
                return (
                  <TableRow key={e.trade.id}>
                    <TableCell className="font-medium">{e.customerName}</TableCell>
                    <TableCell className="font-bold">{e.trade.underlying}</TableCell>
                    <TableCell>
                      <span className={e.trade.position === 'Long' ? 'text-emerald-500' : 'text-rose-500'}>
                        {e.trade.position}
                      </span>{' '}{e.trade.type}
                    </TableCell>
                    <TableCell className="text-right font-mono">{e.trade.strike}</TableCell>
                    <TableCell className="text-right font-mono">
                      {new Intl.NumberFormat('en-US').format(e.trade.contractSize)} {e.trade.underlying.split('/')[0]}
                    </TableCell>
                    <TableCell className="text-right font-mono">{e.initialDaysToExpiry.toFixed(0)}</TableCell>
                    <TableCell className="text-right font-mono">{e.daysToExpiry.toFixed(0)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {e.currentSpot?.toFixed(2)}
                      {!e.spotIsLive && <span className="text-zinc-500" title="Canlı spot alınamadı — giriş spotu">*</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono">{fc(e.trade.premium)}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${(e.pnl || 0) >= 0 ? "text-emerald-500" : e.pnl != null ? "text-rose-500" : ""}`}>{fc(e.pnl)}</TableCell>
                    <TableCell className="text-right font-mono">{e.trade.marginRate ? `${(e.trade.marginRate * 100).toFixed(2)}%` : '-'}</TableCell>
                    <TableCell className={`text-right font-mono ${(tc?.intrinsicLoss ?? 0) > 0 ? 'text-rose-500' : 'text-zinc-500'}`}>{tc && tc.intrinsicLoss > 0 ? fc(tc.intrinsicLoss) : '-'}</TableCell>
                  </TableRow>
                );
              })}
              {trades.length === 0 && (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                    Açık pozisyon yok. Fiyatlama ekranından veya müşteri sayfasından işlem ekleyin.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="text-[11px] text-zinc-500 mt-3">
            PnL = intrinsic değer (canlı spot vs strike) − prim; settleTradeAction&apos;daki gerçekleşen K/Z ile aynı
            formül, sadece vade spotu yerine canlı spot kullanılır. Black-Scholes/smile YOK. Zarar = işlem başına
            vadedeki brüt intrinsic zarar (prim hariç); müşteri risk takibi yukarıdaki özet tabloda
            <b> Zarar/Teminat</b> oranı üzerinden yapılır. Teminat Oranı, açılışta yatan teminatı belirleyen kaldıraç
            oranıdır. Spot 5 dakikada bir tazelenir.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
