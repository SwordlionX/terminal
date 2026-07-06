/**
 * Tek kullanıcılı basit oturum: çerez değeri = SHA-256("ucan-finans:" + SITE_PASSWORD).
 * Web Crypto kullanılır — hem Node hem Edge (middleware) ortamında çalışır.
 * SITE_PASSWORD tanımlı değilse (yerel geliştirme) koruma devre dışıdır.
 */

export const AUTH_COOKIE = 'uf_auth';

export async function authToken(password: string): Promise<string> {
  const data = new TextEncoder().encode('ucan-finans:' + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
