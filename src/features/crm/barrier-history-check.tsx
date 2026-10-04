'use client';

import { useState } from 'react';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { checkBarrierHistoryAction } from '@/app/customers/[id]/barrier-history-actions';
import type { BarrierHistoryReport } from '@/lib/barrier-history';

export function BarrierHistoryCheck({ customerId, tradeId }: { customerId: string; tradeId: string }) {
  const [report, setReport] = useState<BarrierHistoryReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function check() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(await checkBarrierHistoryAction(customerId, tradeId));
    } catch {
      setError('Bariyer geçmişi alınamadı. Kayıt değiştirilmedi.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="barrier-history-check">
      <button
        className="desk-button"
        disabled={busy}
        onClick={check}
        title="Tiingo spot geçmişini tarar; kayıt ve hesapları değiştirmez"
      >
        {busy ? 'Spot geçmişi taranıyor…' : 'Bariyer geçmişini kontrol et'}
      </button>
      {error && (
        <p role="alert" className="desk-policy">
          {error}
        </p>
      )}
      {report && (
        <div role="status" className="desk-policy">
          <strong>
            {report.status === 'touch_observed'
              ? 'Spot verisinde değme gözlendi'
              : report.status === 'no_touch_observed'
                ? 'Alınan veride değme görülmedi — kesinleşmedi'
                : 'Doğrulanamadı'}
          </strong>
          <p>
            {report.source} · {formatDate(report.startDate)} – {formatDate(report.endDate)} · {report.bars} bar
          </p>
          {report.firstDate && (
            <p>
              Alınan barlar: {formatDate(report.firstDate)} – {formatDate(report.lastDate)}
            </p>
          )}
          {report.touchDate && (
            <p>
              İlk gözlenen gün: {formatDate(report.touchDate)}; fiyat:{' '}
              {report.observedExtreme == null ? '—' : formatNumber(report.observedExtreme)}
            </p>
          )}
          <p>Kontrol: {formatDateTime(report.checkedAt)}</p>
          <p>{report.note}</p>
        </div>
      )}
    </div>
  );
}
