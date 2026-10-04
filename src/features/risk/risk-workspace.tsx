'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { MarginResult } from '@/lib/margin/engine';
import { WorkspaceContext, AskAssistant } from '@/components/workspace-context';
import { MarginStatusBadge, MarginRatioValue } from '@/features/margin/margin-status-badge';
import { ExpiryCalendar } from './expiry-calendar';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
export interface RiskRow {
  id: string;
  name: string;
  branch: string;
  open: number;
  margin: MarginResult;
  nextExpiry: string | null;
}
export function RiskWorkspace({
  rows,
  expiries,
  observedAt,
}: {
  rows: RiskRow[];
  expiries: { id: string; customerName: string; product: string; position: string; date: string; notional: number }[];
  observedAt: string;
}) {
  const priority = [...rows]
    .filter(r => r.margin.cureAmount > 0 || r.margin.status !== 'SAFE' || r.margin.dataWarning)
    .sort((a, b) => b.margin.cureAmount - a.margin.cureAmount);
  const [selectedId, setSelected] = useState<string | null>(null),
    [search, setSearch] = useState('');
  const selected = rows.find(r => r.id === selectedId);
  const now = Date.parse(observedAt),
    due = expiries.filter(e => Date.parse(e.date) - now <= 14 * 86400000);
  return (
    <div>
      <WorkspaceContext
        area="risk"
        customerId={selected?.id}
        label={selected ? `${selected.name} · risk ve teminat` : 'Risk masası · portföy özeti'}
      />
      <div className="workspace-heading">
        <div>
          <h1>Risk ve teminat</h1>
        </div>
        <AskAssistant
          text={
            selected
              ? 'Seçili müşterinin teminat durumunu terminal kayıtlarından oku. Prosedür hesabının model K/Z’den farkını ve görüşmede ele alınacak konuları açıkla.'
              : 'Risk masasının terminaldeki özetini oku. Ek teminat gerektiren ve vadesi yaklaşan dosyaların önceliklerini anlat.'
          }
        />
      </div>
      <div className="workspace-metrics">
        <div>
          <span>Gerekli ek teminat · %35 hedef</span>
          <strong>{formatMoney(rows.reduce((s, r) => s + r.margin.cureAmount, 0))}</strong>
          <small>Prosedür hesabı · prim hariç brüt zarar</small>
        </div>
        <div>
          <span>14 gün içinde / vadesi gelen</span>
          <strong>{due.length} işlem</strong>
        </div>
        <div>
          <span>İncelenecek dosyalar</span>
          <strong>{priority.length} müşteri</strong>
          <small>{rows.length} kayıtlı dosya</small>
        </div>
      </div>
      <section className="workspace-panel">
        <h2>Öncelikli müşteri dosyaları</h2>
        {priority.slice(0, 8).map((row, index) => (
          <div className="workspace-priority" key={row.id}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div>
              <strong>{row.name}</strong>
              <small>
                {row.open} açık işlem ·{' '}
                {row.nextExpiry ? `İlk vade ${formatDate(row.nextExpiry)}` : 'Yaklaşan vade yok'} ·{' '}
                {row.branch || 'Şube belirtilmedi'}
              </small>
              {row.margin.dataWarning && <small style={{ color: 'var(--primary)' }}>{row.margin.dataWarning}</small>}
            </div>
            <div style={{ flex: '0 1 auto' }}>
              <strong>{formatMoney(row.margin.cureAmount)}</strong>
              <small>Gerekli ek teminat</small>
            </div>
            <button className="desk-button" aria-pressed={selectedId === row.id} onClick={() => setSelected(row.id)}>
              Dosyayı seç ↗
            </button>
          </div>
        ))}
        {!priority.length && (
          <p className="workspace-empty">Prosedür eşiklerine göre ek teminat gerektiren dosya yok.</p>
        )}
      </section>
      {selected && (
        <section className="workspace-panel" style={{ marginTop: 24 }}>
          <div className="workspace-heading">
            <h2>{selected.name} / seçili dosya</h2>
            <MarginStatusBadge
              dataWarning={selected.margin.dataWarning}
              status={selected.margin.status}
              withThresholds
            />
          </div>
          <div className="workspace-metrics">
            <div>
              <span>Brüt intrinsic zarar</span>
              <strong>{formatMoney(selected.margin.totalMtmLoss)}</strong>
            </div>
            <div>
              <span>Haircut sonrası teminat</span>
              <strong>{formatMoney(selected.margin.totalCollateralValue)}</strong>
            </div>
            <div>
              <span>Zarar / teminat</span>
              <strong>
                <MarginRatioValue margin={selected.margin} />
              </strong>
            </div>
          </div>
          {selected.margin.dataWarning && <p className="desk-policy">{selected.margin.dataWarning}</p>}
          <div className="workspace-toolbar">
            <Link href={`/customers/${selected.id}?tab=collateral`} className="desk-button">
              Teminat dosyası ↗
            </Link>
            <Link href={`/trades?customer=${selected.id}`} className="desk-button">
              Model risk / pozisyonlar ↗
            </Link>
            <AskAssistant text="Seçili müşteri dosyasını incele. Teminat prosedürü ile model riskini ayrı tutarak hangi pozisyonun analiz edilmesi gerektiğini açıkla." />
          </div>
        </section>
      )}
      <div className="workspace-grid">
        <section className="workspace-panel">
          <h2>Vade dağılımı / açık işlemler</h2>
          {[
            ['Vadesi geldi', -Infinity, 0],
            ['1–7 gün', 0, 7],
            ['8–30 gün', 7, 30],
            ['30 günden sonra', 30, Infinity],
          ].map(([label, min, max]) => {
            const bucket = expiries.filter(e => {
              const d = (Date.parse(e.date) - now) / 86400000;
              return d > Number(min) && d <= Number(max);
            });
            return (
              <div className="workspace-priority" key={String(label)}>
                <div>
                  <strong>{label}</strong>
                  <small>{bucket.length} işlem</small>
                  <div style={{ marginTop: 10, background: 'var(--muted)', height: 4 }}>
                    <div
                      style={{
                        background: 'var(--primary)',
                        width: `${expiries.length ? (bucket.length / expiries.length) * 100 : 0}%`,
                        height: 4,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </section>
        <ExpiryCalendar items={expiries.map(e => ({ ...e, date: new Date(e.date) }))} />
      </div>
      <section className="workspace-panel">
        <div className="workspace-heading">
          <h2>Bütün müşteri riskleri</h2>
          <input
            aria-label="Risk dosyalarında ara"
            className="workspace-search"
            style={{ flex: '0 1 280px' }}
            placeholder="Müşteri veya şube ara…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="workspace-table-scroll">
          <table className="workspace-table">
            <thead>
              <tr>
                <th>Müşteri</th>
                <th>Şube</th>
                <th className="number">Brüt zarar</th>
                <th className="number">Teminat</th>
                <th className="number">Ek teminat</th>
                <th className="number">Oran</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter(r => `${r.name} ${r.branch}`.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr')))
                .map(r => (
                  <tr key={r.id} data-selected={selectedId === r.id}>
                    <td>
                      <button onClick={() => setSelected(r.id)}>
                        {r.name}
                        <small>{r.open} açık işlem</small>
                      </button>
                    </td>
                    <td>{r.branch || '—'}</td>
                    <td className="number">{formatNumber(r.margin.totalMtmLoss)}</td>
                    <td className="number">{formatNumber(r.margin.totalCollateralValue)}</td>
                    <td className="number">{formatNumber(r.margin.cureAmount)}</td>
                    <td className="number">
                      <MarginRatioValue margin={r.margin} />
                    </td>
                    <td>
                      <MarginStatusBadge dataWarning={r.margin.dataWarning} status={r.margin.status} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <details className="workspace-notes">
        <summary>Teminat hesabı ve veri zamanı</summary>
        <p>
          Teminat prosedürü prim hariç intrinsic zararı kullanır; zaman değeri içeren model MTM hesabı değildir. Güncel
          veri alınamazsa kayıtlı değer kullanımı ayrıca işaretlenir.
        </p>
        <p>Görünüm: {formatDateTime(observedAt)}. Model analizi için Pozisyonlar alanını kullan.</p>
      </details>
    </div>
  );
}
