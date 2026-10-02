import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
const REPO = 'SwordlionX/terminal';
const WORKFLOW = 'cme-refresh.yml';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const product = (params.get('product') ?? '').toUpperCase();
  const requestId = params.get('request_id') ?? '';
  if (!['XAU', 'XAG'].includes(product) || !UUID.test(requestId)) {
    return NextResponse.json({ ok: false, error: 'Geçersiz ürün veya istek numarası.' }, { status: 400 });
  }
  const token = process.env.GITHUB_PAT;
  if (!token) return NextResponse.json({ ok: false, error: 'CME durum bilgisi şu anda kullanılamıyor.' }, { status: 503 });
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=100`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return NextResponse.json({ ok: false, error: 'CME durum bilgisi alınamadı.' }, { status: 502 });
    const payload = await response.json() as { workflow_runs?: Array<{ display_title?: string; status?: string; conclusion?: string }> };
    const run = payload.workflow_runs?.find(item => item.display_title === requestId);
    if (!run) return NextResponse.json({ ok: true, status: 'notfound', request_id: requestId });
    const status = ['queued', 'requested', 'waiting', 'pending'].includes(run.status ?? '') ? 'queued'
      : run.status === 'in_progress' ? 'running'
      : run.status === 'completed' ? (run.conclusion === 'success' ? 'completed' : 'failed') : 'notfound';
    return NextResponse.json({ ok: true, status, request_id: requestId });
  } catch {
    return NextResponse.json({ ok: false, error: 'CME durum bilgisi alınamadı.' }, { status: 502 });
  }
}
