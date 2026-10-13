import { csvRows, nanosISO, parseSessionSettlements } from './cme-carry';
import type { CmeOptionDef } from '../vol/cme';

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

/** Never skip an unknown settlement or substitute a preliminary/deleted price. */
export function finalOptionSettlements(
  text: string,
  sessionDate: string,
  options: Map<string, CmeOptionDef>,
  product: 'XAU' | 'XAG',
  index?: Pick<OptionDefinitionIndex, 'nonOptions' | 'deleted'>,
): Map<string, number> {
  const settlements = parseSessionSettlements(text, sessionDate);
  const missing = [...settlements.keys()].filter(id => !options.has(id) && !index?.nonOptions.has(id));
  if (missing.length)
    throw new Error(
      `${product} ${sessionDate}: Final opsiyon settlement için tanım eksik; adet=${missing.length}, instrument_id=${missing.slice(0, 12).join(',')}${missing.length > 12 ? ',…' : ''}.${index ? ` Silinmiş tanım=${missing.filter(id => index.deleted.has(id)).length}; tanımlarda bulunmayan/uygunsuz sınıf=${missing.filter(id => !index.deleted.has(id)).length}.` : ''}`,
    );
  const result = new Map<string, number>();
  for (const [id, stat] of settlements) {
    if (!options.has(id) && index?.nonOptions.has(id)) continue;
    if (!(stat.flags & 1) || stat.deleted || stat.price == null)
      throw new Error(`${product} ${sessionDate}: Opsiyon settlement final değil veya geçersiz; instrument_id=${id}.`);
    result.set(id, stat.price);
  }
  if (!result.size) throw new Error(`${product} ${sessionDate}: Final opsiyon settlement yok.`);
  return result;
}
