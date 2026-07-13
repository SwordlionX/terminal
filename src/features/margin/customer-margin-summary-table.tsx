import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MarginStatusBadge, MarginRatioValue } from "./margin-status-badge";
import type { MarginResult } from "@/lib/margin/engine";

export type CustomerPnl = { openTrades: number; totalNotional: number; totalPnl: number };
export type CustomerMarginRow = {
  customer: { id: string; companyName: string; branch?: string };
  margin: MarginResult;
};

const fc = (val: number | null | undefined) =>
  val == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);

/**
 * Dashboard "Müşteri Risk ve Teminat Özeti" ve trades "Müşteri Bazlı Özet" tablolarının
 * ortak gövdesi — daha önce ikisi neredeyse birebir kopyaydı. Şube ve "Gerekli Ek Teminat"
 * sütunları opsiyonel (dashboard ikisini de gösterir, trades göstermez).
 */
export function CustomerMarginSummaryTable({
  rows,
  pnlByCustomer,
  showBranch = false,
  showCureAmount = false,
  emptyMessage = "Müşteri yok.",
}: {
  rows: CustomerMarginRow[];
  pnlByCustomer: Map<string, CustomerPnl>;
  showBranch?: boolean;
  showCureAmount?: boolean;
  emptyMessage?: string;
}) {
  // Sabit sütunlar: Müşteri, Açık İşlem, Nominal, Açık Poz. K/Z, Zarar, Mevcut Teminat, Zarar/Teminat, Durum = 8
  const colSpan = 8 + (showBranch ? 1 : 0) + (showCureAmount ? 1 : 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Müşteri</TableHead>
          {showBranch && <TableHead>Şube</TableHead>}
          <TableHead className="text-center">Açık İşlem</TableHead>
          <TableHead className="text-right" title="Açık pozisyonların büyüklüğü: canlı spot × kontrat">Nominal</TableHead>
          <TableHead className="text-right underline decoration-dotted decoration-zinc-600 underline-offset-4" title="Gerçek kâr/zarar: intrinsic − prim (primi netler). Müşteri bugün kapatsa net sonuç.">Açık Poz. K/Z</TableHead>
          <TableHead className="text-right underline decoration-dotted decoration-zinc-600 underline-offset-4" title="Teminat için BRÜT zarar: intrinsic, prim HARİÇ. Sadece müşteri aleyhine (>0). Zarar/Teminat oranı bunu kullanır.">Zarar</TableHead>
          <TableHead className="text-right" title="Yatırılan teminatın canlı USD değeri (haircut sonrası)">Mevcut Teminat</TableHead>
          <TableHead className="text-center underline decoration-dotted decoration-zinc-600 underline-offset-4" title="Ana risk metriği = Zarar ÷ Mevcut Teminat. %39 çağrı, %60/%80 kapatma.">Zarar / Teminat</TableHead>
          {showCureAmount && <TableHead className="text-right" title="Oranı hedef seviyeye indirmek için gereken ek teminat">Gerekli Ek Teminat</TableHead>}
          <TableHead>Durum</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ customer, margin }) => {
          const pnl = pnlByCustomer.get(customer.id);
          return (
            <TableRow key={customer.id}>
              <TableCell className="font-medium">
                <Link href={`/customers/${customer.id}`} className="text-primary hover:underline">{customer.companyName}</Link>
              </TableCell>
              {showBranch && <TableCell>{customer.branch}</TableCell>}
              <TableCell className="text-center">{pnl ? pnl.openTrades : "—"}</TableCell>
              <TableCell className="text-right font-mono">{pnl ? fc(pnl.totalNotional) : "—"}</TableCell>
              <TableCell className={`text-right font-mono ${pnl && pnl.totalPnl >= 0 ? "text-emerald-500" : pnl ? "text-rose-500" : ""}`}>{pnl ? fc(pnl.totalPnl) : "—"}</TableCell>
              <TableCell className="text-right font-mono text-rose-500">{fc(margin.totalMtmLoss)}</TableCell>
              <TableCell className="text-right font-mono">{fc(margin.totalCollateralValue)}</TableCell>
              <TableCell className="text-center font-mono"><MarginRatioValue margin={margin} /></TableCell>
              {showCureAmount && (
                <TableCell className={`text-right font-mono ${margin.cureAmount > 0 ? "text-rose-500" : "text-zinc-500"}`}>{margin.cureAmount > 0 ? fc(margin.cureAmount) : "-"}</TableCell>
              )}
              <TableCell><MarginStatusBadge status={margin.status} /></TableCell>
            </TableRow>
          );
        })}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">{emptyMessage}</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
