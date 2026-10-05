import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Content } from '@google/genai';

function secret(): Buffer {
  const value = process.env.ASSISTANT_SESSION_SECRET || process.env.GEMINI_API_KEY;
  if (!value) throw new Error('Asistan bağlantısı henüz hazırlanmadı.');
  return createHash('sha256').update(`terminal-assistant-v1:${value}`).digest();
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
