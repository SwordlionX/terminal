import { dbc } from '../db';

const localCounts = new Map<string, number>();
export function configuredLimit(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0 || value > maximum)
    throw new Error('Asistan kullanım sınırı yapılandırması geçersiz.');
  return value;
}

/** Production counters are shared in Turso, including concurrent/serverless instances. */
async function reserve(key: string, limit: number): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.TURSO_DATABASE_URL) throw new Error('Asistanın ortak kullanım sayacı hazırlanmadı.');
    const result = await (async () => {
      try {
        const db = await dbc();
        return await db.execute({
          sql: `INSERT INTO kv (k, v) VALUES (?, '1')
      ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(kv.v AS INTEGER) + 1 AS TEXT)
      WHERE CAST(kv.v AS INTEGER) < ? RETURNING v`,
          args: [key, limit],
        });
      } catch {
        throw new Error('Asistanın ortak kullanım sayacı okunamadı. Bağlantı düzelene kadar istek durduruldu.');
      }
    })();
    if (!result.rows.length) throw new Error('Asistan kullanım sınırına ulaşıldı. Daha sonra tekrar deneyin.');
  } else {
    if (localCounts.size > 500) localCounts.clear();
    const count = localCounts.get(key) ?? 0;
    if (count >= limit) throw new Error('Asistan kullanım sınırına ulaşıldı. Daha sonra tekrar deneyin.');
    localCounts.set(key, count + 1);
  }
}
export function reserveRequest(): Promise<void> {
  return reserve(
    `assistant:minute:${Math.floor(Date.now() / 60000)}`,
    configuredLimit('ASSISTANT_REQUESTS_PER_MINUTE', 20, 1000),
  );
}
export function reserveModelCall(): Promise<void> {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return reserve(`assistant:calls:${day}`, configuredLimit('ASSISTANT_DAILY_MODEL_CALL_LIMIT', 300, 10000));
}

/** Models that recently hit quota or overload, shared across serverless instances in production. */
const MODEL_BLOCKS_KEY = 'assistant:model-blocks';
let localBlocks: Record<string, number> = {};
export async function readModelBlocks(): Promise<Record<string, number>> {
  if (process.env.NODE_ENV !== 'production' || !process.env.TURSO_DATABASE_URL) return { ...localBlocks };
  try {
    const db = await dbc();
    const result = await db.execute({ sql: 'SELECT v FROM kv WHERE k = ?', args: [MODEL_BLOCKS_KEY] });
    const parsed = result.rows.length ? JSON.parse(String(result.rows[0].v)) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { ...localBlocks };
  }
}
export async function blockModel(model: string, until: number): Promise<void> {
  const now = Date.now();
  const blocks = Object.fromEntries(Object.entries(await readModelBlocks()).filter(([, at]) => at > now));
  blocks[model] = Math.max(blocks[model] ?? 0, until);
  localBlocks = blocks;
  if (process.env.NODE_ENV !== 'production' || !process.env.TURSO_DATABASE_URL) return;
  try {
    const db = await dbc();
    await db.execute({
      sql: 'INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
      args: [MODEL_BLOCKS_KEY, JSON.stringify(blocks)],
    });
  } catch {
    // The in-memory copy still protects this instance; the next request re-reads shared state.
  }
}
