import { db } from "@/services/mockDb";
import { marginService } from "@/services/margin.service";
import { PortfolioSummary } from "@/features/risk/portfolio-summary";
import { HeatMap, HeatMapCustomer } from "@/features/risk/heat-map";
import { ExposureDashboard, ExposureData } from "@/features/risk/exposure-dashboard";
import { ExpiryCalendar, ExpiryItem } from "@/features/risk/expiry-calendar";
import { collateralRepository } from "@/repositories/collateral.repository";

export const dynamic = "force-dynamic";

/**
 * NOT: Greeks Dashboard ve Stress Testing kasıtlı olarak kaldırıldı. İkisi de Black-Scholes tabanlı
 * hedge/risk analitiğiydi — ama şube kendi opsiyon kitabını hedge etmiyor, bunu hazine + karşı taraf
 * banka (örn. JPMorgan ile back-to-back) yönetiyor. Şube seviyesinde anlamlı olan tek şey müşterinin
 * bugünkü basit K/Z'si (intrinsic - prim) ve teminat durumu; onlar aşağıda hâlâ var.
 */
export default async function RiskCenterPage() {
  const marginResults = await marginService.evaluateAllCustomers();
  const allTrades = await db.trades.findMany();
  const allCollaterals = await collateralRepository.findAll();

  // Heat Map Data
  const heatMapData: HeatMapCustomer[] = marginResults.map(r => ({
    id: r.customer.id,
    name: r.customer.companyName,
    marginUtil: r.margin.totalCollateralValue > 0 ? (r.margin.totalRequiredMargin / r.margin.totalCollateralValue) * 100 : 0,
    pnl: allTrades.filter(t => (t.status === 'Open' || t.status === 'Near Expiry') && t.customerId === r.customer.id).reduce((s, t) => s + (t.pnl || 0), 0),
  }));

  // Aggregations
  let totalNotional = 0;
  let totalPnl = 0;
  let totalMargin = 0;
  let totalCollateral = 0;

  const exposure: ExposureData = {
    currency: [],
    product: [],
    direction: [],
    expiry: []
  };

  const productMap: Record<string, number> = {};
  const directionMap: Record<string, number> = { Long: 0, Short: 0 };
  const expiryMap: Record<string, number> = { "< 1 Hafta": 0, "< 1 Ay": 0, "> 1 Ay": 0 };

  const expiryItems: ExpiryItem[] = [];

  const nowMs = new Date().getTime();
  const allCustomers = await db.customers.findMany();

  for (const t of allTrades) {
    if (t.status !== 'Open' && t.status !== 'Near Expiry') continue;

    const notional = t.contractSize * t.spot;
    totalNotional += notional;
    totalPnl += t.pnl || 0;

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
      notional: notional
    });
  }

  marginResults.forEach(r => {
    totalMargin += r.margin.totalRequiredMargin;
    totalCollateral += r.margin.totalCollateralValue;
  });

  exposure.product = Object.keys(productMap).map((k,i) => ({ name: k, value: productMap[k], color: ["bg-zinc-300", "bg-zinc-500", "bg-zinc-700"][i] || "bg-zinc-800" }));
  exposure.direction = [{ name: "Long", value: directionMap.Long, color: "bg-emerald-500" }, { name: "Short", value: directionMap.Short, color: "bg-rose-500" }];
  exposure.expiry = [
    { name: "< 1 Hafta", value: expiryMap["< 1 Hafta"], color: "bg-rose-500" },
    { name: "< 1 Ay", value: expiryMap["< 1 Ay"], color: "bg-orange-500" },
    { name: "> 1 Ay", value: expiryMap["> 1 Ay"], color: "bg-emerald-500" },
  ];
  const currencyColors = ["bg-zinc-300", "bg-zinc-500", "bg-zinc-600", "bg-zinc-700"];
  const currencyMap = allCollaterals.reduce<Record<string, number>>((acc, item) => {
    acc[item.currency] = (acc[item.currency] || 0) + item.marketValueUsd;
    return acc;
  }, {});
  exposure.currency = Object.keys(currencyMap).map((name, i) => ({
    name,
    value: currencyMap[name],
    color: currencyColors[i] || "bg-slate-500",
  }));

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-100">Risk Merkezi</h1>
          <p className="text-sm text-slate-500 mt-1">Kurumsal Hazine Portföy ve Risk Analitikleri Merkezi</p>
        </div>
      </div>

      <PortfolioSummary
        totalNotional={totalNotional}
        totalPnl={totalPnl}
        totalMargin={totalMargin}
        totalCollateral={totalCollateral}
      />

      <HeatMap customers={heatMapData} />

      <ExposureDashboard data={exposure} />

      <ExpiryCalendar items={expiryItems} />
    </div>
  );
}
