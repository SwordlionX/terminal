import { NextRequest, NextResponse } from 'next/server';
import { getDataSource } from '@/services/cme.service';

export const dynamic = 'force-dynamic';
// Vercel Hobby fonksiyonları 60 saniyede kesilir; daha yükseği yazmak yanıltıcı olur.
// Günlük yenileme bu yüzden Vercel'de DEĞİL, GitHub Actions'ta koşar
// (.github/workflows/cme-refresh.yml → scripts/refresh-cme.ts). Bu uç yalnızca elle
// tetikleme içindir ve Databento yavaşsa Hobby'de zaman aşımına düşebilir.
export const maxDuration = 60;

async function doRefresh(product: string) {
  const githubPat = process.env.GITHUB_PAT;
  if (!githubPat) {
    return NextResponse.json({ ok: false, error: 'GITHUB_PAT eksik. Ayarlardan manuel yenileme için GitHub şifresi (PAT) tanımlanmalı.' }, { status: 500 });
  }

  try {
    const res = await fetch('https://api.github.com/repos/SwordlionX/terminal/actions/workflows/cme-refresh.yml/dispatches', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${githubPat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { product } })
    });

    if (!res.ok) {
      throw new Error(`GitHub API Hatası: ${res.statusText}`);
    }

    return NextResponse.json({
      ok: true,
      product,
      dispatched: true,
      message: "Yenileme emri GitHub Actions'a iletildi."
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'GitHub bağlantı hatası' },
      { status: 502 }
    );
  }
}

/** POST /api/market/refresh/cme?product=XAG — Ayarlar'daki "CME'den Yenile" butonu. */
export async function POST(req: NextRequest) {
  const product = (new URL(req.url).searchParams.get('product') || 'XAG').toUpperCase();
  return doRefresh(product);
}

// Cron kredi harcamasın: yalnızca aktif kaynağı CME olan ürün yenilenir.
async function doRefreshIfActive(product: string) {
  if ((await getDataSource(product)) !== 'cme') {
    return NextResponse.json({ ok: true, skipped: true, product, reason: 'kaynak cme değil' });
  }
  return doRefresh(product);
}

/**
 * GET /api/market/refresh/cme — Vercel Cron için. CME COMEX metaller ~13:25 CT settle olur;
 * cron güvenli tarafta akşam UTC'ye ayarlanır (vercel.json). CRON_SECRET tanımlıysa
 * Vercel'in eklediği Authorization header'ı doğrulanır.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }
  const product = (new URL(req.url).searchParams.get('product') || 'XAG').toUpperCase();
  return doRefreshIfActive(product);
}
