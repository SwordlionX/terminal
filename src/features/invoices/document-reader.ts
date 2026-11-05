import { InvoiceError } from './model';
import { blockAfterError } from '../../lib/assistant/models';

// Document extraction has its own lightweight defaults, independent of chat/research.
export const INVOICE_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

export type ReadFailure = 'quota' | 'timeout' | 'unavailable' | 'access' | 'request' | 'output' | 'unknown';
export type ReadEvent = {
  model: string;
  attempt: number;
  outcome: 'success' | ReadFailure;
  status: number | null;
  elapsedMs: number;
};
export class DocumentOutputError extends Error {}
export function readFailure(error: unknown): { kind: ReadFailure; status: number | null; retryable: boolean } {
  const e = error as { status?: unknown; name?: unknown; message?: unknown } | null;
  const code = Number(e?.status),
    status = Number.isInteger(code) && code >= 100 && code <= 599 ? code : null;
  const message = typeof e?.message === 'string' ? e.message : '';
  const kind: ReadFailure =
    error instanceof DocumentOutputError
      ? 'output'
      : status === 429
        ? 'quota'
        : status === 401 || status === 403
          ? 'access'
          : status === 408 || status === 504 || e?.name === 'TimeoutError' || /timeout|timed out|aborted/i.test(message)
            ? 'timeout'
            : status === 404 || (status !== null && status >= 500)
              ? 'unavailable'
              : status !== null && status >= 400
                ? 'request'
                : /fetch failed|network|ECONNRESET/i.test(message)
                  ? 'unavailable'
                  : 'unknown';
  return { kind, status, retryable: ['quota', 'timeout', 'unavailable', 'output'].includes(kind) };
}
export async function readDocumentWithFallback<T>(options: {
  models: string[];
  signal: AbortSignal;
  call: (model: string, signal: AbortSignal) => Promise<T>;
  reserve: () => Promise<void>;
  block: (model: string, until: number) => Promise<void>;
  report: (event: ReadEvent) => void;
}): Promise<T> {
  const models = options.models.slice(0, 2);
  if (!models.length)
    throw new InvoiceError('Gemini modelleri şu anda kullanım sınırında. Biraz sonra tekrar dene.', 429);
  let last: ReadFailure = 'unknown';
  for (const [index, model] of models.entries()) {
    options.signal.throwIfAborted();
    // Each provider attempt counts toward the existing shared daily budget.
    await options.reserve();
    const started = Date.now(),
      signal = AbortSignal.any([options.signal, AbortSignal.timeout(index === 0 ? 30000 : 20000)]);
    try {
      const value = await options.call(model, signal);
      options.report({ model, attempt: index + 1, outcome: 'success', status: 200, elapsedMs: Date.now() - started });
      return value;
    } catch (error) {
      const failure = readFailure(error);
      last = failure.kind;
      options.report({
        model,
        attempt: index + 1,
        outcome: last,
        status: failure.status,
        elapsedMs: Date.now() - started,
      });
      if (options.signal.aborted) throw error;
      const until = blockAfterError(failure.status ?? undefined, error instanceof Error ? error.message : '');
      if (until !== null) await options.block(model, until);
      if (!failure.retryable) break;
    }
  }
  const messages: Record<ReadFailure, string> = {
    quota: 'Gemini kullanım sınırına ulaşıldı. Biraz sonra tekrar dene.',
    timeout: 'Gemini belgeyi okurken süre sınırına ulaştı. Biraz sonra tekrar dene.',
    unavailable: 'Gemini belge okuma servisi şu anda yanıt veremiyor. Biraz sonra tekrar dene.',
    access: 'Gemini bağlantısı için erişim veya anahtar doğrulaması başarısız oldu.',
    request: 'Gemini bu dosyayı veya okuma isteğini kabul etmedi. Farklı bir PDF ya da net bir fotoğraf dene.',
    output: 'Gemini belge alanlarını geçerli biçimde döndüremedi. Belgenin net bir fotoğrafını deneyebilirsin.',
    unknown: 'Gemini ile belge okuma bağlantısı tamamlanamadı. Biraz sonra tekrar dene.',
  };
  throw new InvoiceError(messages[last], last === 'quota' ? 429 : last === 'output' ? 422 : 502);
}
