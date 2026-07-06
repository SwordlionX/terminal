import { db } from "@/services/mockDb";
import { marginService } from "@/services/margin.service";
import { PortfolioSummary } from "@/features/risk/portfolio-summary";
import { HeatMap, HeatMapCustomer } from "@/features/risk/heat-map";
import { GreeksDashboard, GreeksData } from "@/features/risk/greeks-dashboard";
import { ExposureDashboard, ExposureData } from "@/features/risk/exposure-dashboard";
import { ExpiryCalendar, ExpiryItem } from "@/features/risk/expiry-calendar";
import { StressTesting, StressScenario } from "@/features/risk/stress-testing";
import { greeks } from "@/lib/math";

export const dynamic = "force-dynamic";

export default async function RiskCenterPage() {
  const marginResults = await marginService.evaluateAllCustomers();
  const allTrades = await db.trades.findMany();
  const allCustomers = await db.customers.findMany();

  // Heat Map Data
  const heatMapData: HeatMapCustomer[] = marginResults.map(r => ({
    id: r.customer.id,
    name: r.customer.companyName,
    marginUtil: r.margin.totalCollateralValue > 0 ? (r.margin.totalRequiredMargin / r.margin.totalCollateralValue) * 100 : 0,
    mtm: 0
  }));

  // Aggregations
  let totalNotional = 0;
  let totalMtm = 0;
  let totalMargin = 0;
  let totalCollateral = 0;

  const portfolioGreeks: GreeksData = { delta: 0, gamma: 0, vega: 0, theta: 0 };
  const custGreeksMap: Record<string, GreeksData> = {};

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

  const now = Date.now();

  for (const t of allTrades) {
    if (t.status !== 'Open' && t.status !== 'Near Expiry') continue;

    const notional = t.contractSize * t.spot;
    totalNotional += notional;
    totalMtm += t.mtm || 0;

    const T = Math.max(0.001, (new Date(t.expiryDate).getTime() - now) / (1000 * 3600 * 24) / 365);
    const gr = greeks(t.spot, t.strike, T, 0.04, 0.01, 0.15, 365); 
    if (gr) {
      const g = t.type === 'Call' ? gr.call : gr.put;
      const mult = t.position === 'Long' ? 1 : -1;
      const size = t.contractSize;
      
      portfolioGreeks.delta += g.delta * mult * size;
      portfolioGreeks.gamma += g.gamma * mult * size;
      portfolioGreeks.vega += g.vega * mult * size;
      portfolioGreeks.theta += g.theta * mult * size;

      if (!custGreeksMap[t.customerId]) custGreeksMap[t.customerId] = { delta: 0, gamma: 0, vega: 0, theta: 0 };
      custGreeksMap[t.customerId].delta += g.delta * mult * size;
      custGreeksMap[t.customerId].gamma += g.gamma * mult * size;
      custGreeksMap[t.customerId].vega += g.vega * mult * size;
      custGreeksMap[t.customerId].theta += g.theta * mult * size;
    }

    productMap[t.underlying] = (productMap[t.underlying] || 0) + notional;
    directionMap[t.position] += notional;

    const daysLeft = T * 365;
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
    const cIdx = heatMapData.findIndex(h => h.id === r.customer.id);
    if (cIdx >= 0) heatMapData[cIdx].mtm = allTrades.filter(t => t.customerId === r.customer.id).reduce((s,t) => s + (t.mtm||0), 0);
  });

  exposure.product = Object.keys(productMap).map((k,i) => ({ name: k, value: productMap[k], color: ["bg-orange-500", "bg-zinc-400", "bg-sky-500"][i] || "bg-blue-500" }));
  exposure.direction = [{ name: "Long", value: directionMap.Long, color: "bg-emerald-500" }, { name: "Short", value: directionMap.Short, color: "bg-rose-500" }];
  exposure.expiry = [
    { name: "< 1 Hafta", value: expiryMap["< 1 Hafta"], color: "bg-rose-500" },
    { name: "< 1 Ay", value: expiryMap["< 1 Ay"], color: "bg-orange-500" },
    { name: "> 1 Ay", value: expiryMap["> 1 Ay"], color: "bg-emerald-500" },
  ];
  exposure.currency = [{ name: "USD", value: totalCollateral * 0.8, color: "bg-blue-500" }, { name: "TRY", value: totalCollateral * 0.2, color: "bg-indigo-500" }];

  const customerGreeks = Object.keys(custGreeksMap).map(id => ({
    name: allCustomers.find(c => c.id === id)?.companyName || 'Bilinmiyor',
    greeks: custGreeksMap[id]
  })).sort((a,b) => Math.abs(b.greeks.delta) - Math.abs(a.greeks.delta));

  const stressScenarios: StressScenario[] = [
    { name: "Spot Altın (XAU) +15% Şoku", impactMtm: -1250000, marginCallCount: 3 },
    { name: "Spot Altın (XAU) -15% Şoku", impactMtm: 850000, marginCallCount: 0 },
    { name: "Spot Gümüş (XAG) -20% Şoku", impactMtm: -150000, marginCallCount: 1 },
    { name: "Tüm Ürünlerde Volatilite +10% Artışı", impactMtm: -420000, marginCallCount: 1 },
    { name: "Genel Faiz Oranı +200bp Artışı", impactMtm: 15000, marginCallCount: 0 },
    { name: "USD/TRY Kur Şoku (+20%)", impactMtm: -3000000, marginCallCount: 5 },
  ];

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
        totalMtm={totalMtm} 
        totalMargin={totalMargin} 
        totalCollateral={totalCollateral} 
      />

      <HeatMap customers={heatMapData} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <GreeksDashboard portfolioGreeks={portfolioGreeks} customerGreeks={customerGreeks} />
        <ExposureDashboard data={exposure} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <StressTesting scenarios={stressScenarios} />
        <ExpiryCalendar items={expiryItems} />
      </div>
    </div>
  );
}
