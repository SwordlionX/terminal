import { csvRows, nanosISO, parseSessionSettlements } from './cme-carry';
import type { CmeOptionDef } from '../vol/cme';
import { optionMaturityExclusion } from './cme-option-scope';

export interface OptionDefinitionIndex {
  options: Map<string, CmeOptionDef>;
  /** Positively identified non-option instruments; never a catch-all for unknown IDs. */
  nonOptions: Set<string>;
  deleted: Set<string>;
}

/** Replay the full session, preserving the distinction between outrights, spreads and deletes. */
export function parseOptionDefinitionIndex(text: string): OptionDefinitionIndex {
  const options = new Map<string, CmeOptionDef>();
  const nonOptions = new Set<string>(),
    deleted = new Set<string>();
  for (const row of csvRows(text, [
    'instrument_id',
    'instrument_class',
    'expiration',
    'strike_price',
    'underlying_id',
    'security_update_action',
  ])) {
    if (row.security_update_action === 'D') {
      options.delete(row.instrument_id);
      nonOptions.delete(row.instrument_id);
      deleted.add(row.instrument_id);
      continue;
    }
    deleted.delete(row.instrument_id);
    if (row.instrument_class !== 'C' && row.instrument_class !== 'P') {
      options.delete(row.instrument_id);
      // Option parents also include futures and multi-leg strategies (T/M/S). Only documented
      // non-option classes may be excluded; an absent/unknown definition still stops activation.
      if (['B', 'F', 'K', 'M', 'S', 'T', 'X', 'Y', 'I'].includes(row.instrument_class))
        nonOptions.add(row.instrument_id);
      else nonOptions.delete(row.instrument_id);
      continue;
    }
    nonOptions.delete(row.instrument_id);
    const expiry = nanosISO(row.expiration),
      strike = Number(row.strike_price) / 1e9;
    if (!expiry || !Number.isFinite(strike) || strike <= 0 || strike >= 9e9)
      throw new Error(`Opsiyon tanımı geçersiz: instrument_id=${row.instrument_id}`);
    options.set(row.instrument_id, {
      cls: row.instrument_class,
      expSec: Date.parse(expiry) / 1000,
      strike,
      und: row.underlying_id,
    });
  }
  return { options, nonOptions, deleted };
}

/** Compatibility helper for callers interested only in outright option terms. */
export function parseOptionDefinitions(text: string): Map<string, CmeOptionDef> {
  return parseOptionDefinitionIndex(text).options;
}

export type OptionSettlementReason = 'preliminary' | 'deleted' | 'invalid_price';
export interface OptionSettlementIssue {
  instrumentId: string;
  reasons: OptionSettlementReason[];
  flags: number;
  priceStatus: string;
  publishedAt: string;
  expiryAt: string;
}
export interface OptionSettlementReport {
  settlements: Map<string, number>;
  missingIds: string[];
  issues: OptionSettlementIssue[];
  excluded: { nonOptions: number; short_or_expired: number; beyond_horizon: number };
}

/** Audit all failures before throwing; never infer scope for an unknown/deleted definition. */
export function inspectOptionSettlements(
  text: string,
  sessionDate: string,
  options: Map<string, CmeOptionDef>,
  index?: Pick<OptionDefinitionIndex, 'nonOptions' | 'deleted'>,
  scope?: { evalSec: number },
): OptionSettlementReport {
  if (scope && !Number.isFinite(scope.evalSec)) throw new Error('Opsiyon değerleme zamanı geçersiz');
  const rows = parseSessionSettlements(text, sessionDate);
  const report: OptionSettlementReport = {
    settlements: new Map(),
    missingIds: [],
    issues: [],
    excluded: { nonOptions: 0, short_or_expired: 0, beyond_horizon: 0 },
  };
  for (const [id, stat] of rows) {
    const def = options.get(id);
    if (!def) {
      if (index?.nonOptions.has(id)) report.excluded.nonOptions++;
      else report.missingIds.push(id);
      continue;
    }
    const excluded = scope ? optionMaturityExclusion(def.expSec, scope.evalSec) : null;
    if (excluded) {
      report.excluded[excluded]++;
      continue;
    }
    const reasons: OptionSettlementReason[] = [];
    if (!(stat.flags & 1)) reasons.push('preliminary');
    if (stat.deleted) reasons.push('deleted');
    if (stat.price == null) reasons.push('invalid_price');
    if (reasons.length)
      report.issues.push({
        instrumentId: id,
        reasons,
        flags: stat.flags,
        priceStatus: stat.priceStatus ?? (stat.price == null ? 'missing' : stat.price === 0 ? 'zero' : 'positive'),
        publishedAt: stat.publishedAt,
        expiryAt: new Date(def.expSec * 1000).toISOString(),
      });
    else report.settlements.set(id, stat.price!);
  }
  return report;
}

export class OptionSettlementError extends Error {
  constructor(
    message: string,
    readonly waitingForFinal: boolean,
    readonly diagnostics: {
      issueCount: number;
      reasonCounts: Record<OptionSettlementReason, number>;
      samples: OptionSettlementIssue[];
    },
  ) {
    super(message);
    this.name = 'OptionSettlementError';
  }
}

/** Never skip an unknown settlement or substitute a preliminary/deleted price. */
export function finalOptionSettlements(
  text: string,
  sessionDate: string,
  options: Map<string, CmeOptionDef>,
  product: 'XAU' | 'XAG',
  index?: Pick<OptionDefinitionIndex, 'nonOptions' | 'deleted'>,
  scope?: { evalSec: number; onExcluded?: (counts: OptionSettlementReport['excluded']) => void },
): Map<string, number> {
  const report = inspectOptionSettlements(text, sessionDate, options, index, scope);
  const missing = report.missingIds;
  scope?.onExcluded?.(report.excluded);
  if (missing.length)
    throw new Error(
      `${product} ${sessionDate}: Final opsiyon settlement için tanım eksik; adet=${missing.length}, instrument_id=${missing.slice(0, 12).join(',')}${missing.length > 12 ? ',…' : ''}.${index ? ` Silinmiş tanım=${missing.filter(id => index.deleted.has(id)).length}; tanımlarda bulunmayan/uygunsuz sınıf=${missing.filter(id => !index.deleted.has(id)).length}.` : ''}`,
    );
  if (report.issues.length) {
    const reasonCounts = { preliminary: 0, deleted: 0, invalid_price: 0 };
    for (const issue of report.issues) for (const reason of issue.reasons) reasonCounts[reason]++;
    const samples = report.issues.slice(0, 12);
    const details = samples
      .map(
        s =>
          `instrument_id=${s.instrumentId}, neden=${s.reasons.join('+')}, flags=${s.flags}, priceStatus=${s.priceStatus}, expiry=${s.expiryAt}, published=${s.publishedAt}`,
      )
      .join('; ');
    throw new OptionSettlementError(
      `${product} ${sessionDate}: Opsiyon settlement final değil veya geçersiz; adet=${report.issues.length}; ${details}.`,
      reasonCounts.deleted === 0 && reasonCounts.invalid_price === 0,
      { issueCount: report.issues.length, reasonCounts, samples },
    );
  }
  if (!report.settlements.size)
    throw new OptionSettlementError(`${product} ${sessionDate}: Final opsiyon settlement yok.`, true, {
      issueCount: 0,
      reasonCounts: { preliminary: 0, deleted: 0, invalid_price: 0 },
      samples: [],
    });
  return report.settlements;
}
