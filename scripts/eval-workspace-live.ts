import fs from 'node:fs/promises';
import { db } from '../src/services/mockDb';
import { activeTrade, metalProduct } from '../src/lib/workspace';
import { terminalMarket } from '../src/lib/assistant/market';
import { analyzeEuropeanPosition } from '../src/lib/pricing/position-analysis';
import { quoteOption } from '../src/lib/assistant/pricing';
import type { AssistantArtifact, AssistantEvent, ScreenContext } from '../src/lib/assistant/types';

/** Three final end-to-end requests. Never persists identifiers, customer text or credentials. */
async function main() {
  if (!process.argv.includes('--live')) {
    console.log('Gerçek Gemini kontrolü için --live gerekli.');
    return;
  }
  process.loadEnvFile('.env.local');
  const origin = process.argv.find(a => a.startsWith('--origin='))?.slice(9) ?? 'http://127.0.0.1:3003';
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error('Yalnız yerel kabul testi.');
  const today = new Date().toISOString().slice(0, 10);
  const saved = (await db.trades.findMany()).find(
    t => activeTrade(t) && !t.barrierType && t.expiryDate > today && metalProduct(t.underlying),
  );
  if (!saved) throw new Error('İleri vadeli vanilya kayıt bulunamadı.');
  const product = metalProduct(saved.underlying)!;
  const market = await terminalMarket(product);
  if (!market.spot || !market.surface) throw new Error('Terminal verisi hazır değil.');
  const screen: ScreenContext = {
    product,
    spot: market.spot,
    strike: market.spot,
    rate: 0,
    lease: 0,
    vol: 1,
    contractSize: 100,
    basis: 365,
    tradeDate: today,
    expiryDate: saved.expiryDate.slice(0, 10),
    manualSpot: false,
    manualVol: false,
    type: 'Put',
    position: 'Short',
  };
  const expected = analyzeEuropeanPosition(screen, market, [
    {
      option: {
        product,
        type: saved.type,
        position: saved.position,
        strike: saved.strike,
        expiryDate: saved.expiryDate.slice(0, 10),
        contractSize: saved.contractSize,
      },
      entryPremiumPerUnit: saved.premium / saved.contractSize,
    },
  ]);
  const cookie = ''; // The assistant has no access code; same-origin and usage limits still apply.
  const selectedCases = process.argv
    .find(a => a.startsWith('--cases='))
    ?.slice(8)
    .split(',');
  const cases = [
    {
      id: 'selected_saved_position',
      message:
        'Seçili kayıtlı pozisyonu oku; gerçek geçmiş primini kullanarak fiyat × tarih K/Z haritası ve delta/gamma analiz kartını göster. Ekonomik ters işlem mevcut Avrupa tipi sözleşmeyi sona erdirir mi?',
      workspace: { area: 'positions', customerId: saved.customerId, tradeIds: [saved.id] },
    },
    {
      id: 'target_on_terminal_curve',
      message: `Ekrandaki ${product} ve vade için müşteri 10 ons Put satacak. Hedef prim spot nominalinin yüzde 5’i. Mevcut terminal eğrisinde strike ara; IV değiştirme. Kartı göster.`,
      workspace: { area: 'pricing' },
    },
    {
      id: 'manual_override_refused',
      message: `Ekrandaki ${product} için 10 ons put satışı fiyatla; manuel spot 100, IV yüzde 30, faiz yüzde 2, kira yüzde 1 olsun. Bu manuel değerlerle hesap istiyorum.`,
      workspace: { area: 'pricing' },
    },
  ].filter(c => !selectedCases || selectedCases.includes(c.id));
  if (!cases.length) throw new Error('Kabul vakası bulunamadı.');
  const report = {
    at: new Date().toISOString(),
    model: process.env.GEMINI_MODEL,
    scope: `${cases.length} local production API requests; real provider when needed, real existing terminal data; no customer writes or Databento download. Customer identifiers, names, cookies, keys and conversation tokens excluded.`,
    state: 'running',
    cases: [] as Record<string, unknown>[],
    modelCalls: 0,
  };
  const output = selectedCases ? 'docs/WORKSPACE_LIVE_EVAL_RETEST.json' : 'docs/WORKSPACE_LIVE_EVAL.json';
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 1e-7;
  for (const c of cases) {
    console.log(`${c.id}: başladı`);
    const started = Date.now(),
      artifacts: AssistantArtifact[] = [],
      messages: string[] = [],
      errors: string[] = [],
      statuses: string[] = [];
    const response = await fetch(`${origin}/api/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
      body: JSON.stringify({ message: c.message, context: screen, workspace: c.workspace }),
      signal: AbortSignal.timeout(65000),
    });
    if (!response.ok) throw new Error(`API durum ${response.status}`);
    const events = (await response.text())
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as AssistantEvent);
    for (const e of events) {
      if (e.type === 'artifact') artifacts.push(e.artifact);
      if (e.type === 'text') messages.push(e.text);
      if (e.type === 'error') errors.push(e.text);
      if (e.type === 'status') statuses.push(e.text);
    }
    const done = events.find(e => e.type === 'done'),
      text = messages.join(' ');
    const noResearch = !artifacts.some(a => a.kind === 'research');
    let checks: Record<string, boolean>;
    if (c.id === 'selected_saved_position') {
      const a = artifacts.find(a => a.kind === 'position_analysis');
      checks = {
        contextCard: artifacts.some(a => a.kind === 'workspace'),
        actualSavedPremium: a?.kind === 'position_analysis' && close(a.result.entryCashflow, expected.entryCashflow),
        savedQuantityAndStrike:
          a?.kind === 'position_analysis' &&
          a.result.quotes.length === 1 &&
          close(a.result.quotes[0].inputs.contractSize, saved.contractSize) &&
          close(a.result.quotes[0].inputs.strike, saved.strike),
        sharedEngineAgreement:
          a?.kind === 'position_analysis' &&
          close(a.result.modelCashflow, expected.modelCashflow) &&
          close(a.result.delta, expected.delta) &&
          close(a.result.gamma, expected.gamma),
        riskMap: a?.kind === 'position_analysis' && a.result.rows.length > 0 && a.result.dates.length > 1,
        europeanObligationExplained:
          /Avrupa|sözleşme/i.test(text) && /devam|kaldırmaz|sona erdirmez|sona ermez/i.test(text),
        noResearch,
      };
    } else if (c.id === 'target_on_terminal_curve') {
      const a = artifacts.find(a => a.kind === 'search');
      checks = {
        correctTarget: a?.kind === 'search' && a.result.unit === 'pct_spot' && a.result.target === 5,
        reachedWithinTolerance:
          a?.kind === 'search' &&
          a.result.reached &&
          a.result.candidates.length > 0 &&
          a.result.candidates.every(v => Math.abs(v.actual - 5) <= a.result.tolerance),
        correctExplicitQuantity:
          a?.kind === 'search' &&
          a.result.candidates.length > 0 &&
          a.result.candidates.every(
            v => v.quote.inputs.contractSize === 10 && v.quote.type === 'Put' && v.quote.position === 'Short',
          ),
        sharedEngineAgreement:
          a?.kind === 'search' &&
          a.result.candidates.length > 0 &&
          a.result.candidates.every(v =>
            close(
              v.quote.premiumTotal,
              quoteOption(
                { product, type: 'Put', position: 'Short', strike: v.quote.inputs.strike, contractSize: 10 },
                screen,
                market,
              ).premiumTotal,
            ),
          ),
        noResearch,
      };
    } else
      checks = {
        noPriceArtifact: artifacts.length === 0,
        explainsCurveConsistency: /manuel/i.test(text) && /eğri/i.test(text) && /tutarl/i.test(text),
        noResearch,
      };
    const pass = Boolean(done) && errors.length === 0 && messages.length > 0 && Object.values(checks).every(Boolean);
    const row = {
      id: c.id,
      pass,
      checks,
      artifactKinds: artifacts.map(a => a.kind),
      errors,
      toolStatuses: statuses.filter(s => !s.startsWith('İsteğin') && !s.startsWith('Sonuçlar')),
      modelCalls: done?.type === 'done' ? done.modelCalls : null,
      durationMs: Date.now() - started,
      finalText:
        c.id === 'manual_override_refused'
          ? text
          : text
            ? '[Müşteri metni rapora kaydedilmedi; kontroller yukarıda.]'
            : '',
    };
    report.cases.push(row);
    report.modelCalls += row.modelCalls ?? 0;
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`${c.id}: ${pass ? 'geçti' : 'başarısız'}; ${row.modelCalls ?? 'belirsiz'} model çağrısı`);
    if (errors.length) break;
  }
  report.state =
    report.cases.length === cases.length && report.cases.every(c => c.pass) ? 'passed' : 'failed_or_incomplete';
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.state}; ${report.modelCalls} tamamlanmış model çağrısı`);
  if (report.state !== 'passed') process.exitCode = 1;
}
main().catch(() => {
  console.error('Kabul testi tamamlanamadı; gizli hata ayrıntıları yazdırılmadı.');
  process.exitCode = 1;
});
