'use client';

import { useState } from 'react';
import { NumberInput } from '@/components/ui/number-input';
import { marginThreshold, type MarginSnapshot, type MarginThresholdResult } from '@/lib/margin/threshold';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent } from '@/lib/format';

export function MarginThresholdView({ result: r }: { result: MarginThresholdResult }) {
  return (
    <div className="min-w-0 space-y-3" aria-label="Zarar teminat eşik sonucu">
      <div className="grid grid-cols-2 gap-3 text-sm">
        {[
          [`${r.product} · hesap spotu`, `${formatNumber(r.currentSpot, 4)} USD/ons`],
          [
            'Mevcut zarar / teminat',
            r.currentRatioPct === null ? 'Teminat yok · oran tanımsız' : formatPercent(r.currentRatioPct),
          ],
          ['Brüt zarar · prim hariç', formatMoney(r.currentLossUsd)],
          [
            r.collateralOverride ? 'Senaryodaki toplam teminat' : 'İskonto sonrası teminat',
            formatMoney(r.usedCollateralUsd),
          ],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="workspace-muted">{label}</p>
            <strong className="break-words">{value}</strong>
          </div>
        ))}
      </div>
      {r.collateralOverride && (
        <p className="desk-policy">
          Kayıtlı teminat: {formatMoney(r.recordedCollateralUsd)}. Yukarıdaki tutar yalnız USD senaryosudur; kayıt
          değişmez.
        </p>
      )}
      {r.targetRatioPct !== null && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-sm font-semibold">Hedef zarar / teminat: {formatPercent(r.targetRatioPct)}</p>
          {r.calculation === 'additional_collateral' && (
            <div className="mt-3 space-y-1">
              <p className="workspace-muted">Müşteriden istenecek ek USD nakit teminat</p>
              <strong className="text-lg text-primary">{formatMoney(r.additionalCollateralUsd!)}</strong>
              {r.additionalCollateralUsd === 0 && (
                <p className="text-sm">Mevcut teminat hedef oranı sağlıyor; ek teminat gerekmiyor.</p>
              )}
              <p className="workspace-muted">Hedef için asgari toplam: {formatMoney(r.requiredTotalCollateralUsd!)}.</p>
              <p className="workspace-muted">
                Ek tutar sonrası toplam: {formatMoney(r.usedCollateralUsd + r.additionalCollateralUsd!)} · Oran:{' '}
                {r.ratioAfterDepositPct === null ? 'Tanımsız' : formatPercent(r.ratioAfterDepositPct!)}.
              </p>
              <p className="workspace-muted">
                Mevcut spot ve zarar sabittir. Ek tutar USD kuruşuna yukarı yuvarlanır; teminat kaydı eklenmez.
              </p>
            </div>
          )}
          {r.calculation !== 'additional_collateral' &&
            r.levels.map(level => (
              <div className="mt-3" key={level.spot}>
                <strong className="text-lg text-primary">{formatNumber(level.spot, 4)} USD/ons</strong>
                <p className="workspace-muted">
                  Spot değişimi {formatPercent(level.movePct)} · Brüt zarar {formatMoney(level.lossUsd)} · Teminat{' '}
                  {formatMoney(level.collateralUsd)}
                </p>
              </div>
            ))}
          {r.status === 'unreachable' && (
            <p className="mt-2 text-sm">
              Bu pozisyon ve teminatla hedef orana ulaşan sonlu, sıfır veya üzeri bir spot yok.
            </p>
          )}
          {r.status === 'non_unique' && (
            <p className="mt-2 text-sm">Hedef oran bir fiyat aralığında sabit; tek bir eşik seviyesi yok.</p>
          )}
          {r.levels.length > 1 && (
            <p className="workspace-muted mt-2">Hedefe birden fazla fiyat seviyesinde ulaşılıyor.</p>
          )}
        </div>
      )}
      <p className="workspace-muted">
        {r.tradeIds.length} açık işlem · {formatDate(r.validBefore)} tarihindeki ilk vadeden önce, portföy değişmeden
        geçerlidir.
      </p>
      {r.warnings.map(w => (
        <p className="desk-policy" key={w}>
          {w}
        </p>
      ))}
      <details className="workspace-notes">
        <summary>Veri zamanı ve hesap varsayımları</summary>
        <p>Dosya okuma: {formatDateTime(r.observedAt)}. Piyasa gözlem zamanı aşağıdadır.</p>
        {r.spots.map(s => (
          <p key={s.product}>
            {s.product}: {formatNumber(s.price, 4)} USD/ons · {s.source} ·{' '}
            {s.quoteAt ? formatDateTime(s.quoteAt) : 'Gözlem zamanı bilinmiyor'}
            {s.stale ? ' · Eski/doğrulanamayan gözlem' : ''}
          </p>
        ))}
        {r.notes.map(note => (
          <p key={note}>{note}</p>
        ))}
      </details>
    </div>
  );
}

