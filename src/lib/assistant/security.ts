import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Content } from '@google/genai';

const COOKIE_NAME = 'terminal_assistant';
function secret(): Buffer {
  const value = process.env.ASSISTANT_SESSION_SECRET || process.env.ASSISTANT_ACCESS_CODE || process.env.GEMINI_API_KEY;
  if (!value) throw new Error('Asistan bağlantısı henüz hazırlanmadı.');
  return createHash('sha256').update(`terminal-assistant-v1:${value}`).digest();
}
function equal(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest(),
    y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}
export function isAuthorized(request: Request): boolean {
  if (!process.env.ASSISTANT_ACCESS_CODE) return process.env.NODE_ENV !== 'production';
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);
  if (!cookie) return false;
  const [expiry, nonce, signature] = cookie.split('.');
  if (!expiry || !nonce || !signature || !Number.isFinite(Number(expiry)) || Number(expiry) < Date.now()) return false;
  const expected = createHmac('sha256', secret()).update(`${expiry}.${nonce}`).digest('base64url');
  return equal(signature, expected);
}
export function issueCookie(code: string): string {
  const expected = process.env.ASSISTANT_ACCESS_CODE;
  if (!expected || !equal(code, expected)) throw new Error('Erişim kodu doğru değil.');
  const expiry = Date.now() + 8 * 3600 * 1000,
    nonce = randomBytes(12).toString('base64url');
  const value = `${expiry}.${nonce}.${createHmac('sha256', secret()).update(`${expiry}.${nonce}`).digest('base64url')}`;
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Strict; Path=/api/assistant; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const url = new URL(request.url);
  // Next's internal URL may use its listen hostname; browsers use the public Host.
  const host = request.headers.get('host');
  return origin === url.origin || Boolean(host && origin === `${url.protocol}//${host}`);
}

/** Authenticated encryption preserves tool history/thought signatures without trusting client text. */
export function sealConversation(contents: Content[], scope?: string): string {
  const bytes = Buffer.from(JSON.stringify({ version: 1, expiry: Date.now() + 30 * 60 * 1000, scope, contents }));
  if (bytes.length > 100_000) throw new Error('Bu sohbet uzadı. Yeni sohbet açarak devam edin.');
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', secret(), iv);
  cipher.setAAD(Buffer.from('terminal-assistant-conversation-v1'));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function openConversation(token: unknown, scope?: string): Content[] {
  if (token === undefined || token === null || token === '') return [];
  if (typeof token !== 'string' || token.length > 140_000)
    throw new Error('Sohbet bilgisi geçersiz. Yeni sohbet açın.');
  try {
    const bytes = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', secret(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from('terminal-assistant-conversation-v1'));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
    if (payload.version !== 1 || payload.expiry < Date.now() || !Array.isArray(payload.contents))
      throw new Error('expired');
    if (scope !== undefined && payload.scope !== scope) return [];
    return payload.contents;
  } catch {
    throw new Error('Sohbet süresi dolmuş veya bilgisi geçersiz. Yeni sohbet açın.');
  }
}
