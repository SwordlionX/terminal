import { NextRequest, NextResponse } from 'next/server';
import { refreshSnapshot } from '@/services/market.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function doRefresh() {
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

/** POST /api/market/refresh — ekrandaki "Opsiyon Zincirlerini Yenile" butonu için manuel tetikleme. */
export async function POST() {
  return doRefresh();
}

/**
 * GET /api/market/refresh — Vercel Cron için (vercel.json'daki günlük 18:00 TR / 15:00 UTC job
 * buraya GET atar). ABD opsiyon zincirleri Yahoo'da ancak ABD seansı açıldıktan sonra güncellendiği
 * için zamanlama günü kapanıştan sonraya, akşam 18:00'e denk getirildi.
 * CRON_SECRET env değişkeni tanımlıysa Vercel'in eklediği Authorization header'ı doğrulanır;
 * başka bir yerden GET ile tetiklenmesini engeller.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }
  return doRefresh();
}
