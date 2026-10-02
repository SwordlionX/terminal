export type CmeRefreshStatus = 'queued' | 'running' | 'completed' | 'failed' | 'notfound' | 'timeout';

export const cmeStatusText: Record<CmeRefreshStatus, string> = {
  queued: 'istek iletildi/bekliyor',
  running: 'çalışıyor',
  completed: 'tamamlandı',
  failed: 'başarısız',
  notfound: 'GitHub kaydının görünmesi bekleniyor',
  timeout: 'doğrulanamadı',
};

type RefreshResponse = { ok?: boolean; error?: string; request_id?: string; status?: CmeRefreshStatus };
type Fetcher = typeof fetch;

async function fetchJson(fetcher: Fetcher, url: string, init: RequestInit, signal: AbortSignal | undefined, timeoutMs: number) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeoutReject: ((reason: Error) => void) | undefined;
  let abortReject: ((reason: DOMException) => void) | undefined;
  const timeout = new Promise<never>((_, reject) => { timeoutReject = reject; });
  const aborted = new Promise<never>((_, reject) => { abortReject = reject; });
  const rejectAbort = () => abortReject?.(new DOMException('Aborted', 'AbortError'));
  signal?.addEventListener('abort', rejectAbort, { once: true });
  if (signal?.aborted) rejectAbort();
  const operation = (async () => {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    const body = await response.json() as RefreshResponse;
    return { response, body };
  })();
  try {
    timer = setTimeout(() => {
      controller.abort();
      timeoutReject?.(new Error('CME isteği zaman aşımına uğradı.'));
    }, timeoutMs);
    return await Promise.race([operation, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
    signal?.removeEventListener('abort', rejectAbort);
  }
}

function delay(ms: number, signal?: AbortSignal, wait?: (ms: number) => Promise<void>) {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  let rejectAbort: ((reason: DOMException) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => rejectAbort?.(new DOMException('Aborted', 'AbortError'));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waiting = wait ? wait(ms) : new Promise<void>(resolve => { timer = setTimeout(resolve, ms); });
  return Promise.race([waiting, aborted]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  });
}

/** Dispatch a CME workflow and poll the exact run until it finishes or the bounded wait expires. */
export async function refreshCme(
  product: string,
  options: { signal?: AbortSignal; onStatus?: (status: CmeRefreshStatus) => void; fetcher?: Fetcher; pollMs?: number; timeoutMs?: number; requestTimeoutMs?: number; wait?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<CmeRefreshStatus> {
  const normalized = product.toUpperCase();
  if (normalized !== 'XAU' && normalized !== 'XAG') throw new Error('Ürün XAU veya XAG olmalı.');
  const fetcher = options.fetcher ?? fetch;
  const signal = options.signal;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  const started = now();
  const dispatch = await fetchJson(fetcher, `/api/market/refresh/cme?product=${normalized}`, { method: 'POST' }, signal, Math.min(requestTimeoutMs, timeoutMs));
  if (!dispatch.response.ok || !dispatch.body.ok || !dispatch.body.request_id) throw new Error(dispatch.body.error || 'CME yenileme isteği gönderilemedi.');
  const requestId = dispatch.body.request_id;
  const pollMs = options.pollMs ?? 12_000;
  while (now() - started < timeoutMs) {
    const remaining = timeoutMs - (now() - started);
    const { response, body } = await fetchJson(fetcher, `/api/market/refresh/cme/status?product=${normalized}&request_id=${encodeURIComponent(requestId)}`, { cache: 'no-store' }, signal, Math.min(requestTimeoutMs, remaining));
    if (!response.ok || !body.ok || !body.status) throw new Error(body.error || 'CME durum bilgisi alınamadı.');
    options.onStatus?.(body.status);
    if (body.status === 'completed' || body.status === 'failed') return body.status;
    await delay(Math.min(pollMs, Math.max(0, timeoutMs - (now() - started))), signal, options.wait);
  }
  options.onStatus?.('timeout');
  return 'timeout';
}
