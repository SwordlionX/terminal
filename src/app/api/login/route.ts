import { NextResponse } from 'next/server';
import { AUTH_COOKIE, authToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** POST /api/login — şifre doğruysa 30 günlük oturum çerezi yazar. */
export async function POST(request: Request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    return NextResponse.json({ ok: true, note: 'Şifre tanımlı değil — koruma kapalı' });
  }

  const body = await request.json().catch(() => ({}));
  // Kaba kuvvet denemelerini yavaşlat
  await new Promise(r => setTimeout(r, 400));

  if (typeof body.password !== 'string' || body.password !== password) {
    return NextResponse.json({ ok: false, error: 'Şifre hatalı' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await authToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 gün
  });
  return res;
}

/** DELETE /api/login — çıkış. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
