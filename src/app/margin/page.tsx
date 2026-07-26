import Link from "next/link";
import { db } from "@/services/mockDb";
import { marginService, revalueCollaterals } from "@/services/margin.service";
import { evaluatePortfolio } from "@/services/portfolio.service";
import { collateralRepository } from "@/repositories/collateral.repository";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MarginStatusBadge, MarginRatioValue } from "@/features/margin/margin-status-badge";
import { PortfolioSummary } from "@/features/risk/portfolio-summary";
import { HeatMap, HeatMapCustomer } from "@/features/risk/heat-map";
import { ExposureDashboard, ExposureData } from "@/features/risk/exposure-dashboard";
import { ExpiryCalendar, ExpiryItem } from "@/features/risk/expiry-calendar";

export const dynamic = "force-dynamic";

/**
 * Risk ve Teminat Merkezi — eskiden AYRI olan /risk (Risk Merkezi) ile /margin (Teminat)
 * burada birleşti. İkisi de aynı iki servisten (marginService + evaluatePortfolio)
 * besleniyor ve müşteri bazlı risk özetini ayrı ayrı gösteriyordu.
 *
 * Bu sayfanın başka hiçbir yerde bulunmayan çıktısı: "Gerekli Ek Teminat" (cure amount) —
 * zarar/teminat oranını prosedürdeki %35 hedefine indirmek için müşteriden istenecek tutar.
 * Durum eşikleri (margin call / %60 uyarı / %80 stop) ve 1M TL onay eşiği bunun üzerinden.
 *
 * NOT: Greeks Dashboard ve Stress Testing kasıtlı olarak yok. İkisi de Black-Scholes tabanlı
 * hedge/risk analitiğiydi — şube kendi opsiyon kitabını hedge etmiyor, bunu hazine + karşı
 * taraf banka back-to-back yönetiyor. Şube seviyesinde anlamlı olan, müşterinin bugünkü
 * basit K/Z'si (intrinsic − prim) ve teminat durumu.
 */
