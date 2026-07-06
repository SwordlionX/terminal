import { createClient, Client } from '@libsql/client';
import fs from 'fs';

/**
 * Veritabanı istemcisi — Turso (bulut, Vercel için) veya yerel dosya (geliştirme).
 * Vercel'de env değişkenleri: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
 * Yerelde env yoksa otomatik olarak file:data/local.db kullanılır.
 */

let client: Client | null = null;
let readyPromise: Promise<void> | null = null;

function getClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL || 'file:data/local.db';
    if (url.startsWith('file:')) {
      try { fs.mkdirSync('data', { recursive: true }); } catch { /* salt-okunur FS */ }
    }
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return client;
}

async function init(c: Client): Promise<void> {
  await c.batch([
    `CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, companyName TEXT NOT NULL, customerNumber TEXT, taxNumber TEXT,
      branch TEXT, portfolioManager TEXT, relationshipManager TEXT, riskLimit REAL,
      customerSegment TEXT, notes TEXT, createdDate TEXT, updatedDate TEXT, status TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY, customerId TEXT NOT NULL, tradeDate TEXT, expiryDate TEXT,
      underlying TEXT, type TEXT, position TEXT, spot REAL, strike REAL, volatility REAL,
      contractSize REAL, premium REAL, currentPremium REAL, mtm REAL, pnl REAL,
      delta REAL, gamma REAL, vega REAL, theta REAL, status TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS collaterals (
      id TEXT PRIMARY KEY, customerId TEXT NOT NULL, assetCode TEXT, currency TEXT,
      nominalQuantity REAL, marketValueUsd REAL, addedAt TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`,
  ], 'write');

  // İlk kurulumda örnek müşteri + teminat ekle
  const r = await c.execute('SELECT COUNT(*) AS n FROM customers');
  if (Number(r.rows[0].n) === 0) {
    const now = new Date().toISOString();
    await c.batch([
      {
        sql: `INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: ['c1', 'Customer A', 'CUST-001', '1111111111', 'Merkez', 'PM User 1', 'RM User 1', null, 'Kurumsal', 'Initial customer for layout testing.', now, now, 'Active'],
      },
      {
        sql: `INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: ['c2', 'Customer B', 'CUST-002', '2222222222', 'Şube 1', 'PM User 2', 'RM User 2', null, 'Ticari', '', now, now, 'Active'],
      },
      {
        sql: `INSERT INTO collaterals VALUES (?,?,?,?,?,?,?)`,
        args: ['col-1', 'c1', 'Nakit-USD', 'USD', 500000, 500000, now],
      },
      {
        sql: `INSERT INTO collaterals VALUES (?,?,?,?,?,?,?)`,
        args: ['col-2', 'c1', 'IDL-LKT-MPF', 'TRY', 1000000, 28500, now],
      },
    ], 'write');
  }
}

/** Şeması hazır veritabanı istemcisi döndürür. */
export async function dbc(): Promise<Client> {
  const c = getClient();
  if (!readyPromise) readyPromise = init(c);
  await readyPromise;
  return c;
}
