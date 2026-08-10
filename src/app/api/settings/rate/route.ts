import { NextResponse } from 'next/server';
import { getInterestRate, setInterestRate } from '@/services/market.service';

export const dynamic = 'force-dynamic';

/** GET /api/settings/rate — CME yüzeyi kurulurken baz alınacak faiz oranı (varsayılan 0.05). */
export async function GET() {
  const rate = await getInterestRate();
  return NextResponse.json({ rate });
}

/** POST /api/settings/rate — faiz oranını günceller. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const rate = Number(body.rate);
  if (!Number.isFinite(rate) || rate < 0) {
    return NextResponse.json({ ok: false, error: 'Geçersiz faiz oranı' }, { status: 400 });
  }
  await setInterestRate(rate);
  return NextResponse.json({ ok: true, rate });
}
