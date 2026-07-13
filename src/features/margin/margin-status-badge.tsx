import { Badge } from "@/components/ui/badge";
import type { MarginResult } from "@/lib/margin/engine";

type Status = MarginResult["status"];

/**
 * Tüm risk/teminat tablolarında (dashboard, trades, margin, müşteri detay) durum→rozet
 * eşlemesinin TEK kaynağı. Daha önce bu eşleme 3 dosyada kopyaydı; yeni bir durum
 * (ör. UNCOLLATERALIZED) eklenince hepsini elle güncellemek gerekiyordu.
 */
const STATUS_CONFIG: Record<
  Status,
  {
    label: string;
    variant: React.ComponentProps<typeof Badge>["variant"];
    className?: string;
    title?: string;
    /** Sadece margin sayfasında gösterilen eşik ipucu, ör. "(>%39)" */
    thresholdHint?: string;
  }
> = {
  SAFE: { label: "GÜVENLİ", variant: "outline", className: "border-emerald-500 text-emerald-500" },
  MARGIN_CALL: { label: "TEMİNAT ÇAĞRISI", variant: "secondary", className: "bg-yellow-500/20 text-yellow-500", thresholdHint: " (>%39)" },
  WARNING_60: { label: "STOP UYARISI", variant: "secondary", className: "bg-orange-500/20 text-orange-500", thresholdHint: " (>%60)" },
  STOP_LOSS_80: { label: "ANINDA STOP", variant: "destructive", thresholdHint: " (>%80)" },
  UNCOLLATERALIZED: { label: "TEMİNATSIZ", variant: "destructive", className: "bg-rose-700", title: "Teminat yok, zarar var" },
};

/** Teminat durumu rozeti. `withThresholds` ile eşik ipuçlarını (>%39 vb.) ekler. */
export function MarginStatusBadge({ status, withThresholds = false }: { status: Status; withThresholds?: boolean }) {
  const c = STATUS_CONFIG[status];
  return (
    <Badge variant={c.variant} className={c.className} title={c.title}>
      {c.label}{withThresholds && c.thresholdHint ? c.thresholdHint : ""}
    </Badge>
  );
}

/**
 * Zarar/Teminat oranı hücresi. Teminatsız (oran matematiksel olarak sonsuz) durumunda
 * yanıltıcı "%100" yerine ∞ gösterir.
 */
export function MarginRatioValue({ margin }: { margin: Pick<MarginResult, "status" | "marginCallRatio"> }) {
  if (margin.status === "UNCOLLATERALIZED") {
    return <span className="text-rose-500" title="Teminat yok, zarar var — oran sonsuz">∞</span>;
  }
  return <>%{(margin.marginCallRatio * 100).toFixed(1)}</>;
}
