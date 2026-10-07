/** Read-only CME futures carry inputs. These are not bank lease or OIS curves. */
export const CURVE_ROOTS = ['GC', 'SI', 'SR1', 'SR3'] as const;
export type CurveRoot = (typeof CURVE_ROOTS)[number];
export interface FutureDefinition {
  instrumentId: string;
  symbol: string;
  root: string;
  instrumentClass: string;
  lastTradeTime: string;
}
export interface Settlement {
  instrumentId: string;
  price: number | null;
  referenceDate: string;
  publishedAt: string;
  eventAt: string;
  flags: number;
  deleted: boolean;
}
export interface CurveNode {
  instrumentId: string;
  symbol: string;
  lastTradeTime: string;
  settlement: number;
  publishedAt: string;
  flags: number;
}
export interface CarrySnapshot {
  version: 1;
  sessionDate: string;
  source: 'Databento GLBX.MDP3';
  status: 'final_futures_inputs';
  pricingReady: false;
  collectedAt: string;
  products: Record<
    CurveRoot,
    {
      nodes: CurveNode[];
      /** SOFR futures only: why this session's funding inputs are unusable (pricing falls back to the latest SOFR session). */
      unavailable?: string;
      missingSettlementIds: string[];
      adjacentNetCarry?: { fromId: string; toId: string; rateAct365Continuous: number }[];
    }
  >;
}

export function csvFields(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      out.push(field);
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('Eksik CSV satırı');
  out.push(field);
  return out;
}

export function nanosISO(value: string): string | null {
  if (!/^\d+$/.test(value) || value === '18446744073709551615') return null;
  const ms = Number(BigInt(value) / BigInt(1000000));
  return ms > 0 && ms < 8640000000000000 ? new Date(ms).toISOString() : null;
}

export function* csvRows(text: string, required: string[]): Generator<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/);
  const header = csvFields(lines[0]);
  if (required.some(key => !header.includes(key))) throw new Error('Databento CSV alanları eksik');
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const values = csvFields(line);
    if (values.length !== header.length) throw new Error('Databento CSV satırı eksik');
    yield Object.fromEntries(header.map((key, i) => [key, values[i]]));
  }
}

export function parseFutureDefinitions(text: string): Map<string, FutureDefinition> {
  const result = new Map<string, FutureDefinition>();
  for (const row of csvRows(text, [
    'instrument_id',
    'raw_symbol',
    'asset',
    'instrument_class',
    'expiration',
    'security_update_action',
  ])) {
    if (row.security_update_action === 'D') {
      result.delete(row.instrument_id);
      continue;
    }
    const expiry = nanosISO(row.expiration);
    if (!expiry) throw new Error(`Kontratın gerçek vadesi eksik: ${row.instrument_id}`);
    result.set(row.instrument_id, {
      instrumentId: row.instrument_id,
      symbol: row.raw_symbol,
      root: row.asset,
      instrumentClass: row.instrument_class,
      lastTradeTime: expiry,
    });
  }
  return result;
}

/** Separate trading/clearing tick records; intraday prices cannot overwrite EOD marks. */
export function parseSessionSettlements(text: string, sessionDate: string): Map<string, Settlement> {
  assertSessionDate(sessionDate);
  const versions = new Map<string, Settlement>();
  for (const row of csvRows(text, [
    'instrument_id',
    'stat_type',
    'price',
    'ts_ref',
    'ts_recv',
    'ts_event',
    'stat_flags',
    'update_action',
  ])) {
    if (row.stat_type !== '3') continue;
    const ref = nanosISO(row.ts_ref),
      recv = nanosISO(row.ts_recv),
      event = nanosISO(row.ts_event);
    if (!ref || !recv || !event) throw new Error('Settlement zaman damgası eksik');
    // TradingReferenceDate is a date label; never convert it to the local timezone.
    if (ref.slice(0, 10) !== sessionDate) continue;
    const flags = Number(row.stat_flags);
    if (!Number.isInteger(flags) || flags < 0 || flags > 15) throw new Error('Settlement bayrakları geçersiz');
    if (flags & 8) continue;
    if (row.update_action !== '1' && row.update_action !== '2') throw new Error('Settlement güncelleme türü geçersiz');
    const raw = Number(row.price);
    const price = Number.isFinite(raw) && raw > 0 && raw < 9e18 ? raw / 1e9 : null;
    const item: Settlement = {
      instrumentId: row.instrument_id,
      price,
      referenceDate: sessionDate,
      publishedAt: recv,
      eventAt: event,
      flags,
      deleted: row.update_action === '2',
    };
    const key = `${row.instrument_id}:${flags & 4}`;
    const previous = versions.get(key);
    if (previous && previous.publishedAt > recv) continue;
    // Preserve invalid latest updates/deletions, so an earlier valid quote cannot reappear.
    versions.set(key, item);
  }
  const result = new Map<string, Settlement>();
  for (const item of versions.values()) {
    // Require the clearing-tick version; a trading-tick price isn't silently substituted.
    if (!(item.flags & 4)) result.set(item.instrumentId, item);
  }
  return result;
}

export function assertSessionDate(date: string): void {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date)
    throw new Error('Seans tarihi YYYY-MM-DD olmalı');
  const day = new Date(ms).getUTCDay();
  if (day === 0 || day === 6) throw new Error('Hafta sonu settlement seansı değil');
}

