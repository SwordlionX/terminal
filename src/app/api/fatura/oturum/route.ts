import { NextRequest } from 'next/server';
import {
  body,
  DEVICE_COOKIE,
  errorResponse,
  invoiceStore,
  json,
  sameOrigin,
  SESSION_COOKIE,
} from '@/features/invoices/server';
import { InvoiceError, object } from '@/features/invoices/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const db = invoiceStore(),
      account = await db.session(request.cookies.get(SESSION_COOKIE)?.value);
    return json({ account, configured: true, setupRequired: account ? false : !(await db.isSetup()) });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const b = object(await body(request)),
      db = invoiceStore();
    if (b.action !== 'setup' && b.action !== 'login') throw new InvoiceError('İşlem geçersiz.');
    const address = (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'local')
      .split(',')[0]
      .trim();
    const device = request.cookies.get(DEVICE_COOKIE)?.value;
    const result =
      b.action === 'setup'
        ? await db.setup(b.code, b.name, b.setupToken, process.env.INVOICE_SETUP_TOKEN)
        : await db.login(b.code, address, device);
    const response = json({ account: result.account });
    const cookie = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path: '/',
    };
    response.cookies.set(SESSION_COOKIE, result.token, { ...cookie, maxAge: result.maxAge });
    // Kept after logout: it only exempts this browser from the global login lockout.
    response.cookies.set(DEVICE_COOKIE, result.deviceToken, {
      ...cookie,
      path: '/api/fatura/oturum',
      maxAge: result.deviceMaxAge,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: NextRequest) {
  try {
    sameOrigin(request);
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (token) await invoiceStore().logout(token);
    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
