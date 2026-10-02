import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Trade } from "@/types";

export type ArchivedTrade = {
  trade: Trade;
  customerName: string;
  closedAt: string | null;
  expirySpot: number | null;
};

function numberText(value: unknown, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "—";
}

function dateText(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
}

function moneyText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
    : "—";
}

export function TradeArchive({
  records,
  customerId,
}: {
  records: ArchivedTrade[];
  customerId?: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">İşlem Arşivi</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {customerId ? "Seçili müşterinin kapatılmış işlemleri" : "Kapatılmış işlemler"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kapatılmış İşlemler ({records.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Müşteri</TableHead>
                <TableHead>Ürün</TableHead>
                <TableHead>Yön</TableHead>
                <TableHead>Strike</TableHead>
                <TableHead>Miktar</TableHead>
                <TableHead>Prim (USD)</TableHead>
                <TableHead>Vade Sonu Spot</TableHead>
                <TableHead>Gerçekleşen PnL (USD)</TableHead>
                <TableHead>Vade</TableHead>
                <TableHead>Kapanış</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map(({ trade, customerName, closedAt, expirySpot }) => (
                <TableRow key={trade.id}>
                  <TableCell className="font-medium">
                    <Link href={`/customers/${encodeURIComponent(trade.customerId)}`} className="text-emerald-500 hover:underline">
                      {customerName || "—"}
                    </Link>
                  </TableCell>
                  <TableCell>{trade.underlying || "—"} {trade.type || "—"}</TableCell>
                  <TableCell>{trade.position || "—"}</TableCell>
                  <TableCell>{numberText(trade.strike)}</TableCell>
                  <TableCell>{numberText(trade.contractSize, 4)}</TableCell>
                  <TableCell>{moneyText(trade.premium)}</TableCell>
                  <TableCell>{numberText(expirySpot)}</TableCell>
                  <TableCell className={typeof trade.pnl === "number" && Number.isFinite(trade.pnl) ? trade.pnl >= 0 ? "text-emerald-500" : "text-rose-500" : ""}>
                    {moneyText(trade.pnl)}
                  </TableCell>
                  <TableCell>{dateText(trade.expiryDate)}</TableCell>
                  <TableCell>{dateText(closedAt)}</TableCell>
                </TableRow>
              ))}
              {records.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                    Arşivde kapatılmış işlem bulunmuyor.
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
