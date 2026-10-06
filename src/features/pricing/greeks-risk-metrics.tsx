'use client';

import { useState } from 'react';
import type { Quote } from '@/lib/assistant/types';

/** Presentation only: both views retain the customer's direction and the same quote. */
export function GreeksRiskMetrics({ quote, unit }: { quote: Quote | null; unit: 'ons' | 'adet' }) {
  const [total, setTotal] = useState(false);
  const quantity = quote?.inputs.contractSize;
  const available = quote != null && quantity != null && Number.isFinite(quantity) && quantity > 0;
  const divisor = total ? 1 : (quantity ?? 1);
  const number = (value: number, digits: number) =>
    value.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const rows = [
    { name: 'Delta', value: quote?.delta, digits: total ? 3 : 4, suffix: total ? unit : 'oran' },
    {
      name: 'Gamma',
      value: quote?.gamma,
      digits: total ? 5 : 6,
      suffix: total ? `${unit} / (USD/${unit})` : `1 / (USD/${unit})`,
    },
    { name: 'Vega / vol puanı', value: quote?.vega, digits: total ? 2 : 4, suffix: total ? 'USD' : `USD/${unit}` },
    { name: 'Theta / gün', value: quote?.theta, digits: total ? 2 : 4, suffix: total ? 'USD' : `USD/${unit}` },
  ];

  return (
    <>
      <div className="desk-greeks-head">
        <div className="desk-greeks-title-row">
          <p className="desk-eyebrow">GREEKS</p>
          <button
            type="button"
            role="switch"
            aria-label="Toplam pozisyon Greek’lerini göster"
            aria-checked={total}
            className="desk-greeks-switch"
            onClick={() => setTotal(previous => !previous)}
            title="Birim başına Greek’ler ile toplam pozisyon riski arasında geçiş"
          >
            <span aria-hidden="true" data-active={!total}>
              Birim
            </span>
            <span aria-hidden="true" data-active={total}>
              Toplam
            </span>
          </button>
        </div>
        <p className="desk-greeks-scope">
          Müşteri ·{' '}
          {total
            ? `Toplam${available ? ` ${quantity!.toLocaleString('tr-TR', { maximumFractionDigits: 3 })} ${unit}` : ''}`
            : `1 ${unit}`}
        </p>
      </div>
      {rows.map(row => (
        <div className="desk-risk-item" key={row.name}>
          <span>{row.name}</span>
          <strong>
            {available && row.value != null && Number.isFinite(row.value)
              ? number(row.value / divisor, row.digits)
              : '—'}
          </strong>
          <small className="desk-greeks-unit">{row.suffix}</small>
        </div>
      ))}
    </>
  );
}
