import fs from 'node:fs/promises';
import { calculatePricing } from '../src/lib/pricing/engine';
import { quoteOption } from '../src/lib/assistant/pricing';
import { searchPremium } from '../src/lib/assistant/search';
import { scenarioPortfolio } from '../src/lib/assistant/scenarios';
import type { Product, ScreenContext } from '../src/lib/assistant/types';

/** Terminal services only; no Gemini calls, external quotes or manual curve overrides. */
async function main() {
  if (!process.argv.includes('--live')) {
    console.log('Canlı veri kontrolü: npx tsx scripts/validate-terminal-live.ts --live');
    return;
  }
  try {
    process.loadEnvFile('.env.local');
  } catch {
    /* Hosted environment may supply these. */
  }
  const configured = Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
  const report = {
    at: new Date().toISOString(),
    terminalDatabaseConfigured: configured,
    scope:
      'Terminalin mevcut servisleri ve kayıtlı eğrisiyle bağlantı/hesap aktarımı kontrolü. Bağımsız piyasa kotasyonu veya faiz/kira kalibrasyonu doğrulaması değildir.',
    calibrationStatus: 'unverified_known_rate_lease_audit_findings',
    products: [] as Record<string, unknown>[],
  };
  if (!configured) {
    report.products.push({ state: 'blocked_missing_terminal_database', pricingValidated: false });
  } else {
    const { terminalMarket } = await import('../src/lib/assistant/market');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    for (const product of ['XAU', 'XAG'] as Product[]) {
      try {
        const market = await terminalMarket(product);
        const surface = market.surface;
        if (
          !surface ||
          !market.spot ||
          !Number.isFinite(surface.builtWithR) ||
          !Number.isFinite(surface.impliedLeaseRate)
        ) {
          report.products.push({
            product,
            state: 'blocked_missing_terminal_curve_inputs',
            pricingValidated: false,
            hasSpot: Boolean(market.spot),
            hasSurface: Boolean(surface),
            hasRate: Number.isFinite(surface?.builtWithR),
            hasLease: Number.isFinite(surface?.impliedLeaseRate),
            surfaceAt: surface?.fetchedISO ?? null,
          });
          continue;
        }
        const expiryDate = surface.expiries
          .map(e => e.date)
          .filter(d => d > today)
          .sort()[0];
        if (!expiryDate) throw new Error('İleri vadeli terminal eğrisi bulunamadı.');
        const context: ScreenContext = {
          product,
          spot: market.spot,
          strike: market.spot,
          rate: surface.builtWithR! * 100,
          lease: surface.impliedLeaseRate! * 100,
          vol: 0,
          manualSpot: false,
          manualVol: false,
          contractSize: 1,
          basis: 365,
          tradeDate: today,
          expiryDate,
        };
        const put = quoteOption({ type: 'Put', position: 'Short' }, context, market);
        const call = quoteOption({ type: 'Call', position: 'Long' }, context, market);
        const screen = calculatePricing(context, surface);
        const equal = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
        const engineAgreement =
          screen.priceable &&
          equal(put.premiumPerUnit, screen.result.put) &&
          equal(call.premiumPerUnit, screen.result.call);
        const search = searchPremium(
          k => quoteOption({ type: 'Put', position: 'Short', strike: k }, context, market),
          put.premiumPctSpot,
          'pct_spot',
          market.spot * 0.8,
          market.spot * 1.2,
          0.00001,
        );
        const expiry = scenarioPortfolio('Canlı aktarım kontrolü', [put], 'expiry');
        let nowState = 'passed';
        try {
          scenarioPortfolio('Canlı eğri spot şoku', [put], 'now', [], surface);
        } catch {
          nowState = 'blocked_curve_does_not_support_all_shocks';
        }
        report.products.push({
          product,
          state: engineAgreement && search.reached ? 'engine_wiring_checks_passed' : 'checks_failed',
          engineAgreement,
          targetSearchReached: search.reached,
          expiryScenarioPoints: expiry.points.length,
          nowScenario: nowState,
          surfaceAt: put.surfaceAt,
          spotAt: put.spotAt,
          spotSource: put.spotSource,
          expiryDate,
          warnings: put.warnings,
          rateLeaseCalibrationValidated: false,
        });
      } catch {
        report.products.push({
          product,
          state: 'terminal_data_or_execution_error_not_passed',
          pricingValidated: false,
        });
      }
    }
  }
  await fs.writeFile('docs/TERMINAL_LIVE_VALIDATION.json', JSON.stringify(report, null, 2) + '\n');
  for (const row of report.products) console.log(`${row.product ?? 'Terminal'}: ${row.state}`);
  console.log('Kayıt: docs/TERMINAL_LIVE_VALIDATION.json');
  if (report.products.some(p => p.state !== 'engine_wiring_checks_passed')) process.exitCode = 1;
}
main().catch(() => {
  console.error('Canlı kontrol tamamlanamadı; bağlantı ayarlarını kontrol edin.');
  process.exitCode = 1;
});
