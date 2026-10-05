import type { MarketSnapshot, PremiumUnit, ScreenContext } from './types';
import { istanbulToday } from '../dates';

export class PremiumBasisClarification extends Error {}
export class TradeQuantityClarification extends Error {}
export class TradeTermsClarification extends Error {}

/** Screen data is opt-in, never a default for a free-standing conversation. */
export function requestsScreenContext(message: string): boolean {
  const text = message.normalize('NFKC').toLocaleLowerCase('tr-TR');
  if (/(?:ekran|seçili)[^.;\n]{0,65}(?:kullanma|alma|okuma|bakma|devralma|istemiyorum)/u.test(text)) return false;
  return /ekrandaki|ekrandan|ekranı\s+(?:oku|incele)|ekranda\s+(?:seçili|açık|görünen|gördüğün)|(?:bu|o|mevcut|açık)\s+ekran|seçili(?:\s+[^\s.;,?!]+){0,2}?\s+(?:müşteri|dosya|kayıt|pozisyon|işlem|opsiyon|put|call|bilet)/u.test(
    text,
  );
}

export function valuationToday(): string {
  return istanbulToday();
}

export const ASSISTANT_CONVERSATION_SCOPE = 'request-led-v2';

export function genericPricingQuestion(message: string): string | undefined {
  const text = message
    .normalize('NFKC')
    .toLocaleLowerCase('tr-TR')
    .trim()
    .replace(/[.!?,]+$/u, '')
    .replace(/^(?:kanka|lütfen)\s*,?\s*/u, '');
  if (
    !/^(?:bana\s+)?(?:bir fiyat (?:al|ver)|fiyatla|(?:bir\s+)?opsiyon fiyatla|(?:yeni\s+)?bir opsiyon fiyatlamak istiyorum(?:\. gerekli işlem koşullarını sor)?)$/u.test(
      text,
    )
  )
    return;
  return 'Hangi işlemi fiyatlayalım? Altın mı gümüş mü, call mu put mu, müşteri alacak mı satacak mı? Ons miktarını, kullanım fiyatını ve vadeyi de belirtir misiniz?';
}

/** Reject omissions and conflicts with a single explicit quantity; do not infer hedge ratios. */
export function assertTradeQuantity(quantity: number | undefined, message: string, priorUserMessages: string[] = []) {
  if (quantity === undefined)
    throw new TradeQuantityClarification(
      'İşlem miktarı eksik. Kaç ons olduğunu kullanıcıya sor; ekran miktarını kendiliğinden alma.',
    );
  const quantitiesIn = (text: string) =>
    [...text.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(?:ons|adet)(?!\p{L})/giu)]
      .map(m => m[1])
      .map(s => (/^\d+[.,]\d{3}$/.test(s) ? NaN : Number(s.replace(',', '.'))));
  if (/(?:ons|adet)(?:\s+\p{L}+){0,3}\s+(?:istemiyor\p{L}*|değil|olmasın|kullanma|alma)(?!\p{L})/iu.test(message))
    throw new TradeQuantityClarification(
      'Miktar ifadesi ret veya düzeltme içeriyor. Kullanıcıdan geçerli miktarı netleştirmesini iste; ret ifadesindeki sayıyı işlem miktarı sayma.',
    );
  let quantities = quantitiesIn(message);
  if (!quantities.length) {
    for (const prior of [...priorUserMessages].reverse()) {
      quantities = quantitiesIn(prior);
      if (quantities.length) break;
    }
  }
  if (quantities.some(q => !Number.isFinite(q)))
    throw new TradeQuantityClarification(
      'Miktardaki binlik/ondalık ayracı belirsiz. Kullanıcıdan ons/adet miktarını netleştirmesini iste; fiyat kartı üretme.',
    );
  const unique = [...new Set(quantities)];
  if (unique.length === 1 && quantity !== unique[0])
    throw new TradeQuantityClarification(
      `Araç miktarı açık kullanıcı miktarına uymuyor. Bu istekte miktar ${unique[0]} ons/adet; ekran miktarı veya birim başına 1 ile değiştirme. Doğru miktarı araçta gönder.`,
    );
}

