import { issueCookie, sameOrigin } from '@/lib/assistant/security';
import { reserveRequest } from '@/lib/assistant/limits';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403 });
  try {
    await reserveRequest();
    const raw = await request.text();
    if (raw.length > 500) throw new Error('Erişim kodu geçersiz.');
    const { code } = JSON.parse(raw);
    if (typeof code !== 'string' || code.length > 200) throw new Error('Erişim kodu geçersiz.');
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': issueCookie(code), 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json(
      { error: 'Erişim sağlanamadı. Kodu kontrol edip daha sonra tekrar deneyin.' },
      { status: 401 },
    );
  }
}
