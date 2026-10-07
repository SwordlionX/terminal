import { createHash } from 'node:crypto';
import type { DatabentoCache, DownloadArgs } from './databento-cache';

/** Reuse complete legacy downloads; otherwise cover the same range with bounded requests. */
export async function downloadWindowed(cache: Pick<DatabentoCache, 'download'>, args: DownloadArgs) {
  try {
    return await cache.download(args, true);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'İstenen veri önbellekte yok; ağ indirmesi kapalı') throw error;
  }
  const start = Date.parse(args.start),
    end = Date.parse(args.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new Error('Databento indirme aralığı geçersiz');
  let header: string | undefined,
    cached = true;
  const parts: string[] = [];
  async function readSlice(at: number, until: number): Promise<void> {
    const slice = {
      ...args,
      start: new Date(at).toISOString().replace('.000Z', 'Z'),
      end: new Date(until).toISOString().replace('.000Z', 'Z'),
    };
    let result;
    try {
      result = await cache.download(slice);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Retry only transient transport failures with smaller ranges, down to 15 minutes.
      // Budget, partial-symbol warnings and corrupt cached data must never be bypassed.
      if (until - at > 900000 && /HTTP (429|5\d\d)|timeout|aborted|ECONNRESET|fetch failed/i.test(message)) {
        const middle = at + Math.floor((until - at) / 2);
        await readSlice(at, middle);
        await readSlice(middle, until);
        return;
      }
      throw new Error(`Databento ${args.schema} ${slice.start}–${slice.end}: ${message}`);
    }
    const text = result.text.trim(),
      newline = text.indexOf('\n');
    const nextHeader = (newline < 0 ? text : text.slice(0, newline)).trim();
    if (!nextHeader || (header !== undefined && nextHeader !== header))
      throw new Error('Databento parça CSV alanları uyuşmuyor');
    header = nextHeader;
    if (newline >= 0 && text.slice(newline + 1)) parts.push(text.slice(newline + 1));
    cached &&= result.cached;
  }
  for (let at = start; at < end; at += 3600000) await readSlice(at, Math.min(at + 3600000, end));
  const text = [header!, ...parts].join('\n') + '\n';
  return { text, sha256: createHash('sha256').update(text).digest('hex'), cached };
}