/** Only the user's words can authorize a percentage basis, never a model's tool arguments. */
export function assertPremiumBasis(unit: PremiumUnit, message: string, priorUserMessages: string[] = []) {
  if (unit !== 'pct_spot' && unit !== 'pct_strike') return;
  const basisIn = (text: string): PremiumUnit | 'ambiguous' | undefined => {
    const normalized = text.toLocaleLowerCase('tr-TR');
    const referencesBasis =
      /(?:spot|strike|kullanım fiyatı\p{L}*)\s+(?:nominal\p{L}*|baz\p{L}*|üzerinden|üzerine|based|basis|yüzde|%)/u.test(
        normalized,
      );
    const spot = /spot(?:un| fiyatının)?\s+(?:nominal\p{L}*|baz\p{L}*|üzerinden|üzerine|based|basis|yüzde|%)/u.test(
      normalized,
    );
    const strike =
      /(?:strike(?:ın)?|kullanım fiyatı(?:nın)?)\s+(?:nominal\p{L}*|baz\p{L}*|üzerinden|üzerine|based|basis|yüzde|%)/u.test(
        normalized,
      );
    if (
      (referencesBasis || spot || strike) &&
      /(?:istemiyor|kullanma|değil|ne demek|seçmedim|bilmiyor|emin değil|olsun mu|hangisi|(?:üzerinden|nominali|bazında|üzerine)\s+m[ıiuü]\b)/u.test(
        normalized,
      )
    )
      return 'ambiguous';
    if (spot && strike) return 'ambiguous';
    return spot ? 'pct_spot' : strike ? 'pct_strike' : referencesBasis ? 'ambiguous' : undefined;
  };
  const basis = basisIn(message) ?? priorUserMessages.map(basisIn).findLast(v => v !== undefined);
  if (!basis || basis === 'ambiguous')
    throw new PremiumBasisClarification(
      'Yüzde primin spot nominali mi kullanım fiyatı nominali mi olduğu net değil. Arama yapmadan kullanıcıya bu tek soruyu sor; kendin baz seçme.',
    );
  if (basis !== unit)
    throw new PremiumBasisClarification(
      'Seçilen yüzde prim birimi kullanıcının belirttiği nominal bazına uymuyor. Kullanıcının belirttiği baz ile devam et.',
    );
}

export const MANUAL_PRICING_BLOCKED =
  'Manuel spot, volatilite, faiz veya kira varsayımı terminal eğrisiyle fiyatlama tutarlılığını bozar. Asistan manuel fiyatlama yapmaz; terminalin otomatik verisini ve mevcut eğrisini kullanır. Manuel spot/IV modunu kapatın.';
export const MANUAL_OVERRIDE_REFUSAL =
  'Manuel spot, volatilite, faiz veya kira varsayımları terminal eğrisiyle fiyatlama tutarlılığını bozar. Bu değerlerle fiyatlama yapamam. Yalnız terminalin mevcut eğrisiyle devam edebilirim; isterseniz mevcut eğriyle hesaplayayım.';

/** Explicit market overrides are refused before the model can silently ignore them. */
export function requestsManualPricing(message: string): boolean {
  const text = message.normalize('NFKC').toLocaleLowerCase('tr-TR');
  if (!/(?:fiyatla|hesapla|hesap\s+ist|kullan|olsun|varsay|override|price\b|calculate)/u.test(text)) return false;
  // Retain concept questions and the user's explicit request for automatic pricing.
  if (/manuel[^.;\n]{0,70}(?:yapma|kullanma|alma|istemi|olmasın)/u.test(text)) return false;
  const numericOverride =
    /(?:spot|iv|volatilite|vol|faiz|kira|taşıma|interest rate|lease rate)\s*(?:oranı\s*)?(?:[=:]\s*)?(?:yüzde\s*|%\s*)?\d+(?:[.,]\d+)?/u.test(
      text,
    );
  const manualIntent =
    /manuel[^.;\n]{0,80}(?:fiyatla|hesapla|hesap\s+ist|değer|girdi|spot|iv|faiz|kira|volatilite)/u.test(text);
  return numericOverride || manualIntent;
}
export function assertAutomaticPricingMessage(message: string) {
  if (requestsManualPricing(message)) throw new Error(MANUAL_OVERRIDE_REFUSAL);
}
const marketOverrides = ['spot', 'vol', 'manualVol', 'manualSpot', 'rate', 'lease'];

