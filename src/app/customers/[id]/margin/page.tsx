import { marginService, revalueCollaterals } from "@/services/margin.service";
import { db } from "@/services/mockDb";
import { collateralRepository } from "@/repositories/collateral.repository";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarginSimulation } from "@/features/margin/margin-simulation";
import { CollateralManager } from "@/features/margin/collateral-manager";

export const dynamic = "force-dynamic";

export default async function CustomerMarginPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const customer = await db.customers.findById(params.id);
  if (!customer) return notFound();

  const marginResult = await marginService.evaluateCustomerMargin(customer.id);
  const collaterals = await revalueCollaterals(await collateralRepository.findByCustomerId(customer.id));

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{customer.companyName} - Teminat Detayı</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Zarar (Açık Poz.)</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-rose-500">{formatCurrency(marginResult.totalMtmLoss)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Mevcut Teminat</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-500">{formatCurrency(marginResult.totalCollateralValue)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Zarar / Teminat</CardTitle></CardHeader>
          <CardContent><div className={`text-2xl font-bold ${marginResult.marginCallRatio > 0.39 ? 'text-rose-500' : ''}`}>%{(marginResult.marginCallRatio * 100).toFixed(1)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Gerekli Ek Teminat</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-500">{marginResult.cureAmount > 0 ? formatCurrency(marginResult.cureAmount) : '-'}</div>
            <p className="text-[11px] text-muted-foreground mt-1">Oranı %35&apos;e indirmek için</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CollateralManager customerId={customer.id} collaterals={collaterals} />

        {/* Simülasyon Paneli */}
        <MarginSimulation
          initialLoss={marginResult.totalMtmLoss}
          initialCollateral={marginResult.totalCollateralValue}
        />
      </div>
    </div>
  );
}
