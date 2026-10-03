import { isAuthorized, openConversation, sameOrigin, sealConversation } from '@/lib/assistant/security';
import { reserveRequest } from '@/lib/assistant/limits';
import { runAssistant } from '@/lib/assistant/runner';
import { object, validateContext } from '@/lib/assistant/validation';
import type { AssistantEvent } from '@/lib/assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const privateHeaders = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  const ready = Boolean(process.env.GEMINI_API_KEY) && (process.env.NODE_ENV !== 'production' ||
    Boolean(process.env.ASSISTANT_ACCESS_CODE && process.env.TURSO_DATABASE_URL));
  return Response.json({ ready, accessRequired: Boolean(process.env.ASSISTANT_ACCESS_CODE) && !isAuthorized(request) }, { headers: privateHeaders });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Bu istek kaynağına izin verilmiyor.' }, { status: 403 });
  if (!isAuthorized(request)) return Response.json({ error: 'Asistan erişim koduyla giriş yapın.' }, { status: 401, headers: privateHeaders });
  if (!process.env.GEMINI_API_KEY) return Response.json({ error: 'Gemini bağlantısı henüz hazırlanmadı. Bağlantı tamamlandığında buradan konuşabileceksiniz.' }, { status: 503, headers: privateHeaders });
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 160_000) throw new Error('İstek çok uzun. Daha kısa bir mesaj kullanın.');
    const body = object(JSON.parse(raw));
    if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 4000) throw new Error('Bir ila dört bin karakterlik mesaj gerekli.');
    const context = validateContext(body.context), contents = openConversation(body.conversation);
    await reserveRequest();
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, request.signal, AbortSignal.timeout(55000)]);
    const started = Date.now(), encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(streamController) {
        let closed = false;
        const emit = (event: AssistantEvent | { type: 'conversation'; token: string }) => {
          if (!closed && !request.signal.aborted) {
            try { streamController.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); }
            catch { closed = true; controller.abort(); }
          }
        };
        try {
          const result = await runAssistant({ message: (body.message as string).trim(), context, contents, signal, emit });
          emit({ type: 'conversation', token: sealConversation(result.contents) });
          emit({ type: 'done', modelCalls: result.modelCalls, durationMs: Date.now() - started });
        } catch (e) {
          const error = e as { status?: number; message?: string };
          const text = signal.aborted ? 'İstek durduruldu veya süre sınırına ulaşıldı.'
            : error.status === 429 ? 'Gemini şu anda kullanım sınırında. Biraz sonra tekrar deneyin.'
            : error.status === 401 ? 'Gemini API anahtarı doğrulanamadı. Anahtarı ve bağlı proje erişimini kontrol edin.'
            : error.status === 403 ? 'Gemini bu model veya özellik için projeye erişim vermedi. Proje izinlerini ve model kotasını kontrol edin.'
            : error.status ? 'Gemini bağlantısı yanıt vermedi. Daha sonra tekrar deneyin.'
            : error.message || 'Asistan isteği tamamlayamadı.';
          // Never expose SDK request payloads, API keys, or customer information.
          emit({ type: 'error', text });
        } finally {
          if (!closed) { closed = true; try { streamController.close(); } catch { /* client disconnected */ } }
        }
      },
      cancel() { controller.abort(); },
    });
    return new Response(stream, { headers: { ...privateHeaders, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'İstek okunamadı.' }, { status: 400, headers: privateHeaders });
  }
}