/** Checked again at the pricing boundary, even when bypassing JSON validation. */
export function assertCurvePricing(request: unknown, screen: ScreenContext) {
  if (
    screen.manualSpot ||
    screen.manualVol ||
    (request &&
      typeof request === 'object' &&
      marketOverrides.some(key => Object.prototype.hasOwnProperty.call(request, key)))
  ) {
    throw new Error(MANUAL_PRICING_BLOCKED);
  }
}

export function terminalCurveInputs(screen: ScreenContext, market: MarketSnapshot) {
  assertCurvePricing({}, screen);
  if (market.spot == null || !Number.isFinite(market.spot) || market.spot <= 0)
    throw new Error('Terminalin spot verisi alınamadı. Dışarıdan fiyat aranmaz; fiyatlama durduruldu.');
  if (!market.surface)
    throw new Error('Terminalin volatilite eğrisi yok. Manuel veya dış veri kullanılmaz; fiyatlama durduruldu.');
  if (market.surface.curves) {
    if (market.surface.curves.id.length === 0) throw new Error('Terminal eğri sürümü eksik.');
    // Placeholder values are never used for pricing; the shared engine resolves factors per maturity.
    return { spot: market.spot, rate: 0, lease: 0, vol: 0, manualVol: false as const };
  }
  const { builtWithR, impliedLeaseRate } = market.surface;
  if (
    builtWithR == null ||
    !Number.isFinite(builtWithR) ||
    impliedLeaseRate == null ||
    !Number.isFinite(impliedLeaseRate)
  )
    throw new Error('Terminal eğrisinin faiz/kira bilgisi eksik. Manuel varsayımla tamamlanmaz; fiyatlama durduruldu.');
  return {
    spot: market.spot,
    rate: builtWithR * 100,
    lease: impliedLeaseRate * 100,
    vol: 0,
    manualVol: false as const,
  };
}

/** Amounts the user actually wrote: "100 bin", "1,5 milyon", "100.000", "250 ons". Ambiguous separators yield both readings. */
export function userAmounts(message: string): number[] {
  const out = new Set<number>();
  const text = message.normalize('NFKC').toLocaleLowerCase('tr-TR');
  for (const m of text.matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)*)\s*(milyon|bin|k)?(?!\p{L})/gu)) {
    const raw = m[1],
      scale = m[2] === 'milyon' ? 1e6 : m[2] === 'bin' || m[2] === 'k' ? 1e3 : 1;
    const readings: string[] = [];
    if (raw.includes('.') && raw.includes(',')) readings.push(raw.replace(/\./g, '').replace(',', '.'));
    else if (raw.includes('.')) readings.push(/^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw);
    else if (raw.includes(',')) {
      readings.push(raw.replace(',', '.'));
      if (/^\d{1,3}(,\d{3})+$/.test(raw)) readings.push(raw.replace(/,/g, ''));
    } else readings.push(raw);
    for (const r of readings) {
      const value = Number(r) * scale;
      if (Number.isFinite(value) && value > 0) out.add(Math.round(value * 1e6) / 1e6);
    }
  }
  return [...out];
}

/** Only an explicit instruction in the current message may add collateral. */
export function requestsCollateralAdd(message: string): boolean {
  const text = message.normalize('NFKC').toLocaleLowerCase('tr-TR');
  if (!/teminat/u.test(text)) return false;
  if (/(eklemeyin|eklemeyelim|eklenmesin|ekleme\s+yapma|istemiyorum|iptal|sil)/u.test(text)) return false;
  return /(ekle|eklen|kaydet|işle|gir\b|girin|yatır|aldık|alındı|verdi)/u.test(text);
}