export default async function RiskAndMarginPage() {
  const marginResults = await marginService.evaluateAllCustomers();
  const allTrades = await db.trades.findMany();
  const allCustomers = await db.customers.findMany();
  const allCollaterals = await revalueCollaterals(await collateralRepository.findAll());

  // Canlı PnL/notional — evaluatePortfolio() açık işlemleri canlı spotla yeniden değerler
  // (PnL = intrinsic[canlı spot vs strike] × kontrat − prim). Canlı spot alınamazsa throw
  // eder; o durumda kartlar çökmesin diye giriş spotu + son kaydedilen pnl'e düşülür ve
  // ekranda uyarı gösterilir. TEMİNAT oranları bundan etkilenmez (ayrı hesaplanıyor).
  const enrichedById = new Map<string, { pnl: number; notional: number }>();
  let pnlError: string | null = null;
  try {
    const { trades } = await evaluatePortfolio();
    for (const e of trades) enrichedById.set(e.trade.id, { pnl: e.pnl ?? 0, notional: e.notional });
  } catch (e) {
    pnlError = e instanceof Error ? e.message : "Canlı PnL hesaplanamadı.";
  }
  const livePnl = (t: (typeof allTrades)[number]) => enrichedById.get(t.id)?.pnl ?? (t.pnl || 0);
  const liveNotional = (t: (typeof allTrades)[number]) => enrichedById.get(t.id)?.notional ?? t.contractSize * t.spot;

  /* ---- Teminat toplamları ---- */
  let totalLoss = 0, totalCollateral = 0, totalCure = 0;
  marginResults.forEach(r => {
    totalLoss += r.margin.totalMtmLoss;
    totalCollateral += r.margin.totalCollateralValue;
    totalCure += r.margin.cureAmount;
  });

  /* ---- Portföy toplamları + kırılımlar ---- */
  let totalNotional = 0, totalPnl = 0;
  const productMap: Record<string, number> = {};
  const directionMap: Record<string, number> = { Long: 0, Short: 0 };
  const expiryMap: Record<string, number> = { "< 1 Hafta": 0, "< 1 Ay": 0, "> 1 Ay": 0 };
  const expiryItems: ExpiryItem[] = [];
  const nowMs = new Date().getTime();

  for (const t of allTrades) {
    if (t.status !== 'Open' && t.status !== 'Near Expiry') continue;

    const notional = liveNotional(t);
    totalNotional += notional;
    totalPnl += livePnl(t);

    const daysLeft = (new Date(t.expiryDate).getTime() - nowMs) / 86400000;
    productMap[t.underlying] = (productMap[t.underlying] || 0) + notional;
    directionMap[t.position] += notional;
    if (daysLeft < 7) expiryMap["< 1 Hafta"] += notional;
    else if (daysLeft < 30) expiryMap["< 1 Ay"] += notional;
    else expiryMap["> 1 Ay"] += notional;

    expiryItems.push({
      id: t.id,
      customerName: allCustomers.find(c => c.id === t.customerId)?.companyName || 'Bilinmiyor',
      product: t.underlying,
      position: t.position,
      date: new Date(t.expiryDate),
      notional,
    });
  }

  const heatMapData: HeatMapCustomer[] = marginResults.map(r => ({
    id: r.customer.id,
    name: r.customer.companyName,
    marginUtil: r.margin.marginCallRatio * 100,
    pnl: allTrades
      .filter(t => (t.status === 'Open' || t.status === 'Near Expiry') && t.customerId === r.customer.id)
      .reduce((s, t) => s + livePnl(t), 0),
  }));

  const currencyColors = ["bg-zinc-300", "bg-zinc-500", "bg-zinc-600", "bg-zinc-700"];
  const currencyMap = allCollaterals.reduce<Record<string, number>>((acc, item) => {
    acc[item.currency] = (acc[item.currency] || 0) + item.marketValueUsd;
    return acc;
  }, {});

  const exposure: ExposureData = {
    currency: Object.keys(currencyMap).map((name, i) => ({
      name, value: currencyMap[name], color: currencyColors[i] || "bg-zinc-500",
    })),
    product: Object.keys(productMap).map((k, i) => ({
      name: k, value: productMap[k], color: ["bg-zinc-300", "bg-zinc-500", "bg-zinc-700"][i] || "bg-zinc-800",
    })),
    direction: [
      { name: "Long", value: directionMap.Long, color: "bg-emerald-500" },
      { name: "Short", value: directionMap.Short, color: "bg-rose-500" },
    ],
    expiry: [
      { name: "< 1 Hafta", value: expiryMap["< 1 Hafta"], color: "bg-rose-500" },
      { name: "< 1 Ay", value: expiryMap["< 1 Ay"], color: "bg-orange-500" },
      { name: "> 1 Ay", value: expiryMap["> 1 Ay"], color: "bg-emerald-500" },
    ],
  };

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  return (
    <div className="space-y-8">
      <div className="border-b border-zinc-800 pb-4">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-100">Risk ve Teminat Merkezi</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Portföy riski, müşteri teminat durumu ve teminat çağrısı takibi
        </p>
      </div>

      {pnlError && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          Canlı spot alınamadı — K/Z ve nominal değerler son kaydedilen/giriş verisine göre
          gösteriliyor (bayat olabilir). Teminat oranları etkilenmez. Detay: {pnlError}
        </div>
      )}

      <PortfolioSummary
        totalNotional={totalNotional}
        totalPnl={totalPnl}
        totalLoss={totalLoss}
        totalCollateral={totalCollateral}
      />

      {/* Bu sayfanın asıl çıktısı: bugün kimden ne kadar ek teminat isteneceği. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Toplam Gerekli Ek Teminat (%35 hedefe inmek için)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${totalCure > 0 ? "text-rose-500" : "text-emerald-500"}`}>
            {formatCurrency(totalCure)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Müşteri Risk Durumları (Margin Call &amp; Stop Out)</CardTitle>
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
              {marginResults.map(({ customer, margin }) => (
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

      <HeatMap customers={heatMapData} />

      <ExposureDashboard data={exposure} />

      <ExpiryCalendar items={expiryItems} />
    </div>
  );
}
