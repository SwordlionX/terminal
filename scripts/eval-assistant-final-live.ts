import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Models, type Content } from '@google/genai';
import { terminalMarket } from '../src/lib/assistant/market';
import { quoteOption } from '../src/lib/assistant/pricing';
import { calculatePricing } from '../src/lib/pricing/engine';
import { premiumValue } from '../src/lib/assistant/search';
import { runAssistant } from '../src/lib/assistant/runner';
import type { AssistantArtifact, Product, ScreenContext } from '../src/lib/assistant/types';

const reportPath = process.argv.includes('--probe')
  ? 'docs/ASSISTANT_PANEL_PROVIDER_PROBE.json'
  : process.argv.some(a => a.startsWith('--cases='))
    ? 'docs/ASSISTANT_FINAL_LIVE_EVAL_RETEST.json'
    : 'docs/ASSISTANT_FINAL_LIVE_EVAL.json';
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));

async function main() {
  if (!process.argv.includes('--live')) {
    console.log('Gerçek son değerlendirme için --live gerekli.');
    return;
  }
  process.loadEnvFile('.env.local');
  if (process.env.NODE_ENV === 'production') throw new Error('Bu değerlendirme yalnız yerel geliştirme içindir.');
  if (!process.env.GEMINI_API_KEY || !process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN)
    throw new Error('Bağlantı ayarları eksik.');
  const requestedModel = process.argv.find(a => a.startsWith('--model='))?.slice(8);
  if (requestedModel) process.env.GEMINI_MODEL = requestedModel;
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const maxModelCalls = model.includes('lite') ? 30 : 20;
  process.env.ASSISTANT_DAILY_MODEL_CALL_LIMIT = String(maxModelCalls);
  const minProviderIntervalMs = model.includes('lite') ? 5000 : 13000;
  const tradeDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  async function setup(product: Product) {
    const market = await terminalMarket(product);
    if (!market.spot || !market.surface) throw new Error('Mevcut terminal eğrisi eksik.');
    const dates = market.surface.expiries.map(e => e.date).filter(d => d > tradeDate);
    dates.sort(
      (a, b) =>
        Math.abs((Date.parse(a) - Date.parse(tradeDate)) / 86400000 - 90) -
        Math.abs((Date.parse(b) - Date.parse(tradeDate)) / 86400000 - 90),
    );
    if (!dates[0]) throw new Error('İleri vade bulunamadı.');
    const context: ScreenContext = {
      product,
      spot: market.spot,
      strike: Math.round(market.spot * 100) / 100,
      rate: market.surface.builtWithR! * 100,
      lease: market.surface.impliedLeaseRate! * 100,
      vol: 1,
      manualSpot: false,
      manualVol: false,
      contractSize: 10,
      basis: 365,
      tradeDate,
      expiryDate: dates[0],
    };
    const quote = quoteOption({ type: 'Put', position: 'Short' }, context, market);
    context.vol = quote.effectiveVol;
    return { context, market, quote };
  }
  const xau = await setup('XAU'),
    xag = await setup('XAG');
  const totalTarget = Math.round(xau.quote.premiumTotal * 100) / 100;
  const lowerStrike = Math.round(xau.context.strike * 0.9 * 100) / 100;
  const selected = process.argv
    .find(a => a.startsWith('--cases='))
    ?.slice(8)
    .split(',');
  const cases = [
    {
      id: 'E01_XAU_short_put',
      turns: [
        'Ekrandaki altın için müşteri 10 ons put satacak. Strike, vade ve gün bazı ekrandaki gibi. Terminalin mevcut eğrisinde fiyatla; endikatif kartı göster.',
      ],
      kind: 'xau',
    },
    ...(process.argv.includes('--probe')
      ? [
          {
            id: 'PANEL_explicit_trade',
            turns: [
              `XAU için müşteri 10 ons put satacak. Kullanım fiyatı ${xau.context.strike}, değerleme tarihi ${tradeDate}, vade ${xau.context.expiryDate}, gün bazı 365. Terminalin mevcut eğrisiyle endikatif fiyatla ve kartı göster.`,
            ],
            kind: 'xau',
          },
        ]
      : []),
    ...(process.argv.includes('--probe')
      ? [
          {
            id: 'PANEL_quantity_override',
            turns: [
              'Ekrandaki altın için müşteri 10 ons put satacak. Strike, vade ve gün bazı ekrandaki gibi. Terminalin mevcut eğrisinde fiyatla; endikatif kartı göster.',
            ],
            kind: 'xau',
          },
        ]
      : []),
    {
      id: 'E24_XAG_context_change',
      turns: [
        'Ekrandaki XAU için müşteri 10 ons put satışını mevcut eğride fiyatla.',
        `Şimdi gümüşe geçiyoruz: XAG müşteri call alımı, 20 ons, strike ${xag.context.strike}, vade ${xag.context.expiryDate}, değerleme ${tradeDate}, gün bazı 365. Mevcut terminal eğrisiyle fiyatla.`,
      ],
      kind: 'xag_change',
    },
    {
      id: 'E03_percent_clarification',
      turns: [
        'Ekrandaki XAU ve vade için müşteri 10 ons put satacak; yüzde 5 primli opsiyon bul.',
        'Yüzde 5 hedef spot nominali üzerinden olsun. Aynı vade, 10 ons put satışı için strike ara.',
      ],
      kind: 'percent',
    },
    {
      id: 'E04_total_USD_target',
      turns: [
        `Ekrandaki XAU ve vade için müşteri 10 ons put satacak. Hedef prim ${totalTarget} USD TOPLAM; birim başına değil. Hedefi sağlayan kullanım fiyatını terminal eğrisinde bul.`,
      ],
      kind: 'total',
    },
    {
      id: 'E05_unreachable_target',
      turns: [
        `XAU müşteri 10 ons put satışı, ekrandaki vade. Strike yalnız ${xau.context.strike * 0.95} ile ${xau.context.strike * 1.05} arasında olsun. Hedef toplam prim 1000000000 USD. Bu aralıkta çözüm yoksa bunu açıkça söyle, en yakın sonucu hedefe ulaştı sayma.`,
      ],
      kind: 'unreachable',
    },
    {
      id: 'E10_hedge_historical_entry',
      turns: [
        `Varsayımsal müşterinin ekrandaki XAU/vade/strike ile 10 ons short put pozisyonu var. Başlangıç primi bilinmiyor. Pozisyonu tek başına ve aynı vade 10 ons ${lowerStrike} strike long put korumasıyla karşılaştır; vade sonu grafiğini göster. Gerçekleşmiş zarar iddiası kullanma.`,
        'Bu varsayımsal test müşterisinin geçmişte tahsil ettiği birim prim 10 USD/ons idi. Bu bilgiyi yalnız mevcut short bacağın geçmiş primi olarak kullan. İki alternatifi vade sonunda tekrar karşılaştır; koruma bacağının giriş maliyeti bugünkü terminal model primi olsun.',
      ],
      kind: 'hedge',
    },
    {
      id: 'E12_E13_manual_refusal',
      turns: [
        'Ekrandaki XAU put satışını 10 ons fiyatla ama spot 6000, IV yüzde 30, faiz yüzde 2 ve kira yüzde 1 olsun. Bu manuel değerlerle fiyat istiyorum.',
      ],
      kind: 'manual',
    },
    {
      id: 'E22_existing_barrier_history_missing',
      turns: [
        `Müşterinin mevcut XAU short put knock-out aşağı bariyer işlemini kapatmak istiyorum. Strike ${xau.context.strike}, vade ${xau.context.expiryDate}, 10 ons, bariyer ${lowerStrike}. Daha önce bariyere değip değmediğini bilmiyorum. Kesin kapatma fiyatını ver.`,
      ],
      kind: 'barrier',
    },
  ].filter(c => !selected || selected.includes(c.id));
  if (!cases.length) throw new Error('Değerlendirme vakası seçilmedi.');
  const report = {
    at: new Date().toISOString(),
    model,
    requestedModelSource: requestedModel ? 'explicit_evaluation_argument' : 'local_panel_environment',
    maxModelCalls,
    minProviderIntervalMs,
    screenQuantity: 100,
    selectedCases: cases.map(c => c.id),
    scope:
      'Seçilen temel gerçek Gemini vakaları; ekran miktarı 100, istenen miktarlar 10/20. Bütün 24 vaka/parafrazlar veya faiz/kira kalibrasyonu onayı değildir. Terminalin mevcut kayıtlı eğrisi kullanılır.',
    calibrationValidated: false,
    state: 'running',
    providerRequests: [] as Record<string, unknown>[],
    cases: [] as Record<string, unknown>[],
  };
  // Observe and pace the installed SDK's actual HTTP method only in this evaluation process.
  // No responses, tools, prices or terminal data are mocked or replaced.
  const prototype = Models.prototype as unknown as {
    generateContentInternal: (...args: unknown[]) => Promise<unknown>;
  };
  const original = prototype.generateContentInternal;
  if (typeof original !== 'function') throw new Error('SDK değerlendirme gözlem noktası bulunamadı.');
  let lastStart = 0,
    pacingMs = 0;
  prototype.generateContentInternal = async function (...args) {
    const wait = Math.max(0, lastStart + minProviderIntervalMs - Date.now());
    if (wait) {
      await delay(wait);
      pacingMs += wait;
    }
    lastStart = Date.now();
    const row: Record<string, unknown> = { startedAt: new Date().toISOString() };
    report.providerRequests.push(row);
    try {
      const response = await original.apply(this, args);
      const r = response as {
        modelVersion?: string;
        usageMetadata?: unknown;
        functionCalls?: unknown;
        candidates?: { finishReason?: string; finishMessage?: string; content?: Content }[];
      };
      row.durationMs = Date.now() - lastStart;
      row.modelVersion = r.modelVersion;
      row.usageMetadata = r.usageMetadata;
      row.functionCalls = r.functionCalls ?? [];
      row.finishReason = r.candidates?.[0]?.finishReason;
      if (process.argv.includes('--probe')) row.finishMessage = r.candidates?.[0]?.finishMessage;
      row.contentPartKinds = r.candidates?.[0]?.content?.parts?.map(p => Object.keys(p));
      return response;
    } catch (error) {
      row.state = 'provider_error';
      row.status = (error as { status?: number }).status;
      throw error;
    }
  };
  const save = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  const verifyQuotes = (artifacts: AssistantArtifact[]) => {
    const quotes = artifacts.flatMap(a =>
      a.kind === 'quote'
        ? [a.quote]
        : a.kind === 'search'
          ? [...a.result.candidates.map(c => c.quote), ...(a.result.nearest ? [a.result.nearest.quote] : [])]
          : a.kind === 'scenarios'
            ? a.results.flatMap(r => r.quotes)
            : [],
    );
    return quotes.every(q => {
      const surface = q.product === 'XAU' ? xau.market.surface : xag.market.surface;
      if (!surface || q.surfaceAt !== surface.fetchedISO || q.inputs.manualVol) return false;
      const p = calculatePricing(q.inputs, surface);
      const premium = q.type === 'Put' ? p.result.put : p.result.call;
      return (
        p.priceable &&
        close(q.premiumPerUnit, premium) &&
        close(q.premiumTotal, premium * q.inputs.contractSize) &&
        close(q.cashflow, (q.position === 'Short' ? 1 : -1) * q.premiumTotal)
      );
    });
  };
  try {
    await save();
    let stop = false,
      providerFailures = 0;
    for (const c of cases) {
      if (stop) break;
      const row: Record<string, unknown> = { id: c.id, state: 'running', turns: [] };
      report.cases.push(row);
      let contents: Content[] = [];
      for (let index = 0; index < c.turns.length; index++) {
        const started = Date.now(),
          pacedBefore = pacingMs,
          requestsBefore = report.providerRequests.length;
        const artifacts: AssistantArtifact[] = [],
          messages: string[] = [];
        const turn: Record<string, unknown> = { prompt: c.turns[index], state: 'running', artifacts, messages };
        (row.turns as Record<string, unknown>[]).push(turn);
        console.log(`${c.id} tur ${index + 1} çalışıyor (${model})`);
        try {
          const context = c.id.startsWith('PANEL_')
            ? { ...xau.context, contractSize: 100, strike: 3700, expiryDate: '2027-01-01' }
            : { ...xau.context, contractSize: 100 };
          const result = await runAssistant({
            message: c.turns[index],
            context,
            contents,
            signal: AbortSignal.timeout(150000),
            emit: event => {
              if (event.type === 'artifact') artifacts.push(event.artifact);
              if (event.type === 'text') messages.push(event.text);
            },
          });
          contents = result.contents;
          turn.modelCalls = result.modelCalls;
          turn.providerRequestIndices = Array.from(
            { length: report.providerRequests.length - requestsBefore },
            (_, i) => requestsBefore + i,
          );
          const noResearch = artifacts.every(a => a.kind !== 'research');
          let intent = false;
          const quote = artifacts.find(a => a.kind === 'quote');
          const search = artifacts.find(a => a.kind === 'search');
          const scenarios = artifacts.find(a => a.kind === 'scenarios');
          if (c.kind === 'xau' || (c.kind === 'xag_change' && index === 0))
            intent =
              quote?.kind === 'quote' &&
              quote.quote.product === 'XAU' &&
              quote.quote.type === 'Put' &&
              quote.quote.position === 'Short' &&
              quote.quote.inputs.contractSize === 10;
          if (c.kind === 'xag_change' && index === 1)
            intent =
              quote?.kind === 'quote' &&
              quote.quote.product === 'XAG' &&
              quote.quote.type === 'Call' &&
              quote.quote.position === 'Long' &&
              quote.quote.inputs.contractSize === 20 &&
              close(quote.quote.inputs.strike, xag.context.strike);
          if (c.kind === 'percent' && index === 0)
            intent =
              !artifacts.length && /spot/iu.test(messages.join(' ')) && /(strike|kullanım)/iu.test(messages.join(' '));
          if ((c.kind === 'percent' && index === 1) || c.kind === 'total')
            intent =
              search?.kind === 'search' &&
              search.result.unit === (c.kind === 'total' ? 'total_usd' : 'pct_spot') &&
              close(search.result.target, c.kind === 'total' ? totalTarget : 5) &&
              search.result.reached &&
              search.result.candidates.length > 0 &&
              search.result.candidates.every(
                v =>
                  Math.abs(premiumValue(v.quote, search.result.unit) - search.result.target) <= search.result.tolerance,
              );
          if (c.kind === 'unreachable')
            intent = search?.kind === 'search' && !search.result.reached && search.result.candidates.length === 0;
          if (c.kind === 'hedge' && scenarios?.kind === 'scenarios') {
            intent =
              scenarios.results.length === 2 &&
              scenarios.results.every(
                r =>
                  r.horizon === 'expiry' &&
                  r.quotes.some(q => q.product === 'XAU' && q.type === 'Put' && q.position === 'Short') &&
                  r.points.length === 21,
              );
            intent &&= scenarios.results.some(r =>
              r.quotes.some(q => q.type === 'Put' && q.position === 'Long' && close(q.inputs.strike, lowerStrike)),
            );
            intent &&= scenarios.results.every(r =>
              r.points.every(p =>
                close(
                  p.pnl,
                  r.quotes.reduce((sum, q) => {
                    const entry = index === 1 && q.position === 'Short' ? 10 : q.premiumPerUnit;
                    const intrinsic =
                      q.type === 'Put' ? Math.max(q.inputs.strike - p.spot, 0) : Math.max(p.spot - q.inputs.strike, 0);
                    return sum + (q.position === 'Long' ? 1 : -1) * (intrinsic - entry) * q.inputs.contractSize;
                  }, 0),
                ),
              ),
            );
          }
          // Refusing overrides may include a clearly identified automatic terminal quote.
          if (c.kind === 'manual')
            intent =
              artifacts.every(a => a.kind === 'quote') &&
              /manuel/iu.test(messages.join(' ')) &&
              /eğri/iu.test(messages.join(' '));
          if (c.kind === 'barrier')
            intent = !artifacts.length && /(geçmiş|temas|değip|gözlem|dokun)/iu.test(messages.join(' '));
          turn.checks = {
            expectedIntent: intent,
            engineAndQuantityAgreement: verifyQuotes(artifacts),
            noWebArtifacts: noResearch,
            hasFinalText: messages.length > 0,
          };
          turn.state =
            intent && verifyQuotes(artifacts) && noResearch && messages.length
              ? 'automated_checks_passed_manual_review_pending'
              : 'automated_checks_failed';
          providerFailures = 0;
        } catch (error) {
          const status = (error as { status?: number }).status;
          turn.state = 'provider_or_execution_error_not_passed';
          turn.status = status;
          turn.modelFinishReason = (error as { modelFinishReason?: string }).modelFinishReason;
          // Runner errors are sanitized; only known application messages are retained.
          const knownErrors = [
            'Asistan yanıt oluşturamadı.',
            'Asistan bu isteğe yanıt oluşturamadı.',
            'Yanıt tamamlanamadı;',
            'Bu isteğin hesaplama',
            'Asistan kullanım sınırına',
            'İsteğin hesaplama süresi',
            'Gemini bağlantısı',
          ];
          turn.reason =
            error instanceof Error && knownErrors.some(s => error.message.startsWith(s))
              ? error.message
              : 'execution_error_details_withheld';
          if (status && status >= 500) providerFailures++;
          if (status === 429 || providerFailures >= 3 || report.providerRequests.length >= maxModelCalls) stop = true;
        }
        turn.totalDurationMs = Date.now() - started;
        turn.evaluationPacingMs = pacingMs - pacedBefore;
        console.log(`${c.id} tur ${index + 1}: ${turn.state}`);
        await save();
        if (stop) break;
      }
      row.state =
        (row.turns as Record<string, unknown>[]).length === c.turns.length &&
        (row.turns as Record<string, unknown>[]).every(t => t.state === 'automated_checks_passed_manual_review_pending')
          ? 'automated_checks_passed_manual_review_pending'
          : 'failed_or_incomplete';
      await save();
    }
    report.state =
      report.cases.length === cases.length &&
      report.cases.every(c => c.state === 'automated_checks_passed_manual_review_pending')
        ? 'automated_checks_passed_manual_review_pending'
        : 'failed_or_incomplete';
    await save();
    console.log(`${report.state}; ${report.providerRequests.length} gerçek sağlayıcı çağrısı. Kayıt: ${reportPath}`);
    if (report.state === 'failed_or_incomplete') process.exitCode = 1;
  } finally {
    prototype.generateContentInternal = original;
  }
}
main().catch(() => {
  console.error('Son değerlendirme başlatılamadı; ayar ve terminal verisini kontrol edin.');
  process.exitCode = 1;
});
