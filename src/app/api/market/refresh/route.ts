import { NextResponse } from 'next/server';
import { refreshSnapshot } from '@/services/market.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** POST /api/market/refresh — Yahoo'dan opsiyon zincirlerini yeniden çeker (GLD + SLV). */
export async function POST() {
  try {
    const snap = await refreshSnapshot();
    const counts = Object.fromEntries(
      Object.entries(snap.products).map(([k, v]) => [k, v.expiries.length])
    );
    return NextResponse.json({ ok: true, fetchedISO: snap.fetchedISO, expiries: counts });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Bilinmeyen hata' },
      { status: 502 }
    );
  }
}
