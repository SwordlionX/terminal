import { marginService } from "@/services/margin.service";
import { db } from "@/services/mockDb";
import { collateralRepository } from "@/repositories/collateral.repository";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MarginSimulation } from "@/features/margin/margin-simulation";

export const dynamic = "force-dynamic";

export default async function CustomerMarginPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const customer = await db.customers.findById(params.id);
  if (!customer) return notFound();

  const marginResult = await marginService.evaluateCustomerMargin(customer.id);
  const collaterals = await collateralRepository.findByCustomerId(customer.id);

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
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Required Margin</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatCurrency(marginResult.totalRequiredMargin)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Available Collateral</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-500">{formatCurrency(marginResult.totalCollateralValue)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Missing Margin</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold text-rose-500">{formatCurrency(marginResult.missingMargin)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Coverage Ratio</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{(marginResult.coverageRatio * 100).toFixed(1)}%</div></CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Mevcut Teminat Varlıkları</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Varlık Türü</TableHead>
                  <TableHead>Döviz</TableHead>
                  <TableHead className="text-right">Market Değeri</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collaterals.map(c => (
                  <TableRow key={c.id}>
                    <TableCell>{c.assetCode}</TableCell>
                    <TableCell>{c.currency}</TableCell>
                    <TableCell className="text-right">{formatCurrency(c.marketValueUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Simülasyon Paneli */}
        <MarginSimulation 
          initialMargin={marginResult.totalRequiredMargin} 
          initialCollateral={marginResult.totalCollateralValue} 
        />
      </div>
    </div>
  );
}
