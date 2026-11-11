import { createClient } from '@libsql/client';
import { NextRequest, NextResponse } from 'next/server';
import { InvoiceStore } from './store';
import { InvoiceError } from './model';

export const SESSION_COOKIE = 'invoice_session';
export const DEVICE_COOKIE = 'invoice_device';
let store: InvoiceStore | undefined;
export function invoiceStore() {
  const secret = process.env.INVOICE_AUTH_SECRET,
    url = process.env.TURSO_DATABASE_URL;
  if (!secret || secret.length < 32 || !url || /^file:/i.test(url))
    throw new InvoiceError('Fatura takibi henüz kullanıma açılmamış.', 503);
  store ??= new InvoiceStore(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }), secret);
  return store;
}
export async function authenticated(request: NextRequest) {
  const db = invoiceStore(),
    account = await db.session(request.cookies.get(SESSION_COOKIE)?.value);
  if (!account) throw new InvoiceError('Oturumun sona ermiş. Hesap kodunla tekrar giriş yap.', 401);
  return { db, account };
}
export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== request.nextUrl.origin) throw new InvoiceError('İstek kaynağı geçersiz.', 403);
}
export async function body(request: NextRequest) {
  if (
    !request.headers.get('content-type')?.startsWith('application/json') ||
    Number(request.headers.get('content-length') || 0) > 16384
  )
    throw new InvoiceError('İstek biçimi geçersiz.');
  const raw = await request.text();
  if (raw.length > 16384) throw new InvoiceError('İstek çok büyük.');
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new InvoiceError('İstek okunamadı.');
  }
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
}
export function errorResponse(error: unknown) {
  if (error instanceof InvoiceError) return json({ error: error.message }, error.status);
  console.error('Invoice request failed', error instanceof Error ? error.name : 'Unknown error');
  return json({ error: 'Kayıt tamamlanamadı. Bağlantıyı kontrol edip yeniden dene.' }, 500);
}
