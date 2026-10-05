'use client';

import { useEffect, useRef, useState } from 'react';
import { MARGIN_MATURITY_BUCKETS, COLLATERAL_HAIRCUT_RATES, RISK_THRESHOLDS, USD_TRY_RATE } from '@/lib/margin/config';
import { formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import {
  cmeStatusText,
  refreshCme,
  refreshResultText,
  type CmeRefreshStatus,
  type PricingRefreshStatus,
} from '@/lib/market-refresh';

export default function SettingsPage() {
  // Yüzeyin gece kurulduğu risksiz faiz oranı (SOFR)
  const [activeServerInterest, setActiveServerInterest] = useState<number | null>(null);

  // Etkin CME/SOFR paketinin ürün başına durumu (salt okunur).
  interface DsItem {
    product: string;
    fetchedISO: string | null;
    expiries: number;
    bundleId: string | null;
    notes: string | null;
  }
  const [dsItems, setDsItems] = useState<DsItem[]>([]);
  const [dsRefresh, setDsRefresh] = useState<PricingRefreshStatus | null>(null);
  const [dsUsd, setDsUsd] = useState<{
    sessionDate: string;
    sofrSession: string;
    degraded: boolean;
    warnings: string[];
  } | null>(null);
  const [dsBusy, setDsBusy] = useState<string | null>(null); // yenilenen ürün
  const [dsMsg, setDsMsg] = useState<{ text: string; error: boolean } | null>(null);
  const dsBusyRef = useRef(false);
  const dsAbort = useRef<AbortController | null>(null);
  useEffect(() => () => dsAbort.current?.abort(), []);

  const loadDataSources = () =>
    fetch('/api/settings/datasource')
      .then(r => r.json())
      .then(d => {
        setDsItems(d.items || []);
        setDsRefresh(d.refresh ?? null);
        setDsUsd(d.usd ?? null);
      })
      .catch(() => {});

  useEffect(() => {
    fetch('/api/settings/rate')
      .then(r => r.json())
      .then(d => setActiveServerInterest(Number.isFinite(d.rate) ? d.rate * 100 : null))
      .catch(() => {});
    loadDataSources();
  }, []);

  /** Bağlı GitHub işini başlatır ve aynı işin sonucunu izler; iki metal tek pakette güncellenir. */
  const refreshSource = async (product: string) => {
    if (dsBusyRef.current) return;
    dsBusyRef.current = true;
    const controller = new AbortController();
    dsAbort.current = controller;
    setDsBusy(product);
    setDsMsg(null);
    try {
      const status = await refreshCme(product, {
        signal: controller.signal,
        onStatus: (value: CmeRefreshStatus) =>
          setDsMsg({
            text: `${product}: CME yenilemesi ${cmeStatusText[value]}.`,
            error: value === 'failed' || value === 'timeout',
          }),
      });
      if (status !== 'completed') {
        setDsMsg({ text: `${product}: CME yenilemesi ${cmeStatusText[status]}.`, error: true });
        return;
      }
      await loadDataSources();
      setDsMsg({ text: `${product}: CME yenilemesi tamamlandı.`, error: false });
    } catch (e) {
      if (controller.signal.aborted) return;
      setDsMsg({ text: e instanceof Error ? e.message : 'Yenileme başarısız', error: true });
    } finally {
      if (dsAbort.current === controller) dsAbort.current = null;
      dsBusyRef.current = false;
      setDsBusy(null);
    }
  };

  const pct = (v: number) => formatPercent(v * 100, 0);
  return (
    <div className="desk-workspace">
      <div className="workspace-heading">
        <div>
          <h1>Ayarlar</h1>
        </div>
      </div>

      <div className="workspace-grid">
        <section className="workspace-panel">
          <h2>Piyasa parametreleri</h2>
          <div className="desk-market-facts">
            <div>
              <span>USD faiz eğrisi · 90 gün · ACT/365</span>
              <strong>{activeServerInterest != null ? formatPercent(activeServerInterest, 4) : 'Veri yok'}</strong>
            </div>
            <div>
              <span>USD/TRY</span>
              <strong>{formatNumber(USD_TRY_RATE)} TL · sabit</strong>
            </div>
          </div>
          <p className="desk-muted" style={{ marginTop: 12 }}>
            Faiz CME/SOFR endikatif proxy eğrisinden okunur; manuel piyasa girdisi eğri–fiyat tutarlılığını bozduğu için
            değiştirilemez. Gün bazı her işlemin koşullarında seçilir.
          </p>
          <details className="workspace-notes">
            <summary>Parametrelerin kullanımı</summary>
            <p>
              Gün bazı oranların gösterimini değiştirir; iskonto faktörü ve opsiyon primi korunur. USD/TRY yalnız
              1.000.000 TL onay eşiği ve TL karşılık gösterimi için kullanılır. Metal taşıması bankanın kira kotasyonu
              değildir.
            </p>
          </details>
        </section>

        <section className="workspace-panel">
          <h2>Risk eşikleri</h2>
          {[
            ['Teminat çağrısı (zarar / teminat)', pct(RISK_THRESHOLDS.MARGIN_CALL)],
            ['Stop uyarısı', pct(RISK_THRESHOLDS.STOP_LOSS_WARNING)],
            ['Anında stop', pct(RISK_THRESHOLDS.STOP_LOSS_IMMEDIATE)],
            ['Onay eşiği (açık teminat)', `${formatNumber(RISK_THRESHOLDS.DEFICIT_THRESHOLD_TL, 0)} TL`],
          ].map(([label, value]) => (
            <div className="desk-risk-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
          <p className="desk-muted" style={{ marginTop: 12 }}>
            Prosedür eşikleri · salt okunur
          </p>
        </section>
      </div>

      <section className="workspace-panel" style={{ marginTop: 24 }}>
        <h2>Veri kaynağı · IV yüzeyi</h2>
        <p className="desk-muted">Final seans · XAU/XAG birlikte güncellenir.</p>
        <details className="workspace-notes">
          <summary>Veri güncelleme yöntemi</summary>
          <p>
            CME final futures/opsiyon settlement, SOFR projeksiyonu ve settlement saatine yakın Tiingo spotu ortak paket
            olarak doğrulanır. Paket eksikse önceki doğrulanmış seans korunur.
          </p>
          <p>
            Otomatik kontrol iş günleri 08:15, 14:00 ve 21:30&apos;da (TSİ) çalışır; yeni final yoksa paket değişmez. Opsiyon
            finalleri geldiğinde paket güncellenir; SOFR finali gecikirse son geçerli SOFR eğrisi kullanılır ve aşağıda
            belirtilir. Elle yenileme aynı GitHub işini başlatır; önizlemede devre dışıdır.
          </p>
        </details>
        <div className="desk-market-facts" style={{ marginBottom: 12 }}>
          <div>
            <span>Son otomatik kontrol</span>
            <strong>{dsRefresh ? refreshResultText[dsRefresh.result] : 'Kayıt yok'}</strong>
            <small>{dsRefresh ? `${formatDateTime(dsRefresh.at)} · ${dsRefresh.message}` : '—'}</small>
          </div>
          <div>
            <span>Opsiyon / futures seansı · SOFR seansı</span>
            <strong>
              {dsUsd ? `${formatDate(dsUsd.sessionDate)} · ${formatDate(dsUsd.sofrSession)}` : 'Paket yok'}
            </strong>
            <small style={dsUsd?.degraded ? { color: 'var(--primary)' } : undefined}>
              {dsUsd?.warnings.length ? dsUsd.warnings.join(' ') : dsUsd ? 'SOFR aynı seanstan' : '—'}
            </small>
          </div>
        </div>
        {dsItems.map(item => (
          <div key={item.product} className="workspace-priority">
            <div>
              <strong>
                {item.product === 'XAU' ? 'XAU · Altın' : item.product === 'XAG' ? 'XAG · Gümüş' : item.product}
              </strong>
              <small>
                CME COMEX: {item.fetchedISO ? `${formatDate(item.fetchedISO)} · ${item.expiries} vade` : 'veri yok'}
                {item.bundleId
                  ? ` · CME/SOFR proxy sürüm ${item.bundleId.slice(0, 12)} · banka kira kotasyonu değildir`
                  : ' · ortak faiz/taşıma/IV sürümü yok'}
              </small>
              {item.notes && <small style={{ color: 'var(--primary)' }}>{item.notes}</small>}
            </div>
            <button className="desk-button" onClick={() => refreshSource(item.product)} disabled={dsBusy !== null}>
              {dsBusy === item.product ? 'CME durumu izleniyor…' : "CME'den yenile"}
            </button>
          </div>
        ))}
        {dsMsg && (
          <p className="desk-policy" role="status" style={{ marginTop: 12 }}>
            {dsMsg.text}
          </p>
        )}
      </section>

      <div className="workspace-grid" style={{ marginTop: 24 }}>
        <section className="workspace-panel">
          <h2>Teminat oranları · vade dilimleri</h2>
          <div className="workspace-table-scroll">
            <table className="workspace-table">
              <thead>
                <tr>
                  <th>Vade (gün)</th>
                  <th className="number">Grup 1 · USD, EUR, GBP, CHF, JPY</th>
                  <th className="number">Grup 2 · TRY, CNY, RUB, AUD</th>
                  <th className="number">Grup 3 · XAU, XAG, XPD, XPT</th>
                </tr>
              </thead>
              <tbody>
                {MARGIN_MATURITY_BUCKETS.map(b => (
                  <tr key={b.minDays}>
                    <td>
                      {b.minDays}–{b.maxDays}
                    </td>
                    <td className="number">{pct(b.rates.group1)}</td>
                    <td className="number">{pct(b.rates.group2)}</td>
                    <td className="number">{pct(b.rates.group3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="workspace-panel">
          <h2>Ek teminat haircut oranları</h2>
          <div className="workspace-table-scroll">
            <table className="workspace-table">
              <thead>
                <tr>
                  <th>Varlık</th>
                  <th className="number">Haircut</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(COLLATERAL_HAIRCUT_RATES).map(([code, rate]) => (
                  <tr key={code}>
                    <td>{code}</td>
                    <td className="number">{pct(rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
