"use client";

import { useEffect, useRef, useState } from "react";
import { MARGIN_MATURITY_BUCKETS, COLLATERAL_HAIRCUT_RATES, RISK_THRESHOLDS, USD_TRY_RATE } from "@/lib/margin/config";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { cmeStatusText, refreshCme, type CmeRefreshStatus } from '@/lib/market-refresh';

export default function SettingsPage() {
  // Yüzeyin gece kurulduğu risksiz faiz oranı (SOFR)
  const [activeServerInterest, setActiveServerInterest] = useState<number | null>(null);

  // Veri kaynağı (Yahoo/CME) durumu — sunucuda kv tablosunda saklanır.
  interface DsItem {
    product: string;
    source: 'yahoo' | 'cme';
    cmeSupported: boolean;
    cmeFetchedISO: string | null;
    cmeExpiries: number;
    /** Yüzey kurulurken atlanan günler vb. teşhis notu (yoksa null). */
    cmeNotes: string | null;
    yahooSymbol: string | null;
    yahooFetchedISO: string | null;
    yahooExpiries: number;
  }
  const [dsItems, setDsItems] = useState<DsItem[]>([]);
  const [dsBusy, setDsBusy] = useState<string | null>(null); // yenilenen ürün
  const [dsMsg, setDsMsg] = useState<{ text: string; error: boolean } | null>(null);
  const dsBusyRef = useRef(false);
  const dsAbort = useRef<AbortController | null>(null);
  useEffect(() => () => dsAbort.current?.abort(), []);

  const loadDataSources = () =>
    fetch('/api/settings/datasource').then(r => r.json()).then(d => setDsItems(d.items || [])).catch(() => {});

  useEffect(() => {
    fetch('/api/settings/rate')
      .then(r => r.json())
      .then(d => setActiveServerInterest(Number.isFinite(d.rate) ? d.rate * 100 : null))
      .catch(() => {});
    loadDataSources();
  }, []);

  /**
   * Seçili kaynaktan veriyi ÇEKER ve yüzeyi yeniden kurar.
   * - Yahoo: ETF opsiyon zincirleri baştan çekilir; tek istek HEM altını (GLD) HEM gümüşü
   *   (SLV) yeniler — snapshot ortak olduğu için ürün ayrımı yok.
   * - CME: yalnız o ürünün settlement yüzeyi yeniden kurulur.
   * İki kaynak veritabanında ayrı yazılır; biri diğerini ezmez.
   */
  const refreshSource = async (product: string, source: 'yahoo' | 'cme') => {
    if (dsBusyRef.current) return;
    dsBusyRef.current = true;
    const controller = new AbortController();
    dsAbort.current = controller;
    setDsBusy(product);
    setDsMsg(null);
    try {
      if (source === 'cme') {
        const status = await refreshCme(product, {
          signal: controller.signal,
          onStatus: (value: CmeRefreshStatus) => setDsMsg({ text: `${product}: CME yenilemesi ${cmeStatusText[value]}.`, error: value === 'failed' || value === 'timeout' }),
        });
        if (status !== 'completed') {
          setDsMsg({ text: `${product}: CME yenilemesi ${cmeStatusText[status]}.`, error: true });
          return;
        }
        await loadDataSources();
        setDsMsg({ text: `${product}: CME yenilemesi tamamlandı.`, error: false });
      } else {
        const res = await fetch('/api/market/refresh', { method: 'POST', signal: controller.signal });
        const d = await res.json();
        if (!res.ok || !d.ok) throw new Error(d?.error || 'Yenileme başarısız');
        await loadDataSources();
        setDsMsg({
          text: `Yahoo zincirleri yenilendi (${d.fetchedISO}) — ${Object.entries(d.expiries || {}).map(([k, v]) => `${k}: ${v} vade`).join(', ')}.`,
          error: false,
        });
      }
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
      <div className="workspace-heading"><div><h1>Ayarlar</h1></div></div>

      <div className="workspace-grid">
        <section className="workspace-panel">
          <h2>Piyasa parametreleri</h2>
          <div className="desk-market-facts">
            <div><span>USD faiz eğrisi · 90 gün · ACT/365</span><strong>{activeServerInterest != null ? formatPercent(activeServerInterest, 4) : 'Veri yok'}</strong></div>
            <div><span>USD/TRY</span><strong>{formatNumber(USD_TRY_RATE)} TL · sabit</strong></div>
          </div>
          <p className="desk-muted" style={{ marginTop: 12 }}>Faiz CME/SOFR endikatif proxy eğrisinden okunur; manuel piyasa girdisi eğri–fiyat tutarlılığını bozduğu için değiştirilemez. Gün bazı her işlemin koşullarında seçilir.</p>
          <details className="workspace-notes"><summary>Parametrelerin kullanımı</summary><p>Gün bazı oranların gösterimini değiştirir; iskonto faktörü ve opsiyon primi korunur. USD/TRY yalnız 1.000.000 TL onay eşiği ve TL karşılık gösterimi için kullanılır. Metal taşıması bankanın kira kotasyonu değildir.</p></details>
        </section>

        <section className="workspace-panel">
          <h2>Risk eşikleri</h2>
          {[['Teminat çağrısı (zarar / teminat)', pct(RISK_THRESHOLDS.MARGIN_CALL)], ['Stop uyarısı', pct(RISK_THRESHOLDS.STOP_LOSS_WARNING)], ['Anında stop', pct(RISK_THRESHOLDS.STOP_LOSS_IMMEDIATE)], ['Onay eşiği (açık teminat)', `${formatNumber(RISK_THRESHOLDS.DEFICIT_THRESHOLD_TL, 0)} TL`]].map(([label, value]) => <div className="desk-risk-item" key={label}><span>{label}</span><strong>{value}</strong></div>)}
          <p className="desk-muted" style={{ marginTop: 12 }}>Prosedür eşikleri · salt okunur</p>
        </section>
      </div>

      <section className="workspace-panel" style={{ marginTop: 24 }}>
        <h2>Veri kaynağı · IV yüzeyi</h2>
        <p className="desk-muted">Final seans · XAU/XAG birlikte güncellenir.</p>
        <details className="workspace-notes"><summary>Veri güncelleme yöntemi</summary><p>CME final futures/opsiyon settlement, SOFR projeksiyonu ve settlement saatine yakın Tiingo spotu ortak paket olarak doğrulanır. Paket eksikse önceki doğrulanmış seans korunur.</p><p>Yenileme bağlı GitHub işinin sonucunu izler; önizlemede devre dışıdır. Otomatik yenilemenin etkinleştirilmesi ayrıca kararlaştırılacak.</p></details>
        {dsItems.map(item => (
          <div key={item.product} className="workspace-priority">
            <div>
              <strong>{item.product === 'XAU' ? 'XAU · Altın' : item.product === 'XAG' ? 'XAG · Gümüş' : item.product}</strong>
              <small>CME COMEX: {item.cmeFetchedISO ? `${formatDate(item.cmeFetchedISO)} · ${item.cmeExpiries} vade` : 'veri yok'}{item.source !== 'cme' ? ' · etkin kaynak değil' : ''}</small>
              {item.cmeNotes && <small style={{ color: 'var(--primary)' }}>{item.cmeNotes}</small>}
            </div>
            <button className="desk-button" onClick={() => refreshSource(item.product, item.source)} disabled={dsBusy !== null}>
              {dsBusy === item.product ? (item.source === 'cme' ? 'CME durumu izleniyor…' : 'Çekiliyor…') : item.source === 'cme' ? "CME'den yenile" : "Yahoo'dan yenile"}
            </button>
          </div>
        ))}
        {dsMsg && <p className="desk-policy" role="status" style={{ marginTop: 12 }}>{dsMsg.text}</p>}
      </section>

      <div className="workspace-grid" style={{ marginTop: 24 }}>
        <section className="workspace-panel">
          <h2>Teminat oranları · vade dilimleri</h2>
          <div className="workspace-table-scroll"><table className="workspace-table">
            <thead><tr><th>Vade (gün)</th><th className="number">Grup 1 · USD, EUR, GBP, CHF, JPY</th><th className="number">Grup 2 · TRY, CNY, RUB, AUD</th><th className="number">Grup 3 · XAU, XAG, XPD, XPT</th></tr></thead>
            <tbody>{MARGIN_MATURITY_BUCKETS.map(b => <tr key={b.minDays}><td>{b.minDays}–{b.maxDays}</td><td className="number">{pct(b.rates.group1)}</td><td className="number">{pct(b.rates.group2)}</td><td className="number">{pct(b.rates.group3)}</td></tr>)}</tbody>
          </table></div>
        </section>
        <section className="workspace-panel">
          <h2>Ek teminat haircut oranları</h2>
          <div className="workspace-table-scroll"><table className="workspace-table">
            <thead><tr><th>Varlık</th><th className="number">Haircut</th></tr></thead>
            <tbody>{Object.entries(COLLATERAL_HAIRCUT_RATES).map(([code, rate]) => <tr key={code}><td>{code}</td><td className="number">{pct(rate)}</td></tr>)}</tbody>
          </table></div>
        </section>
      </div>
    </div>
  );
}
