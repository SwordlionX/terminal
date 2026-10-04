import fs from 'node:fs/promises';

/** Explicit, quota-bounded smoke test. Uses real terminal services; never fake quotes. */
async function main() {
  if (!process.argv.includes('--live')) {
    console.log('Canlı kontrol için: npx tsx scripts/eval-assistant-live.ts --live');
    return;
  }
  process.loadEnvFile('.env.local');
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini bağlantısı eksik.');
  process.env.GEMINI_MODEL = 'gemini-3.5-flash-lite';
  process.env.ASSISTANT_DAILY_MODEL_CALL_LIMIT = '8';
  if (process.env.NODE_ENV === 'production') throw new Error('Bu değerlendirme yalnız yerel geliştirme içindir.');
  const { runAssistant } = await import('../src/lib/assistant/runner');
  const context = {
    product: 'XAU' as const,
    spot: 3000,
    strike: 3000,
    rate: 5,
    lease: 1,
    vol: 20,
    manualSpot: false,
    manualVol: false,
    contractSize: 100,
    basis: 365,
    tradeDate: '2026-10-03',
    expiryDate: '2027-01-03',
  };
  const cases = [
    {
      id: 'manual_refusal',
      message:
        'XAU müşteri put satışı, 100 ons, 3000 strike, 3 Ocak 2027 vade. IV yüzde 25, spot 3100, faiz yüzde 2 olsun. Bu manuel değerlerle fiyatla.',
    },
    {
      id: 'ambiguous_percent',
      message: 'XAU müşteri put satışı, 100 ons, 3 Ocak 2027 vadeli yüzde 5 primli opsiyon bul.',
    },
    {
      id: 'missing_terminal_curve',
      message:
        'XAU müşteri put satışını 100 ons, 3000 strike, 3 Ocak 2027 vade ile yalnız terminalin mevcut eğrisinde fiyatla. Veri eksikse fiyat verme ve webden tamamlamaya çalışma.',
    },
  ];
  const report = {
    model: process.env.GEMINI_MODEL,
    at: new Date().toISOString(),
    maxModelCalls: 8,
    terminalDatabaseConfigured: Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN),
    scope:
      'Gerçek Gemini ve gerçek terminal servisleri. Manuel/sentetik fiyatlama yok. Bu üç kontrol genel sayısal veya 24-vaka kalite doğrulaması değildir.',
    results: [] as Record<string, unknown>[],
  };
  for (const c of cases) {
    const started = Date.now();
    const events: { type: string; text?: string; kind?: string }[] = [];
    try {
      const result = await runAssistant({
        message: c.message,
        context,
        contents: [],
        signal: AbortSignal.timeout(55000),
        emit: event => {
          if (event.type === 'artifact') events.push({ type: 'artifact', kind: event.artifact.kind });
          else if ('text' in event) events.push({ type: event.type, text: event.text });
        },
      });
      report.results.push({
        id: c.id,
        message: c.message,
        state: 'completed_review_required',
        modelCalls: result.modelCalls,
        durationMs: Date.now() - started,
        events,
      });
    } catch {
      report.results.push({
        id: c.id,
        message: c.message,
        state: 'provider_or_execution_error_not_passed',
        durationMs: Date.now() - started,
        events,
      });
    }
    console.log(`${c.id}: ${report.results.at(-1)?.state}`);
  }
  await fs.writeFile('docs/ASSISTANT_LIVE_EVAL_RESULTS.json', JSON.stringify(report, null, 2) + '\n');
  console.log('Sonuç: docs/ASSISTANT_LIVE_EVAL_RESULTS.json');
}
main().catch(() => {
  console.error('Canlı değerlendirme başlatılamadı; bağlantı/çalıştırma ayarlarını kontrol edin.');
  process.exitCode = 1;
});
