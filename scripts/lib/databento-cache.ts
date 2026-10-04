import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const HIST = 'https://hist.databento.com/v0/';
export interface DownloadArgs {
  dataset: string; start: string; end: string; stype_in: 'parent'; symbols: string; schema: 'definition' | 'statistics';
}
interface Entry extends DownloadArgs {
  id: string; estimateUsd: number; reserveUsd: number; status: 'reserved' | 'complete';
  requestedAt: string; sha256?: string; bytes?: number; warningPresent?: boolean;
}
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export class DatabentoCache {
  readonly cacheDir = process.env.DATABENTO_CACHE_DIR || (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Terminal-X', 'databento-audit')
    : path.join(homedir(), '.cache', 'terminal-x', 'databento-audit'));
  newEstimateUsd = 0;
  newReserveUsd = 0;
  downloads = 0;
  constructor(private cacheOnly: boolean) {}

  private headers() {
    const key = process.env.DATABENTO_API_KEY;
    if (!key) throw new Error('DATABENTO_API_KEY tanımlı değil');
    return { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') };
  }
  private url(method: string, args: Record<string, string>) {
    const url = new URL(method, HIST); url.search = new URLSearchParams(args).toString(); return url;
  }
  async availableEnd(): Promise<string> {
    const res = await fetch(this.url('metadata.get_dataset_range', { dataset: 'GLBX.MDP3' }), { headers: this.headers(), signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Databento metadata HTTP ${res.status}`);
    const range = await res.json(), end = range.schema?.statistics?.end || range.end;
    if (typeof end !== 'string' || !Number.isFinite(Date.parse(end))) throw new Error('Databento veri sonu okunamadı');
    return end;
  }
  async download(args: DownloadArgs): Promise<{ text: string; sha256: string; cached: boolean }> {
    await mkdir(this.cacheDir, { recursive: true });
    const lockPath = path.join(this.cacheDir, 'budget.lock');
    const lock = await open(lockPath, 'wx'); // Fail rather than race another paid download.
    try {
      const ledgerPath = path.join(this.cacheDir, 'budget.json');
      let ledger: { limitUsd: number; requests: Entry[] };
      try { ledger = JSON.parse(await readFile(ledgerPath, 'utf8')); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; ledger = { limitUsd: 10, requests: [] }; }
      if (ledger.limitUsd !== 10 || !Array.isArray(ledger.requests) || ledger.requests.some(x => !Number.isFinite(x.reserveUsd) || x.reserveUsd < 0))
        throw new Error('Bütçe kaydı geçersiz');
      const id = sha(JSON.stringify(args)), target = path.join(this.cacheDir, id + '.csv');
      const existing = ledger.requests.find(x => x.id === id);
      if (existing) {
        if (existing.status !== 'complete') throw new Error('Önceki indirme yarım; otomatik ücretli tekrar yapılmadı');
        const text = await readFile(target, 'utf8');
        if (sha(text) !== existing.sha256 || existing.warningPresent) throw new Error('Önbellek doğrulanamadı');
        return { text, sha256: existing.sha256!, cached: true };
      }
      if (this.cacheOnly) throw new Error('İstenen veri önbellekte yok; ağ indirmesi kapalı');
      const cost = await fetch(this.url('metadata.get_cost', { ...args }), { headers: this.headers(), signal: AbortSignal.timeout(30000) });
      if (!cost.ok) throw new Error(`Databento maliyet HTTP ${cost.status}`);
      const estimateUsd: unknown = await cost.json();
      if (typeof estimateUsd !== 'number' || !Number.isFinite(estimateUsd) || estimateUsd < 0) throw new Error('Maliyet tahmini geçersiz');
      const reserveUsd = 2 * estimateUsd + 0.01;
      if (this.newReserveUsd + reserveUsd > 0.25 || ledger.requests.reduce((s, x) => s + x.reserveUsd, 0) + reserveUsd > 10)
        throw new Error('İndirme bütçeyi aşacak (çalışma $0.25 / yerel toplam $10)');
      const entry: Entry = { id, ...args, estimateUsd, reserveUsd, status: 'reserved', requestedAt: new Date().toISOString() };
      ledger.requests.push(entry); this.newReserveUsd += reserveUsd;
      const save = async () => {
        await writeFile(ledgerPath + '.tmp', JSON.stringify(ledger, null, 2)); await rename(ledgerPath + '.tmp', ledgerPath);
      };
      await save(); // Keep reservation even if streaming fails; never retry paid requests automatically.
      const res = await fetch(this.url('timeseries.get_range', { ...args, encoding: 'csv', pretty_px: 'false', pretty_ts: 'false' }), {
        headers: this.headers(), signal: AbortSignal.timeout(180000),
      });
      if (!res.ok || !res.body) throw new Error(`Databento indirme HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(target + '.partial'));
      await rename(target + '.partial', target);
      const buffer = await readFile(target);
      entry.sha256 = sha(buffer); entry.bytes = buffer.length; entry.status = 'complete';
      entry.warningPresent = Boolean(res.headers.get('x-databento-warning')); await save();
      this.newEstimateUsd += estimateUsd; this.downloads++;
      if (entry.warningPresent) throw new Error('Databento veri uyarısı verdi; snapshot etkinleştirilmedi');
      return { text: buffer.toString('utf8'), sha256: entry.sha256, cached: false };
    } finally { await lock.close(); await rm(lockPath); }
  }
}
