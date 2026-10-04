import { NextResponse } from 'next/server';
import { getInterestRate } from '@/services/market.service';
import { parseSettingsNumber, readSettingsBody } from '@/lib/settings-validation';

export const dynamic = 'force-dynamic';

/** Read-only 90-day ACT/365 equivalent of the active USD factor curve. */
export async function GET() {
  try {
    return NextResponse.json({ rate: await getInterestRate(), tenorDays: 90, source: 'CME SR1 + NY Fed SOFR proxy' });
  } catch {
    return NextResponse.json({ error: 'USD faiz eğrisi okunamadı; varsayılan faiz kullanılmaz.' }, { status: 503 });
  }
}

/** POST /api/settings/rate — faiz oranını günceller. */
export async function POST(request: Request) {
  const body = await readSettingsBody(request);
  const rate = body ? parseSettingsNumber(body.rate) : null;
  if (rate === null || rate < 0) {
    return NextResponse.json({ ok: false, error: 'Geçersiz faiz oranı' }, { status: 400 });
  }
  return NextResponse.json(
    {
      ok: false,
      error: 'Manuel faiz girişi eğri–fiyat tutarlılığını bozar. USD eğrisi veri kaynağından kurulmalıdır.',
    },
    { status: 409 },
  );
}
