import { createClient } from '@libsql/client';

/** Last outcome of the scheduled CME/SOFR refresh, shown on the settings and curves screens. */
export interface RefreshStatus {
  at: string;
  stage: 'collect' | 'bundle';
  result: 'updated' | 'up_to_date' | 'waiting' | 'failed';
  sessionDate?: string;
  sofrSession?: string;
  message: string;
}

export const REFRESH_STATUS_KEY = 'pricing_refresh_status';

export async function writeRefreshStatus(status: Omit<RefreshStatus, 'at'>): Promise<void> {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) return;
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    await db.execute({
      sql: 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
      args: [REFRESH_STATUS_KEY, JSON.stringify({ at: new Date().toISOString(), ...status })],
    });
  } catch {
    // Status is informational; the refresh result itself is already committed or rejected.
  } finally {
    db.close();
  }
}
