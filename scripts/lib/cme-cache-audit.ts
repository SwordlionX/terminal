import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  assertSessionDate,
  csvRows,
  decodeSettlementPrice,
  nanosISO,
  parseSessionSettlements,
  publicationWindows,
} from '../../src/lib/market/cme-carry';
import { parseOptionDefinitionIndex } from '../../src/lib/market/cme-option-inputs';
import { optionMaturityExclusion } from '../../src/lib/market/cme-option-scope';

interface AuditEntry {
  id: string;
  status: string;
  warningPresent?: boolean;
  sha256?: string;
  dataset: string;
  schema: string;
  symbols: string;
  start: string;
  end: string;
}
const definitionFields = [
  'instrument_id',
  'instrument_class',
  'expiration',
  'strike_price',
  'underlying_id',
  'security_update_action',
];
const statisticFields = [
  'instrument_id',
  'stat_type',
  'price',
  'ts_ref',
  'ts_recv',
  'ts_event',
  'stat_flags',
  'update_action',
];
const encodeRow = (row: Record<string, string>, fields: string[]) => fields.map(f => row[f]).join(',');

/** No env loading, provider client, DB client, locks, ledger updates or file writes. */
export async function auditCmeCache(
  cacheDir: string,
  date: string,
  product: 'XAU' | 'XAG',
  ids: string[],
  evalSec?: number,
) {
  assertSessionDate(date);
  if (!ids.length || ids.length > 20 || ids.some(id => !/^\d+$/.test(id)))
    throw new Error('1–20 sayısal instrument_id gerekli');
  if (product !== 'XAU' && product !== 'XAG') throw new Error('Ürün XAU veya XAG olmalı');
  if (evalSec !== undefined && !Number.isFinite(evalSec)) throw new Error('Değerleme zamanı geçersiz');
  const ledger = JSON.parse(await readFile(path.join(cacheDir, 'budget.json'), 'utf8')) as { requests: AuditEntry[] };
  if (!Array.isArray(ledger.requests)) throw new Error('Önbellek bütçe kaydı geçersiz');
  const opt = product === 'XAU' ? 'OG' : 'SO',
    windows = publicationWindows(date);
  const wanted = new Set(ids),
    definitionRows: Record<string, string>[] = [],
    statisticRows: Record<string, string>[] = [];
  const files: { id: string; schema: string; start: string; end: string; sha256: string }[] = [];
  // Only option-parent files overlapping the session's actual definition/publication windows.
  const entries = ledger.requests
    .filter(e => {
      const window = e.schema === 'definition' ? windows.optionDefinitions : windows.statisticsExtended;
      return (
        e.status === 'complete' &&
        e.dataset === 'GLBX.MDP3' &&
        ['definition', 'statistics'].includes(e.schema) &&
        e.symbols.split(',').some(s => s === `${opt}.OPT` || new RegExp(`^${opt}[1-5]\\.OPT$`).test(s)) &&
        Date.parse(e.start) < Date.parse(window.end) &&
        Date.parse(e.end) > Date.parse(window.start)
      );
    })
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || Date.parse(a.end) - Date.parse(b.end));
  const readIds = new Map<string, string>(),
    seenDefs = new Set<string>(),
    seenStats = new Set<string>();
  for (const entry of entries) {
    if (!/^[a-f0-9]{64}$/.test(entry.id) || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || entry.warningPresent)
      throw new Error('Denetim için güvenilir önbellek kaydı yok');
    if (readIds.has(entry.id)) {
      if (readIds.get(entry.id) !== entry.sha256) throw new Error('Çelişen önbellek checksum kaydı');
      continue;
    }
    const text = await readFile(path.join(cacheDir, entry.id + '.csv'), 'utf8');
    if (createHash('sha256').update(text).digest('hex') !== entry.sha256)
      throw new Error('Denetim önbelleği checksum uyuşmuyor');
    readIds.set(entry.id, entry.sha256!);
    files.push({ id: entry.id, schema: entry.schema, start: entry.start, end: entry.end, sha256: entry.sha256! });
    const fields = entry.schema === 'definition' ? definitionFields : statisticFields;
    for (const row of csvRows(text, fields)) {
      if (!wanted.has(row.instrument_id)) continue;
      if (entry.schema === 'statistics' && (row.stat_type !== '3' || nanosISO(row.ts_ref)?.slice(0, 10) !== date))
        continue;
      const key = JSON.stringify(row),
        seen = entry.schema === 'definition' ? seenDefs : seenStats;
      if (seen.has(key)) continue;
      seen.add(key);
      (entry.schema === 'definition' ? definitionRows : statisticRows).push(row);
    }
  }
  const compareTime = (a: Record<string, string>, b: Record<string, string>) => {
    if (!/^\d+$/.test(a.ts_recv ?? '') || !/^\d+$/.test(b.ts_recv ?? '')) return 0;
    return BigInt(a.ts_recv) < BigInt(b.ts_recv) ? -1 : BigInt(a.ts_recv) > BigInt(b.ts_recv) ? 1 : 0;
  };
  definitionRows.sort(compareTime);
  statisticRows.sort(compareTime);
  const defs = parseOptionDefinitionIndex(
    [definitionFields.join(','), ...definitionRows.map(r => encodeRow(r, definitionFields))].join('\n'),
  );
  const latest = parseSessionSettlements(
    [statisticFields.join(','), ...statisticRows.map(r => encodeRow(r, statisticFields))].join('\n'),
    date,
  );
  return {
    readOnly: true,
    date,
    product,
    evalAt: evalSec === undefined ? null : new Date(evalSec * 1000).toISOString(),
    files,
    // Price amounts/raw CSV are intentionally absent: safe for a bounded diagnostic log.
    instruments: [...wanted].map(instrumentId => {
      const def = defs.options.get(instrumentId),
        stat = latest.get(instrumentId);
      const rows = statisticRows.filter(r => r.instrument_id === instrumentId);
      return {
        instrumentId,
        definition: def
          ? { cls: def.cls, expiryAt: new Date(def.expSec * 1000).toISOString(), underlyingId: def.und }
          : {
              classification: defs.deleted.has(instrumentId)
                ? 'deleted'
                : defs.nonOptions.has(instrumentId)
                  ? 'non_option'
                  : 'unknown',
            },
        maturityExclusion:
          def && evalSec !== undefined ? optionMaturityExclusion(def.expSec, evalSec) : 'not_evaluated',
        latestClearing: stat
          ? {
              flags: stat.flags,
              final: Boolean(stat.flags & 1),
              deleted: stat.deleted,
              priceStatus: stat.priceStatus,
              publishedAtNs: stat.publishedAtNs,
            }
          : null,
        versionCount: rows.length,
        recentVersions: rows.slice(-20).map(r => ({
          flags: Number(r.stat_flags),
          action: r.update_action,
          priceStatus: decodeSettlementPrice(r.price).priceStatus,
          tsRecv: r.ts_recv,
          tsEvent: r.ts_event,
          tsRef: r.ts_ref,
        })),
      };
    }),
  };
}
