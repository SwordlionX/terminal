"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/features/pricing/use-pricing-model";

interface PricingContextBarProps {
  product: string;
  spot: number;
  strike: number;
  daysToExpiry: number;
  effVol: number;
  manualVol: boolean;
  liveSource?: string;
  livePrice?: number;
}

/** Alt Fiyatlama sayfalarında (Bariyer, Tersine Mühendislik, Delta Hedge) kullanılan
 *  ortak piyasa özeti şeridi. Girdiler Ana Fiyatlama ekranındaki "Piyasa Verileri"
 *  panelinden gelir; buradan değiştirilmez. */
export function PricingContextBar({ product, spot, strike, daysToExpiry, effVol, manualVol, liveSource, livePrice }: PricingContextBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-slate-800 bg-slate-900/30 text-xs">
      <Badge variant="outline" className="border-slate-700 text-slate-300 font-mono">{product}</Badge>
      <Badge variant="outline" className="border-slate-700 text-slate-300 font-mono">Spot ${formatNumber(spot, 2)}</Badge>
      <Badge variant="outline" className="border-slate-700 text-slate-300 font-mono">Strike ${formatNumber(strike, 2)}</Badge>
      <Badge variant="outline" className="border-slate-700 text-slate-300 font-mono">Vade {formatNumber(daysToExpiry, 0)} gün</Badge>
      <Badge variant="outline" className="border-slate-700 text-slate-300 font-mono">
        Vol %{formatNumber(effVol, 2)} {manualVol ? "(manuel)" : "(smile)"}
      </Badge>
      {liveSource && livePrice != null && (
        <Badge variant="outline" className="border-emerald-600 text-emerald-500 font-mono">
          Canlı: {liveSource} ${formatNumber(livePrice, 2)}
        </Badge>
      )}
      <Link href="/" className="ml-auto text-emerald-500 hover:underline font-medium">
        Piyasa verilerini düzenle →
      </Link>
    </div>
  );
}
