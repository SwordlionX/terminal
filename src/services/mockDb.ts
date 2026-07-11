import { Customer, Trade, Portfolio, CustomerTimelineEvent } from '../types';
import { dbc } from '@/lib/db';
import type { Row } from '@libsql/client';

/**
 * Veri erişim katmanı — Turso/libSQL üzerinde çalışır.
 * (Dosya adı geçmişten geliyor; API aynı kaldığı için sayfalar değişmedi.)
 */

function rowToCustomer(r: Row): Customer {
  return {
    id: String(r.id),
    companyName: String(r.companyName),
    customerNumber: String(r.customerNumber ?? ''),
    taxNumber: String(r.taxNumber ?? ''),
    branch: String(r.branch ?? ''),
    portfolioManager: String(r.portfolioManager ?? ''),
    relationshipManager: String(r.relationshipManager ?? ''),
    customerSegment: String(r.customerSegment ?? ''),
    notes: String(r.notes ?? ''),
    createdDate: String(r.createdDate ?? ''),
    updatedDate: String(r.updatedDate ?? ''),
    status: (r.status === 'Passive' ? 'Passive' : 'Active'),
  };
}

function rowToTrade(r: Row): Trade {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: String(r.id),
    customerId: String(r.customerId),
    tradeDate: String(r.tradeDate ?? ''),
    expiryDate: String(r.expiryDate ?? ''),
    underlying: String(r.underlying ?? ''),
    type: (r.type === 'Put' ? 'Put' : 'Call'),
    position: (r.position === 'Short' ? 'Short' : 'Long'),
    spot: Number(r.spot ?? 0),
    strike: Number(r.strike ?? 0),
    volatility: Number(r.volatility ?? 0),
    contractSize: Number(r.contractSize ?? 0),
    premium: Number(r.premium ?? 0),
    currentPremium: num(r.currentPremium),
    mtm: num(r.mtm),
    pnl: num(r.pnl),
    delta: num(r.delta),
    gamma: num(r.gamma),
    vega: num(r.vega),
    theta: num(r.theta),
    marginRate: r.marginRate == null ? undefined : Number(r.marginRate),
    status: (['Open', 'Near Expiry', 'Expired', 'Closed'].includes(String(r.status)) ? String(r.status) : 'Open') as Trade['status'],
    barrierType: r.barrierType == null ? undefined : String(r.barrierType),
    barrierLevel: r.barrierLevel == null ? undefined : Number(r.barrierLevel),
    barrierStyle: r.barrierStyle == null ? undefined : String(r.barrierStyle),
    barrierStartDate: r.barrierStartDate == null ? undefined : String(r.barrierStartDate),
    barrierEndDate: r.barrierEndDate == null ? undefined : String(r.barrierEndDate),
  };
}

