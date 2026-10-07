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
  for (let at = start; at < end; at += 3600000) {
    const slice = {
      ...args,
      start: new Date(at).toISOString().replace('.000Z', 'Z'),
      end: new Date(Math.min(at + 3600000, end)).toISOString().replace('.000Z', 'Z'),
    };
    let result;
    try {
      result = await cache.download(slice);
    } catch (error) {
      throw new Error(
        `Databento ${args.schema} ${slice.start}–${slice.end}: ${error instanceof Error ? error.message : String(error)}`,
      );
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
  const text = [header!, ...parts].join('\n') + '\n';
  return { text, sha256: createHash('sha256').update(text).digest('hex'), cached };
}
