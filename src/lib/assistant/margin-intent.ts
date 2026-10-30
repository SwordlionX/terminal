import { requestsCollateralAdd, userAmounts } from './policy';
import { RISK_THRESHOLDS } from '../margin/config';

const fold = (s: string) => s.normalize('NFKC').toLocaleLowerCase('tr-TR');
const explicit = (s: string) => /teminat|margin call/u.test(s) && /zarar|oran|eşik|kaç|hangi|yüzde|%|durum/u.test(s);

/** Extra cash and a spot move are different ways to reach the same target ratio. */
export function marginCalculation(
  message: string,
  prior: string[] = [],
): 'additional_collateral' | 'spot_threshold' | undefined {
  const identify = (text: string) => {
    const s = fold(text);
    if (
      /(?:ek|ilave)\s+(?:ne\s+kadar\s+)?teminat|(?:ne\s+kadar|kaç)\s+(?:ek\s+|ilave\s+)?teminat|teminat\s+(?:ihtiyacı|açığı|tutarı)/u.test(
        s,
      )
    )
      return 'additional_collateral' as const;
    if (
      /hangi\s+(?:spot|fiyat)|kaç[^.;\n]{0,25}(?:ons|spot|fiyat)|spot[^.;\n]{0,30}(?:kaç|seviye)|(?:ons|fiyat)\s+seviye/u.test(
        s,
      )
    )
      return 'spot_threshold' as const;
  };
  return (
    identify(message) ??
    (/peki|hedef|oran|yüzde|%|\d+\s*['’]?\s*(?:e|a|ye|ya)\b/u.test(fold(message))
      ? [...prior]
          .reverse()
          .slice(0, 2)
          .map(identify)
          .find(v => v !== undefined)
      : undefined)
  );
}

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
  if (marginCalculation(message, prior) === 'additional_collateral') return true;
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
  const percentagesIn = (text: string) => {
    const s = fold(text);
    const values = [...s.matchAll(/(?:%|yüzde)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*%/gu)].map(m =>
      Number((m[1] ?? m[2]).replace(',', '.')),
    );
    // Bare numbers are percentages only inside an explicit ratio/target clause.
    for (const m of s.matchAll(
      /(?:oran\p{L}*|hedef(?:\s+oran\p{L}*)?)\s+(\d+(?:[.,]\d+)?)(?![\d.,])(?:\s*['’]?\s*(?:e|a|ye|ya)(?!\p{L})|(?=\s*(?:olsun|olması|olursa|için|$)))/gu,
    ))
      values.push(Number(m[1].replace(',', '.')));
    return [...new Set(values)];
  };
  let percentages = percentagesIn(message);
  if (!percentages.length && /seviye|spot|ons|hedef|ulaş|gelir|peki/u.test(fold(message))) {
    percentages =
      source
        .slice(1)
        .map(percentagesIn)
        .find(p => p.length > 0) ?? [];
  }
  const calculation = marginCalculation(message, prior);
  let target = percentages.length === 1 ? percentages[0] : undefined;
  if (args.targetRatioPct !== undefined) {
    const procedureDefault =
      calculation === 'additional_collateral' &&
      percentages.length === 0 &&
      args.targetRatioPct === RISK_THRESHOLDS.CURE_TARGET * 100;
    if (typeof args.targetRatioPct !== 'number' || (!percentages.includes(args.targetRatioPct) && !procedureDefault))
      throw new Error('Hedef yüzde kullanıcı tarafından belirtilmedi. Hangi zarar/teminat oranını istediğini sor.');
    target = args.targetRatioPct;
  }
  if (percentages.length > 1 && target === undefined)
    throw new Error('Birden fazla yüzde var; hedef zarar/teminat oranını netleştirin.');
  if (target === undefined && calculation === 'additional_collateral') target = RISK_THRESHOLDS.CURE_TARGET * 100;
  if (args.calculation !== undefined && !['spot_threshold', 'additional_collateral'].includes(String(args.calculation)))
    throw new Error('Teminat hesap türü geçersiz.');
  if (args.calculation === 'additional_collateral' && calculation !== 'additional_collateral')
    throw new Error('Ek teminat tutarı mı hedef spot seviyesi mi istendiğini netleştirin.');
  // The user's cash request wins even if the model accidentally selects the spot solver.
  return {
    targetRatioPct: target,
    collateralOverrideUsd: collateral,
    calculation: calculation ?? 'spot_threshold',
    targetIsProcedureDefault: calculation === 'additional_collateral' && percentages.length === 0,
  };
}
