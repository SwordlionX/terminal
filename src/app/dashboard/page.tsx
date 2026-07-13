import { evaluatePortfolio } from "@/services/portfolio.service";
import { marginService } from "@/services/margin.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerMarginSummaryTable } from "@/features/margin/customer-margin-summary-table";

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
          <CustomerMarginSummaryTable
            rows={marginResults}
            pnlByCustomer={pnlByCustomer}
            showBranch
            showCureAmount
          />
        </CardContent>
      </Card>
    </div>
  );
}
