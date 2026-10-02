"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { checkBarrierHistoryAction } from "@/app/customers/[id]/barrier-history-actions";
import type { BarrierHistoryReport } from "@/lib/barrier-history";

export function BarrierHistoryCheck({ customerId, tradeId }: { customerId: string; tradeId: string }) {
  const [report, setReport] = useState<BarrierHistoryReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function check() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try { setReport(await checkBarrierHistoryAction(customerId, tradeId)); }
    catch { setError("Bariyer geçmişi alınamadı. Kayıt değiştirilmedi."); }
    finally { setBusy(false); }
  }
  return <div className="mt-2 whitespace-normal max-w-sm font-normal">
    <Button size="sm" variant="outline" disabled={busy} onClick={check} title="Tiingo spot geçmişini tarar; kayıt ve hesapları değiştirmez">
      {busy ? "Spot geçmişi taranıyor…" : "Bariyer geçmişini kontrol et"}
    </Button>
    {error && <p role="alert" className="mt-2 text-xs text-amber-400">{error}</p>}
    {report && <div role="status" className="mt-2 space-y-1 text-xs text-amber-400">
      <p className="font-semibold">{report.status === "touch_observed" ? "Spot verisinde değme gözlendi" : report.status === "no_touch_observed" ? "Alınan veride değme görülmedi — kesinleşmedi" : "Doğrulanamadı"}</p>
      <p>{report.source} · {report.startDate} – {report.endDate} · {report.bars} bar</p>
      {report.firstDate && <p>Alınan barlar: {report.firstDate} – {report.lastDate}</p>}
      {report.touchDate && <p>İlk gözlenen gün: {report.touchDate}; fiyat: {report.observedExtreme}</p>}
      <p>Kontrol: {report.checkedAt}</p>
      <p>{report.note}</p>
    </div>}
  </div>;
}
