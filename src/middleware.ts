import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, authToken } from '@/lib/auth';

export async function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next(); // yerel geliştirme: koruma kapalı

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && cookie === (await authToken(password))) {
    return NextResponse.next();
  }

  // API isteklerine 401, sayfalara login yönlendirmesi
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // login sayfası, login API'si ve statik dosyalar hariç her şey korunur
  matcher: ['/((?!login|api/login|_next/static|_next/image|favicon.ico).*)'],
};
