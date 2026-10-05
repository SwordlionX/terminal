import fs from 'node:fs/promises';
import { db } from '../src/services/mockDb';
import { valuationToday } from '../src/lib/assistant/policy';
import { scenarioPortfolio } from '../src/lib/assistant/scenarios';
import { expiryPayoffLimits } from '../src/lib/pricing/position-analysis';
import type { AssistantArtifact, AssistantEvent, ScreenContext } from '../src/lib/assistant/types';

/** Bounded final acceptance. Report excludes names, identifiers, prompts and credentials. */
async function main() {
  if (!process.argv.includes('--live')) {
    console.log('Gerçek bağlantı testi için --live gerekli.');
    return;
  }
  process.loadEnvFile('.env.local');
  const origin = 'http://127.0.0.1:3003';
  const today = valuationToday();
  const trades = (await db.trades.findMany()).filter(
    t => !t.barrierType && t.expiryDate > today && ['Open', 'Near Expiry'].includes(t.status),
  );
  if (!trades.length) throw new Error('İleri vadeli kayıt gerekli.');
  const customer = (await db.customers.findMany()).find(c => c.id === trades[0].customerId)!;
  const saved = trades.filter(t => t.customerId === customer.id);
  const screen: ScreenContext = {
    product: 'XAU',
    type: 'Call',
    position: 'Long',
    spot: 999,
    strike: 999,
    rate: 0,
    lease: 0,
    vol: 1,
    contractSize: 250,
    tradeDate: today,
    expiryDate: '2027-02-04',
    basis: 365,
    manualSpot: false,
    manualVol: false,
  };
  const cookie = ''; // The assistant has no access code; same-origin and usage limits still apply.
  const cases = [
    {
      id: 'customer_current_pnl_from_other_screen',
      message: `${customer.companyName} müşterisinin dosyasını oku. Açık işlemlerinin gerçek giriş primlerini kullanarak bugünkü kâr/zararını, birleşik pozisyon grafiğini ve fiyat × tarih haritasını göster. Ekrandaki altın işlemini kullanma.`,
    },
    {
      id: 'hedge_comparison_and_combined_map',
      message:
        'Gümüşte mevcut işlemim 10 ons müşteri satışı put, strike 60.37 USD/ons, vade 2 Ocak 2027; geçmiş giriş primi 4 USD/ons. Koruma için aynı vadeli 10 ons müşteri alış yönünde put, strike 55 USD/ons eklemeyi değerlendir. Koruma bacağında bugünkü terminal model primini başlangıç referansı al. Mevcut işlem ile bu iki bacaklı alternatifi vade sonu kâr/zarar senaryolarında yan yana karşılaştır. Ayrıca iki bacağın birleşik fiyat × tarih K/Z ve delta/gamma haritasını göster. Maliyet ve azami kayıp etkisini yorumla; bu hedge eski Avrupa tipi sözleşmeyi sona erdirir mi? İşlem uygulama.',
    },
    {
      id: 'manual_market_inputs_refused',
      message:
        'Gümüşte müşteri 10 ons put satsın, strike 60.37, vade 2 Ocak 2027. Manuel spot 100, volatilite yüzde 30, faiz yüzde 2 ve kira yüzde 1 ile fiyatla.',
    },
    { id: 'unspecified_price_asks_terms', message: 'Kanka bir fiyat al.' },
  ];
  const report = {
    at: new Date().toISOString(),
    model: process.env.GEMINI_MODEL,
    state: 'running',
    modelCalls: 0,
    scope:
      'Four bounded local production API cases with real Gemini and existing terminal data; no financial writes, refresh or Databento download. Names, identifiers and credentials excluded.',
    cases: [] as Record<string, unknown>[],
  };
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 1e-7;
  for (const item of cases) {
    console.log(`${item.id}: başladı`);
    const start = Date.now();
    const response = await fetch(`${origin}/api/assistant`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: item.message, context: screen, workspace: { area: 'pricing' } }),
      signal: AbortSignal.timeout(65000),
    });
    if (!response.ok) throw new Error(`API durum ${response.status}`);
    const events = (await response.text())
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as AssistantEvent);
    const artifacts: AssistantArtifact[] = events.flatMap(e => (e.type === 'artifact' ? [e.artifact] : []));
    const text = events.flatMap(e => (e.type === 'text' ? [e.text] : [])).join(' ');
    const errors = events.filter(e => e.type === 'error');
    const done = events.find(e => e.type === 'done');
    const checks: Record<string, boolean> = {
      completed: Boolean(done),
      noError: !errors.length,
      responseText: !!text,
      noExternalResearch: !artifacts.some(a => a.kind === 'research'),
    };
    if (item.id === 'customer_current_pnl_from_other_screen') {
      const file = artifacts.find(a => a.kind === 'workspace');
      const analysis = artifacts.find(a => a.kind === 'position_analysis');
      const expectedEntry = saved.reduce((sum, t) => sum + (t.position === 'Short' ? 1 : -1) * t.premium, 0);
      checks.requestedCustomerRead = file?.kind === 'workspace' && file.snapshot.customer?.id === customer.id;
      checks.allSavedLegs =
        analysis?.kind === 'position_analysis' &&
        analysis.result.quotes.length === saved.length &&
        saved.every(t =>
          analysis.result.quotes.some(
            q =>
              q.product === t.underlying &&
              q.type === t.type &&
              q.position === t.position &&
              close(q.inputs.strike, t.strike) &&
              close(q.inputs.contractSize, t.contractSize) &&
              q.inputs.expiryDate === t.expiryDate,
          ),
        );
      checks.originalPremium =
        analysis?.kind === 'position_analysis' && close(analysis.result.entryCashflow, expectedEntry);
      checks.todayValuationAndMap =
        analysis?.kind === 'position_analysis' &&
        analysis.result.valuationDate === today &&
        analysis.result.dates.includes(today) &&
        analysis.result.rows.length > 0;
      if (analysis?.kind === 'position_analysis') {
        const result = analysis.result;
        const zero = result.rows.find(row => row.movePct === 0)?.cells[result.dates.indexOf(today)];
        checks.currentPnlUsesEntryAndMark =
          zero?.pnl !== null && zero?.pnl !== undefined && close(zero.pnl, result.entryCashflow - result.modelCashflow);
      }
    } else if (item.id === 'hedge_comparison_and_combined_map') {
      const scenarios = artifacts.find(a => a.kind === 'scenarios');
      const analysis = artifacts.find(a => a.kind === 'position_analysis');
      const base = scenarios?.kind === 'scenarios' ? scenarios.results.find(r => r.quotes.length === 1) : undefined;
      const hedge = scenarios?.kind === 'scenarios' ? scenarios.results.find(r => r.quotes.length === 2) : undefined;
      const valid = (quotes: import('../src/lib/assistant/types').Quote[], count: number) =>
        quotes.length === count &&
        quotes.every(
          q =>
            q.product === 'XAG' &&
            q.type === 'Put' &&
            q.inputs.contractSize === 10 &&
            q.inputs.expiryDate === '2027-01-02',
        ) &&
        quotes.some(q => q.position === 'Short' && q.inputs.strike === 60.37) &&
        (count === 1 || quotes.some(q => q.position === 'Long' && q.inputs.strike === 55));
      checks.correctComparison =
        !!base &&
        !!hedge &&
        base.horizon === 'expiry' &&
        hedge.horizon === 'expiry' &&
        valid(base.quotes, 1) &&
        valid(hedge.quotes, 2);
      checks.protectionCostsPremium = !!base && !!hedge && hedge.netCashflow < base.netCashflow;
      checks.combinedMap =
        analysis?.kind === 'position_analysis' &&
        valid(analysis.result.quotes, 2) &&
        analysis.result.rows.length > 0 &&
        analysis.result.dates.length > 1;
      if (base && hedge && analysis?.kind === 'position_analysis') {
        const entries = hedge.quotes.map(q => (q.position === 'Short' ? 4 : q.premiumPerUnit));
        const expected = scenarioPortfolio(hedge.label, hedge.quotes, 'expiry', entries);
        const baseExpected = scenarioPortfolio(base.label, base.quotes, 'expiry', [4]);
        checks.historicalEntryInScenarios =
          expected.points.every((point, i) => close(point.pnl, hedge.points[i].pnl)) &&
          baseExpected.points.every((point, i) => close(point.pnl, base.points[i].pnl));
        const baseLimit = expiryPayoffLimits(base.quotes, [4]);
        const hedgeLimit = expiryPayoffLimits(hedge.quotes, entries);
        checks.lossBoundReduced =
          analysis.result.limits?.maxLoss !== null &&
          analysis.result.limits?.maxLoss !== undefined &&
          close(analysis.result.limits.maxLoss, hedgeLimit.maxLoss!) &&
          hedgeLimit.maxLoss! < baseLimit.maxLoss!;
      }
      checks.europeanContractRemains =
        /Avrupa|sözleşme/i.test(text) &&
        /sona erdirmez|sona ermez|ortadan kaldırmaz|devam|sona erdirm|sona ermes/i.test(text);
    } else if (item.id === 'manual_market_inputs_refused') {
      checks.noPrice = artifacts.length === 0;
      checks.explainsCurveConsistency = /manuel/i.test(text) && /eğri/i.test(text) && /tutarl/i.test(text);
      checks.noModelCall = done?.type === 'done' && done.modelCalls === 0;
    } else {
      checks.noPrice = artifacts.length === 0;
      checks.asksTerms = /ürün|altın|gümüş/i.test(text) && /miktar|ons/i.test(text) && /vade/i.test(text);
      checks.noModelCall = done?.type === 'done' && done.modelCalls === 0;
    }
    const pass = Object.values(checks).every(Boolean);
    const modelCalls = done?.type === 'done' ? done.modelCalls : null;
    report.modelCalls += modelCalls ?? 0;
    report.cases.push({
      id: item.id,
      pass,
      checks,
      modelCalls,
      durationMs: Date.now() - start,
      artifactKinds: artifacts.map(a => a.kind),
      errorCount: errors.length,
      finalText: '[Müşteri/veri metni rapora kaydedilmedi.]',
    });
    await fs.writeFile('docs/ASSISTANT_PRESENTATION_ACCEPTANCE.json', JSON.stringify(report, null, 2) + '\n');
    console.log(
      `${item.id}: ${pass ? 'geçti' : 'başarısız'}; ${modelCalls ?? 'belirsiz'} model çağrısı; ${JSON.stringify(checks)}`,
    );
    if (errors.length || report.modelCalls >= 12) break;
  }
  report.state =
    report.cases.length === cases.length && report.cases.every(item => item.pass) ? 'passed' : 'failed_or_incomplete';
  await fs.writeFile('docs/ASSISTANT_PRESENTATION_ACCEPTANCE.json', JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.state}: ${report.modelCalls} model çağrısı`);
  if (report.state !== 'passed') process.exitCode = 1;
}
main().catch(() => {
  console.error('Kabul testi tamamlanamadı; gizli hata ayrıntıları yazdırılmadı.');
  process.exitCode = 1;
});
