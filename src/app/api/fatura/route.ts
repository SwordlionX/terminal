import { NextRequest } from 'next/server';
import { authenticated, body, errorResponse, json, sameOrigin } from '@/features/invoices/server';
import { InvoiceError, object, text } from '@/features/invoices/model';
import { configuredLimit } from '@/lib/assistant/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const { db, account } = await authenticated(request),
      q = request.nextUrl.searchParams;
    if (q.get('action') === 'accounts') return json({ accounts: await db.accounts(account) });
    if (q.get('action') === 'limits')
      return json({
        used: await db.usageMeter(account),
        limit: configuredLimit('ASSISTANT_DAILY_MODEL_CALL_LIMIT', 300, 10000),
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      });
    if (q.get('action') === 'history') return json(await db.history(text(q.get('id'), 'Fatura')));
    const offset = Number(q.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new InvoiceError('Sayfa geçersiz.');
    return json(
      await db.snapshot({
        companyId: q.get('company') || undefined,
        search: (q.get('search') || '').slice(0, 100),
        status: q.get('status') || undefined,
        offset,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const { db, account } = await authenticated(request),
      b = object(await body(request));
    switch (b.action) {
      case 'create':
        return json({ ok: true, ...(await db.create(account, b)) }, 201);
      case 'update':
        await db.update(b);
        break;
      case 'usage':
        await db.usage(account, b);
        break;
      case 'reverse':
        await db.reverse(account, b);
        break;
      case 'company':
        await db.addCompany(b);
        break;
      case 'addAccount':
        await db.addAccount(account, b);
        break;
      case 'disableAccount':
        await db.disableAccount(account, text(b.id, 'Hesap'));
        break;
      case 'changeCode':
        await db.changeCode(account, b);
        break;
      default:
        throw new InvoiceError('İşlem geçersiz.');
    }
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
