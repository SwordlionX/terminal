import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, authToken } from '@/lib/auth';

export async function proxy(req: NextRequest) {
  // Geçiçi olarak şifre koruması kaldırıldı
  return NextResponse.next();

  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next(); // yerel geliştirme: koruma kapalı

  // Vercel Cron çerez taşımaz, yalnız `Authorization: Bearer $CRON_SECRET` gönderir.
  // Bu istisna olmadan cron istekleri BURADA 401'e çarpıyor ve route'un kendi CRON_SECRET
  // kontrolüne hiç ulaşamıyordu — yani vercel.json'daki günlük yenileme hiç çalışmıyordu.
  // İstisna yalnızca CRON_SECRET tanımlıysa ve header birebir eşleşiyorsa geçerli.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }

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