export function MarginThresholdCalculator({ snapshot }: { snapshot: MarginSnapshot }) {
  const products = [...new Set(snapshot.positions.filter(p => p.position === 'Short').map(p => p.product))];
  const [product, setProduct] = useState(products.length === 1 ? products[0] : '');
  const [calculation, setCalculation] = useState<'spot_threshold' | 'additional_collateral'>('spot_threshold');
  const [target, setTarget] = useState(55);
  const [override, setOverride] = useState(false);
  const recorded =
    snapshot.collaterals.reduce((v, c) => v + c.valueUsd * (1 - c.haircut), 0) +
    snapshot.positions.filter(p => p.position === 'Long').reduce((v, p) => v + p.premium, 0);
  const [collateral, setCollateral] = useState(recorded);
  let result: MarginThresholdResult | undefined, error: string | undefined;
  try {
    result = marginThreshold(snapshot, {
      product: product || undefined,
      targetRatioPct: target,
      collateralOverrideUsd: override ? collateral : undefined,
      calculation,
    });
  } catch (e) {
    error = e instanceof Error ? e.message : 'Hesap tamamlanamadı.';
  }
  return (
    <section className="workspace-panel" aria-label="Teminat hedef hesaplayıcı">
      <h2>Teminat hedef hesabı</h2>
      <p className="workspace-muted">
        Tüm açık işlemler birlikte hesaplanır. Bu alan kayıtları değiştirmez; opsiyon fiyatlaması yapmaz.
      </p>
      <div className="workspace-toolbar">
        <label className="desk-field">
          Hesap türü
          <select
            aria-label="Teminat hesap türü"
            value={calculation}
            onChange={e => setCalculation(e.target.value as typeof calculation)}
          >
            <option value="spot_threshold">Hangi spotta bu orana gelir?</option>
            <option value="additional_collateral">Hedef oran için ek teminat</option>
          </select>
        </label>
        {calculation === 'spot_threshold' && (
          <label className="desk-field">
            Senaryo metali
            <select aria-label="Senaryo metali" value={product} onChange={e => setProduct(e.target.value)}>
              <option value="">Metal seçin</option>
              {products.map(p => (
                <option key={p} value={p}>
                  {p === 'XAG' ? 'Gümüş · XAG' : p === 'XAU' ? 'Altın · XAU' : p}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="desk-field">
          Hedef zarar / teminat · %
          <NumberInput aria-label="Hedef zarar teminat yüzdesi" value={target} onValueChange={setTarget} />
        </label>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />
        Kayıtlı teminat yerine toplam USD teminatı varsay
      </label>
      {override && (
        <label className="desk-field mb-4">
          Varsayımsal toplam teminat · USD
          <NumberInput aria-label="Varsayımsal toplam USD teminatı" value={collateral} onValueChange={setCollateral} />
        </label>
      )}
      {error && (
        <p role="status" className="desk-policy">
          {error}
        </p>
      )}
      {result && <MarginThresholdView result={result} />}
    </section>
  );
}
