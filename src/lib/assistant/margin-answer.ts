import type { MarginThresholdResult } from '../margin/threshold';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent } from '../format';

/** Procedure answers are rendered from the result, never re-calculated or rephrased by the model. */
export function marginAnswer(r: MarginThresholdResult): string {
  const lines = [
    `Hesaptaki ${r.product} spotu **${formatNumber(r.currentSpot, 4)} USD/ons**. Brüt zarar **${formatMoney(r.currentLossUsd)}**, hesapta kullanılan teminat **${formatMoney(r.usedCollateralUsd)}**.`,
    r.currentRatioPct === null
      ? 'Pozitif teminat olmadığı için zarar/teminat oranı tanımsız.'
      : `Mevcut zarar/teminat oranı **${formatPercent(r.currentRatioPct)}**.`,
  ];
  if (r.collateralOverride)
    lines.push(
      `Kayıtlı teminat ${formatMoney(r.recordedCollateralUsd)}; talebinizdeki toplam USD teminatıyla ayrı senaryo hesaplandı. Kayıt değiştirilmedi.`,
    );
  if (r.targetRatioPct !== null) {
    if (r.status === 'non_unique')
      lines.push(`${formatPercent(r.targetRatioPct)} hedefi bir fiyat aralığında sabit; tek bir eşik fiyatı yok.`);
    else if (!r.levels.length)
      lines.push(
        `${formatPercent(r.targetRatioPct)} hedefine, sıfır veya üzerindeki sonlu spotlarda pozitif teminatla ulaşılamıyor.`,
      );
    else
      for (const l of r.levels)
        lines.push(
          `**${formatPercent(r.targetRatioPct)} için spot: ${formatNumber(l.spot, 4)} USD/ons.** Bu seviyede brüt zarar ${formatMoney(l.lossUsd)}, teminat ${formatMoney(l.collateralUsd)}; mevcut spota göre değişim ${formatPercent(l.movePct)}.`,
        );
  }
  lines.push(
    `${r.tradeIds.length} açık işlem birlikte hesaplandı. İlk vade **${formatDate(r.validBefore)}**; sonuç bu tarihten önce, işlemler ve teminat adetleri değişmeden geçerlidir. Bu bir tarih/fiyat tahmini değil, brüt içsel zarar prosedürüdür; short primleri düşülmez, model MTM değildir.`,
  );
  if (!r.collateralOverride)
    lines.push('Seçilen metal teminatı senaryo spotuyla yeniden değerlenir; diğer metal spotları sabittir.');
  for (const s of r.spots)
    lines.push(
      `${s.product} gözlemi: ${s.quoteAt ? formatDateTime(s.quoteAt) : 'zamanı doğrulanamıyor'} · ${s.source}${s.stale ? ' · eski/doğrulanamayan veri' : ''}.`,
    );
  lines.push(...r.warnings);
  return lines.join('\n\n');
}
