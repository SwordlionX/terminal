import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const PRODUCTS = new Set(['XAU', 'XAG']);
const REPO = 'SwordlionX/terminal';
const WORKFLOW = 'cme-refresh.yml';

function validProduct(value: string | null) {
  const product = (value ?? '').toUpperCase();
  return PRODUCTS.has(product) ? product : null;
}

function authHeaders(token: string) {
  return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
}

/** Manual refreshes dispatch the main workflow and return a correlation id, not a completion claim. */
export async function POST(req: NextRequest) {
  const product = validProduct(new URL(req.url).searchParams.get('product'));
  if (!product) return NextResponse.json({ ok: false, error: 'Ürün XAU veya XAG olmalı.' }, { status: 400 });
  if (process.env.VERCEL_ENV === 'preview') {
    return NextResponse.json({ ok: false, error: 'Önizleme ortamından canlı CME yenilemesi başlatılamaz.' }, { status: 409 });
  }
  const token = process.env.GITHUB_PAT;
  if (!token) return NextResponse.json({ ok: false, error: 'CME yenilemesi şu anda kullanılamıyor.' }, { status: 503 });

  const requestId = randomUUID();
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: process.env.CME_REFRESH_REF || 'main', inputs: { product, request_id: requestId } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: 'GitHub Actions yenileme isteğini kabul etmedi.' }, { status: 502 });
    return NextResponse.json({ ok: true, product, request_id: requestId, status: 'queued' });
  } catch {
    return NextResponse.json({ ok: false, error: 'GitHub Actions bağlantısı kurulamadı.' }, { status: 502 });
  }
}

/** Vercel Cron dispatches the daily refresh for the active CME product. */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const explicitProduct = params.get('product');
  if (explicitProduct !== null && !validProduct(explicitProduct)) {
    return NextResponse.json({ ok: false, error: 'Ürün XAU veya XAG olmalı.' }, { status: 400 });
  }
  if (process.env.VERCEL_ENV === 'preview') {
    return NextResponse.json({ ok: false, error: 'Önizleme ortamından canlı CME yenilemesi başlatılamaz.' }, { status: 409 });
  }
  const product = validProduct(explicitProduct) ?? 'XAG';
  const token = process.env.GITHUB_PAT;
  if (!token) return NextResponse.json({ ok: false, error: 'CME yenilemesi şu anda kullanılamıyor.' }, { status: 503 });
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: process.env.CME_REFRESH_REF || 'main', inputs: { product } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: 'GitHub Actions yenileme isteğini kabul etmedi.' }, { status: 502 });
    return NextResponse.json({ ok: true, dispatched: true, product });
  } catch {
    return NextResponse.json({ ok: false, error: 'GitHub Actions bağlantısı kurulamadı.' }, { status: 502 });
  }
}