export const db = {
  customers: {
    findMany: async (): Promise<Customer[]> => {
      const c = await dbc();
      const r = await c.execute('SELECT * FROM customers ORDER BY companyName');
      return r.rows.map(rowToCustomer);
    },
    findById: async (id: string): Promise<Customer | null> => {
      const c = await dbc();
      const r = await c.execute({ sql: 'SELECT * FROM customers WHERE id = ?', args: [id] });
      return r.rows.length ? rowToCustomer(r.rows[0]) : null;
    },
    create: async (data: Omit<Customer, 'id' | 'createdDate' | 'updatedDate'>): Promise<Customer> => {
      const c = await dbc();
      const now = new Date().toISOString();
      const cust: Customer = { ...data, id: 'c' + Date.now(), createdDate: now, updatedDate: now };
      await c.execute({
        sql: 'INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        args: [cust.id, cust.companyName, cust.customerNumber, cust.taxNumber, cust.branch,
               cust.portfolioManager, cust.relationshipManager, null /* riskLimit (kaldırıldı, kolon legacy) */, cust.customerSegment,
               cust.notes, cust.createdDate, cust.updatedDate, cust.status],
      });
      return cust;
    },
    delete: async (id: string): Promise<void> => {
      const c = await dbc();
      await c.batch([
        { sql: 'DELETE FROM trades WHERE customerId = ?', args: [id] },
        { sql: 'DELETE FROM collaterals WHERE customerId = ?', args: [id] },
        { sql: 'DELETE FROM activity_log WHERE customerId = ?', args: [id] },
        { sql: 'DELETE FROM customers WHERE id = ?', args: [id] },
      ], 'write');
    },
  },
  trades: {
    findMany: async (): Promise<Trade[]> => {
      const c = await dbc();
      const r = await c.execute('SELECT * FROM trades ORDER BY tradeDate DESC');
      return r.rows.map(rowToTrade);
    },
    findByCustomerId: async (customerId: string): Promise<Trade[]> => {
      const c = await dbc();
      const r = await c.execute({ sql: 'SELECT * FROM trades WHERE customerId = ? ORDER BY tradeDate DESC', args: [customerId] });
      return r.rows.map(rowToTrade);
    },
    create: async (data: Omit<Trade, 'id'>): Promise<Trade> => {
      const c = await dbc();
      const t: Trade = { ...data, id: 't' + Date.now() };
      await c.execute({
        sql: 'INSERT INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        args: [t.id, t.customerId, t.tradeDate, t.expiryDate, t.underlying, t.type, t.position,
               t.spot, t.strike, t.volatility, t.contractSize, t.premium, t.currentPremium,
               t.mtm, t.pnl, t.delta, t.gamma, t.vega, t.theta, t.marginRate ?? null, t.status,
               t.barrierType ?? null, t.barrierLevel ?? null, t.barrierStyle ?? null,
               t.barrierStartDate ?? null, t.barrierEndDate ?? null],
      });
      return t;
    },
    update: async (id: string, data: Partial<Trade>): Promise<Trade | null> => {
      const c = await dbc();
      const fields = Object.keys(data).filter(k => k !== 'id');
      if (fields.length === 0) return null;
      const sets = fields.map(f => `${f} = ?`).join(', ');
      const args = [...fields.map(f => (data as Record<string, unknown>)[f] as string | number | null), id];
      await c.execute({ sql: `UPDATE trades SET ${sets} WHERE id = ?`, args });
      const r = await c.execute({ sql: 'SELECT * FROM trades WHERE id = ?', args: [id] });
      return r.rows.length ? rowToTrade(r.rows[0]) : null;
    },
    delete: async (id: string): Promise<void> => {
      const c = await dbc();
      await c.execute({ sql: 'DELETE FROM trades WHERE id = ?', args: [id] });
    },
  },
  portfolio: {
    findByCustomerId: async (customerId: string): Promise<Portfolio> => {
      const c = await dbc();
      const r = await c.execute({
        sql: "SELECT COUNT(*) AS n FROM trades WHERE customerId = ? AND status IN ('Open','Near Expiry')",
        args: [customerId],
      });
      return {
        customerId,
        totalOpenPositions: Number(r.rows[0].n),
        usdNotional: null, currentMtm: null, totalProfit: null, totalLoss: null,
        requiredMargin: null, availableMargin: null, excessMargin: null, missingMargin: null,
        marginUtilization: null, delta: null, gamma: null, vega: null, theta: null,
        riskLevel: null,
      };
    },
  },
  activity: {
    // Gerçek aktivite kaydı — best-effort (log hatası ana işlemi asla bozmaz).
    log: async (customerId: string, type: CustomerTimelineEvent['type'], description: string): Promise<void> => {
      try {
        const c = await dbc();
        const id = `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await c.execute({
          sql: 'INSERT INTO activity_log VALUES (?,?,?,?,?)',
          args: [id, customerId, new Date().toISOString(), type, description],
        });
      } catch { /* aktivite logu kritik değil */ }
    },
    findByCustomerId: async (customerId: string): Promise<CustomerTimelineEvent[]> => {
      const c = await dbc();
      const r = await c.execute({
        sql: 'SELECT * FROM activity_log WHERE customerId = ? ORDER BY date DESC LIMIT 50',
        args: [customerId],
      });
      return r.rows.map((row) => ({
        id: String(row.id),
        customerId: String(row.customerId),
        date: String(row.date ?? ''),
        type: String(row.type ?? 'Other') as CustomerTimelineEvent['type'],
        description: String(row.description ?? ''),
      }));
    },
  },
};