/**
 * Final settlements normally arrive together the same evening (1 Oct 2026: 23:34–23:38 UTC for
 * GC/SI/SR1/SR3 and the metal options). The standard window closes at 04:00 UTC the next day,
 * covering CDT/CST; a late or weekend-delayed publication is picked up by the extended window,
 * which closes at 16:00 UTC on the next business day.
 */
export function publicationWindows(date: string) {
  assertSessionDate(date);
  const start = Date.parse(`${date}T00:00:00Z`);
  const nextBusiness = start + (new Date(start).getUTCDay() === 5 ? 3 : 1) * 86400000;
  return {
    definitions: { start: `${date}T00:00:00Z`, end: `${date}T00:15:00Z` },
    // A midnight snapshot alone misses new option strikes listed during the session.
    optionDefinitions: { start: `${date}T00:00:00Z`, end: new Date(start + 86400000).toISOString().replace('.000Z', 'Z') },
    statistics: { start: `${date}T17:00:00Z`, end: new Date(start + 86400000 + 4 * 3600000).toISOString() },
    statisticsExtended: { start: `${date}T17:00:00Z`, end: new Date(nextBusiness + 16 * 3600000).toISOString() },
  };
}

export function buildCarrySnapshot(
  date: string,
  definitions: Map<string, FutureDefinition>,
  settlements: Map<string, Settlement>,
  collectedAt: string,
): CarrySnapshot {
  assertSessionDate(date);
  for (const id of settlements.keys()) {
    if (!definitions.has(id)) throw new Error(`Settlement kontrat tanımı eksik: ${id}`);
  }
  const products = {} as CarrySnapshot['products'];
  for (const root of CURVE_ROOTS) {
    try {
      buildRoot(root);
    } catch (error) {
      // Options matter most: missing SOFR finals never block the metal snapshot.
      if (root !== 'SR1' && root !== 'SR3') throw error;
      products[root] = {
        nodes: [],
        missingSettlementIds: [],
        unavailable: error instanceof Error ? error.message : 'SOFR final settlement yok',
      };
    }
  }
  function buildRoot(root: (typeof CURVE_ROOTS)[number]) {
    const defs = [...definitions.values()].filter(
      d => d.root === root && d.instrumentClass === 'F' && d.lastTradeTime.slice(0, 10) > date,
    );
    const nodes: CurveNode[] = [],
      missingSettlementIds: string[] = [];
    for (const def of defs) {
      const stat = settlements.get(def.instrumentId);
      // MDP does not publish a settlement for every listed/no-volume/no-OI instrument.
      if (!stat) {
        missingSettlementIds.push(def.instrumentId);
        continue;
      }
      if (
        stat.referenceDate !== date ||
        stat.deleted ||
        stat.price == null ||
        !Number.isFinite(stat.price) ||
        stat.price <= 0 ||
        !(stat.flags & 1) ||
        stat.flags & 12
      )
        throw new Error(`${root} ${def.symbol}: aynı seansa ait final settlement yok`);
      nodes.push({
        instrumentId: def.instrumentId,
        symbol: def.symbol,
        lastTradeTime: def.lastTradeTime,
        settlement: stat.price,
        publishedAt: stat.publishedAt,
        flags: stat.flags,
      });
    }
    const min = root === 'SR1' ? 6 : 10;
    if (nodes.length < min) throw new Error(`${root}: yetersiz final kontrat (${nodes.length}/${min})`);
    nodes.sort(
      (a, b) => a.lastTradeTime.localeCompare(b.lastTradeTime) || a.instrumentId.localeCompare(b.instrumentId),
    );
    products[root] = { nodes, missingSettlementIds };
    if (root === 'GC' || root === 'SI') {
      products[root].adjacentNetCarry = nodes.slice(1).flatMap((b, i) => {
        const a = nodes[i],
          years = (Date.parse(b.lastTradeTime) - Date.parse(a.lastTradeTime)) / (365 * 86400000);
        if (years === 0) {
          if (a.settlement !== b.settlement) throw new Error(`${root}: aynı vadede çelişen futures fiyatı`);
          return [];
        }
        return [
          {
            fromId: a.instrumentId,
            toId: b.instrumentId,
            rateAct365Continuous: Math.log(b.settlement / a.settlement) / years,
          },
        ];
      });
    }
  }
  return {
    version: 1,
    sessionDate: date,
    source: 'Databento GLBX.MDP3',
    status: 'final_futures_inputs',
    pricingReady: false,
    collectedAt,
    products,
  };
}

/** Interpolation is only a futures proxy; no extrapolation or spot/lease inference. */
export function interpolateFuturesPrice(nodes: CurveNode[], targetTime: string): number | null {
  const t = Date.parse(targetTime);
  if (!Number.isFinite(t) || nodes.length < 2) return null;
  const sorted = [...nodes].sort((a, b) => a.lastTradeTime.localeCompare(b.lastTradeTime));
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i],
      ta = Date.parse(a.lastTradeTime);
    if (t === ta) return a.settlement;
    const b = sorted[i + 1];
    if (!b) continue;
    const tb = Date.parse(b.lastTradeTime);
    if (ta < t && t < tb)
      return Math.exp(Math.log(a.settlement) + ((t - ta) / (tb - ta)) * Math.log(b.settlement / a.settlement));
  }
  return null;
}
