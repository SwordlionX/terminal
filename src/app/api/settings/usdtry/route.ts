import { NextResponse } from 'next/server';
import { getUsdTryRate, setUsdTryRate } from '@/services/market.service';

export const dynamic = 'force-dynamic';

/** GET /api/settings/usdtry — teminat motorunun kullandığı kalıcı USD/TRY kuru. */
export async function GET() {
  const usdtry = await getUsdTryRate();
  return NextResponse.json({ usdtry });
}

/** POST /api/settings/usdtry — kuru günceller (1M TL onay eşiği bundan sonra bu kuru kullanır). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const rate = Number(body.usdtry);
  if (!Number.isFinite(rate) || rate <= 0) {
    return NextResponse.json({ ok: false, error: 'Geçersiz kur' }, { status: 400 });
  }
  await setUsdTryRate(rate);
  return NextResponse.json({ ok: true, usdtry: rate });
}
