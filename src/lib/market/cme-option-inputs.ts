import { csvRows, nanosISO, parseSessionSettlements } from './cme-carry';
import type { CmeOptionDef } from '../vol/cme';

/** Replay the full session's option definitions, including intraday additions and revisions. */
export function parseOptionDefinitions(text: string): Map<string, CmeOptionDef> {
  const options = new Map<string, CmeOptionDef>();
  for (const row of csvRows(text, ['instrument_id', 'instrument_class', 'expiration', 'strike_price', 'underlying_id', 'security_update_action'])) {
    if (row.security_update_action === 'D') {
      options.delete(row.instrument_id);
      continue;
    }
    if (row.instrument_class !== 'C' && row.instrument_class !== 'P') continue;
    const expiry = nanosISO(row.expiration), strike = Number(row.strike_price) / 1e9;
    if (!expiry || !Number.isFinite(strike) || strike <= 0 || strike >= 9e9)
      throw new Error(`Opsiyon tanımı geçersiz: instrument_id=${row.instrument_id}`);
    options.set(row.instrument_id, { cls: row.instrument_class, expSec: Date.parse(expiry) / 1000, strike, und: row.underlying_id });
  }
  return options;
}

/** Never skip an unknown settlement or substitute a preliminary/deleted price. */
export function finalOptionSettlements(text: string, sessionDate: string, options: Map<string, CmeOptionDef>, product: 'XAU' | 'XAG'): Map<string, number> {
  const settlements = parseSessionSettlements(text, sessionDate);
  const missing = [...settlements.keys()].filter(id => !options.has(id));
  if (missing.length)
    throw new Error(`${product} ${sessionDate}: Final opsiyon settlement için tanım eksik; adet=${missing.length}, instrument_id=${missing.slice(0, 12).join(',')}${missing.length > 12 ? ',…' : ''}.`);
  const result = new Map<string, number>();
  for (const [id, stat] of settlements) {
    if (!(stat.flags & 1) || stat.deleted || stat.price == null)
      throw new Error(`${product} ${sessionDate}: Opsiyon settlement final değil veya geçersiz; instrument_id=${id}.`);
    result.set(id, stat.price);
  }
  if (!result.size) throw new Error(`${product} ${sessionDate}: Final opsiyon settlement yok.`);
  return result;
}
