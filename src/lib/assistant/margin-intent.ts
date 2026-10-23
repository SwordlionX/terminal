import { requestsCollateralAdd, userAmounts } from './policy';

const fold = (s: string) => s.normalize('NFKC').toLocaleLowerCase('tr-TR');
const explicit = (s: string) => /teminat|margin call/u.test(s) && /zarar|oran|eşik|kaç|hangi|yüzde|%|durum/u.test(s);

/** Narrow financial-procedure intent; follow-ups retain it, explicit new pricing does not. */
export function requestsMarginAnalysis(message: string, prior: string[] = []): boolean {
  const s = fold(message);
  // "işlemin/işlemler" is not the write command "işle". Keep portfolio questions on the read-only path.
  if (
    requestsCollateralAdd(message) &&
    /(?:^|[^\p{L}])(?:ekle|ekleyin|ekleyelim|eklesene|ekler|kaydet|kaydedin|işle|işleyin|gir|girin|yatır|yatırın|aldık|alındı|verdi)(?!\p{L})/u.test(
      s,
    )
  )
    return false;
  if (/hedge|korunma|mtm|yeni\s+(?:işlem|opsiyon)|opsiyonu?\s+fiyatla/u.test(s)) return false;
  if (explicit(s)) return true;
  if (/fiyatla|prim|hedge|korunma|volatilite|yeni işlem|mtm/u.test(s)) return false;
  return prior.slice(-2).some(p => explicit(fold(p))) && /seviye|spot|ons|oran|yüzde|%|kaç|hedef/u.test(s);
}

/** Overrides must come from the user's collateral clause, never from a model or stored balance. */
export function collateralScenarioAmount(message: string): number | undefined {
  const s = fold(message);
  if (!/teminat/u.test(s) || /ekle|ilave|artır|azalt|yatır|sil/u.test(s)) return undefined;
  const amounts = [
    ...s.matchAll(
      /(?:\d+(?:[.,]\d+)*\s*(?:bin|milyon|k)?\s*(?:usd|dolar|\$))|(?:(?:usd|dolar|\$)\s*\d+(?:[.,]\d+)*\s*(?:bin|milyon|k)?)/gu,
    ),
  ].flatMap(m => userAmounts(m[0]));
  const unique = [...new Set(amounts)];
  if (unique.length > 1)
    throw new Error('Teminat tutarı birden fazla veya belirsiz. Varsayımsal toplam USD teminatını netleştirin.');
  return unique[0];
}

export function marginScenarioInputs(message: string, prior: string[], args: Record<string, unknown>) {
  const source = [message, ...[...prior].reverse().slice(0, 2)];
  // A current explicit instruction to use the records ends a previous override.
  const useRecords = /(?:kayıtlı|sistemdeki|gerçek)\s+teminat/u.test(fold(message));
  let collateral = useRecords ? undefined : collateralScenarioAmount(message);
  if (collateral === undefined && !useRecords && requestsMarginAnalysis(message, prior)) {
    for (const text of source.slice(1)) {
      if (/(?:kayıtlı|sistemdeki|gerçek)\s+teminat/u.test(fold(text))) break;
      collateral = collateralScenarioAmount(text);
      if (collateral !== undefined) break;
      if (/teminat/u.test(fold(text))) break;
    }
  }
  if (args.collateralOverrideUsd !== undefined && args.collateralOverrideUsd !== collateral)
    throw new Error(
      'Varsayımsal teminat kullanıcının belirttiği toplam USD tutarıyla eşleşmiyor; kayıtlı teminatı varsayım gibi gönderme.',
    );
  const percentagesIn = (text: string) =>
    [...fold(text).matchAll(/(?:%|yüzde)\s*(\d+(?:[.,]\d+)?)/gu)].map(m => Number(m[1].replace(',', '.')));
  let percentages = percentagesIn(message);
  if (!percentages.length && /seviye|spot|ons|hedef|ulaş|gelir/u.test(fold(message))) {
    percentages =
      source
        .slice(1)
        .map(percentagesIn)
        .find(p => p.length > 0) ?? [];
  }
  let target = percentages.length === 1 ? percentages[0] : undefined;
  if (args.targetRatioPct !== undefined) {
    if (typeof args.targetRatioPct !== 'number' || !percentages.includes(args.targetRatioPct))
      throw new Error('Hedef yüzde kullanıcı tarafından belirtilmedi. Hangi zarar/teminat oranını istediğini sor.');
    target = args.targetRatioPct;
  }
  if (percentages.length > 1 && target === undefined)
    throw new Error('Birden fazla yüzde var; hedef zarar/teminat oranını netleştirin.');
  return { targetRatioPct: target, collateralOverrideUsd: collateral };
}
