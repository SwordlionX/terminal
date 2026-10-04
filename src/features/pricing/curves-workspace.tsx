'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePricingModel } from './use-pricing-model';
import { SmileChart } from './smile-chart';
import { VolatilityTermChart } from './volatility-term-chart';
import { WorkspaceContext, AskAssistant } from '@/components/workspace-context';
import { curveFactors } from '@/lib/market/factors';
import { formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
export function CurvesWorkspace() {
  const { md, feed, fwd, daysToExpiry } = usePricingModel(),
    [view, setView] = useState('smile');
  const curve = feed.surface?.curves;
  const tenors = useMemo(
    () =>
      [7, 30, 60, 90, 180, 270, 365].map(days => {
        const from = Date.parse(md.tradeDate),
          to = from + days * 86400000;
        if (!Number.isFinite(from))
          return { days, expiry: '', discount: null, rate365: null, lease365: null, forwardRatio: null };
        try {
          if (!curve) throw new Error();
          const f = curveFactors(curve, from, to);
          return { days, expiry: new Date(to).toISOString().slice(0, 10), ...f };
        } catch {
          return {
            days,
            expiry: new Date(to).toISOString().slice(0, 10),
            discount: null,
            rate365: null,
            lease365: null,
            forwardRatio: null,
          };
        }
      }),
    [curve, md.tradeDate],
  );
  const points = tenors.filter(t => t.rate365 !== null && t.lease365 !== null);
  const values = points.flatMap(t => [t.rate365! * 100, t.lease365! * 100]);
  const min = values.length ? Math.min(...values) - 0.2 : 0,
    max = values.length ? Math.max(...values) + 0.2 : 1;
  const x = (d: number) => 45 + (d / 365) * 685,
    y = (v: number) => 20 + ((max - v) / (max - min)) * 170;
  return (
    <div>
      <WorkspaceContext area="curves" label={`${md.product} · smile, USD faiz ve metal taşıması`} />
      <div className="workspace-heading">
        <div>
          <h1>Eğriler ve veri</h1>
        </div>
        <AskAssistant text="Terminalin seçili metal eğrisini oku. Smile ve vade yapısını, veri tarihini ve model/uzatma sınırlarını açıkla. Dış fiyat arama." />
      </div>
      <div className="workspace-toolbar">
        <div className="desk-segments">
          {['XAU', 'XAG'].map(p => (
            <button key={p} aria-pressed={md.product === p} onClick={() => md.setProduct(p, md.spot, md.lease, md.vol)}>
              {p}
            </button>
          ))}
        </div>
        <label className="desk-field">
          Seçili vade
          <input
            aria-label="Eğri vadesi"
            type="date"
            value={md.expiryDate}
            onChange={e => md.setField('expiryDate', e.target.value)}
          />
        </label>
        <button className="desk-button" onClick={feed.refetch} disabled={feed.loading}>
          Kayıtlı veriyi yeniden oku
        </button>
        <Link className="desk-link" href="/settings">
          Veri yönetimi ↗
        </Link>
      </div>
      <div className="workspace-metrics">
        <div>
          <span>Terminal spotu</span>
          <strong>{feed.spot ? formatNumber(feed.spot.price) : '—'} USD/ons</strong>
          <small>
            {feed.spot?.source ?? 'Veri yok'} · {feed.spot ? formatDateTime(feed.spot.quoteAt ?? feed.spot.at) : '—'}
            {feed.spot?.stale ? ' · Eski kayıt' : ''}
          </small>
        </div>
        <div>
          <span>Faiz / taşıma / IV seansı</span>
          <strong>{curve ? formatDate(curve.asOf) : 'Paket yok'}</strong>
          <small>{curve ? 'Final settlement paketi · CME/SOFR proxy' : 'Fiyatlama engellenir'}</small>
        </div>
        <div>
          <span>IV vade kapsamı</span>
          <strong>{feed.surface?.expiries.length ?? 0} vade</strong>
          <small>{feed.surfaceSource ?? 'Yüzey yok'}</small>
        </div>
      </div>
      {(feed.error || feed.quoteError) && (
        <p className="desk-policy" role="status">
          {feed.error ?? feed.quoteError}
        </p>
      )}
      <section className="workspace-panel">
        <div className="analysis-panel-head">
          <h2>Volatilite yüzeyi / {md.product}</h2>
          <div className="desk-segments">
            <button aria-pressed={view === 'smile'} onClick={() => setView('smile')}>
              Smile
            </button>
            <button aria-pressed={view === 'term'} onClick={() => setView('term')}>
              Vade yapısı
            </button>
          </div>
        </div>
        {view === 'smile' ? (
          <SmileChart
            surface={feed.surface}
            fwd={fwd}
            strike={md.strike}
            daysToExpiry={daysToExpiry}
            valuationDate={md.tradeDate}
            sourceLabel={feed.surfaceSource ?? undefined}
          />
        ) : (
          <VolatilityTermChart
            surface={feed.surface}
            valuationDate={md.tradeDate}
            onSelect={date => md.setField('expiryDate', date)}
          />
        )}
      </section>
      <section className="workspace-panel" style={{ marginTop: 24 }}>
        <h2>USD faiz ve metal taşıması / sürekli yıllık oran</h2>
        <p className="workspace-muted">ACT/365 · CME/SOFR proxy · Değerleme: {formatDate(md.tradeDate)}.</p>
        {points.length ? (
          <svg
            viewBox="0 0 760 230"
            role="img"
            aria-label="Vadelere göre USD faiz ve metal taşıma oranları"
            style={{ width: '100%', minHeight: 210, marginTop: 20 }}
          >
            {[0, 0.5, 1].map(v => (
              <g key={v}>
                <line x1="45" x2="730" y1={20 + v * 170} y2={20 + v * 170} stroke="var(--border)" />
                <text x="0" y={25 + v * 170} fontSize="11" fill="var(--muted-foreground)">
                  {formatPercent(max - v * (max - min))}
                </text>
              </g>
            ))}
            <polyline
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2"
              points={points.map(t => `${x(t.days)},${y(t.rate365! * 100)}`).join(' ')}
            />
            <polyline
              fill="none"
              stroke="var(--chart-4)"
              strokeWidth="2"
              points={points.map(t => `${x(t.days)},${y(t.lease365! * 100)}`).join(' ')}
            />
            {[30, 90, 180, 270, 365].map(d => (
              <text key={d} x={x(d)} y="220" textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
                {d}g
              </text>
            ))}
          </svg>
        ) : (
          <p className="workspace-empty">Doğrulanmış eğri paketi okunamadı.</p>
        )}
        <div className="workspace-toolbar">
          <span className="desk-link">● USD faiz</span>
          <span style={{ color: 'var(--chart-4)', fontSize: 12 }}>● Metal taşıması · proxy</span>
        </div>
        <div className="workspace-table-scroll">
          <table className="workspace-table">
            <thead>
              <tr>
                <th>Vade</th>
                <th className="number">USD iskonto</th>
                <th className="number">USD faiz %</th>
                <th className="number">Taşıma %</th>
                <th className="number">Model forward</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody>
              {tenors.map(t => (
                <tr key={t.days}>
                  <td>
                    <button onClick={() => md.setField('expiryDate', t.expiry)}>
                      {t.days} gün · {t.expiry}
                    </button>
                  </td>
                  <td className="number">{t.discount === null ? '—' : formatNumber(t.discount, 6)}</td>
                  <td className="number">{t.rate365 === null ? '—' : formatNumber(t.rate365 * 100, 4)}</td>
                  <td className="number">{t.lease365 === null ? '—' : formatNumber(t.lease365 * 100, 4)}</td>
                  <td className="number">
                    {t.forwardRatio && feed.spot ? formatNumber(t.forwardRatio * feed.spot.price) : '—'}
                  </td>
                  <td>{t.discount === null ? 'Kapsam dışında' : 'Faktör eğrisi'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <details className="workspace-notes">
        <summary>Kaynak ve yöntem ayrıntıları</summary>
        <p className="workspace-muted">
          Manuel piyasa girdileri eğri–fiyat tutarlılığını bozar. Metal taşıması banka kira kotasyonu değildir.
        </p>
        <p className="workspace-muted" style={{ marginTop: 15 }}>
          USD: CME SR1 aylık futures ve NY Fed geçmiş SOFR fixing. Metal: gerçek futures tarihleri ve aynı settlement
          seansındaki spot referansı. Güncel fiyatlama terminal spotu ile faktör oranlarını kullanır. IV aynı paketle
          yeniden çözülür. Ayrı spot ve settlement zamanları eşit değildir.
        </p>
        <p className="workspace-muted" style={{ overflowWrap: 'anywhere' }}>
          Paket: {curve?.id ?? '—'} · Referans spot:{' '}
          {curve
            ? `${formatNumber(curve.referenceSpot.price)} / ${curve.referenceSpot.at} / ${curve.referenceSpot.source}`
            : '—'}
        </p>
        {curve?.warnings.map((w, i) => (
          <p key={i} className="workspace-muted">
            {w}
          </p>
        ))}
        <p className="workspace-muted">{feed.surface?.notes}</p>
      </details>
    </div>
  );
}
