/* eslint-disable @typescript-eslint/no-require-imports -- Node financial regression tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function modules(overrides = {}) {
  const cache = new Map();
  function load(file) {
    const full = path.resolve(__dirname, '..', file);
    if (cache.has(full)) return cache.get(full).exports;
    const mod = { exports: {} }; cache.set(full, mod);
    const output = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    vm.runInNewContext(output, { module: mod, exports: mod.exports, console, process: { env: {} }, require(id) {
      if (Object.hasOwn(overrides, id)) return overrides[id];
      let target = path.resolve(path.dirname(full), id);
      target += fs.existsSync(target + '.ts') ? '.ts' : '/index.ts';
      return load(target);
    } });
    return mod.exports;
  } return load;
}
const load = modules();
const { factorAt, curveFactors } = load('src/lib/market/factors.ts');
const { projectSofr, sofrBusinessDay } = load('src/lib/market/sofr.ts');
const { buildProxyCurves, inDeliveryPeriod } = load('src/lib/market/proxy-curves.ts');
const { calculatePricing } = load('src/lib/pricing/engine.ts');
const math = load('src/lib/math/american.ts');
const { rebasedExpiryDays } = load('src/lib/vol/surface.ts');
const DAY = 86400000, start = Date.parse('2026-10-01T00:00:00Z');
const iso = ms => new Date(ms).toISOString();
const close = (a, b, tol = 1e-10) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const month = (m, rate) => ({ instrumentId: `sr1-${m}`, lastTradeTime: `${m}-28T18:00:00Z`, settlement: 100 - rate * 100 });
const fixings = [{ date: '2026-09-30', rate: .04 }];
function fixture() {
  const usd = projectSofr('2026-10-01', [month('2026-10', .04), month('2026-11', .05), month('2026-12', .06)], fixings, 90);
  // Contracts outside their delivery period (first notice for November is 30 October).
  const nodes = [35, 50, 75].map((days, i) => ({ instrumentId: `gc-${i}`, lastTradeTime: iso(start + days * DAY), settlement: 100 + i, flags: 3 }));
  const snapshot = { sessionDate: '2026-10-01', products: { GC: { nodes } } };
  const curves = buildProxyCurves(snapshot, 'GC', usd, { price: 100, at: iso(start + 17.5 / 24 * DAY), source: 'Tiingo matched settlement proxy' }, 'test');
  const expiries = [20, 45, 75].map(days => ({ days: days - 17.5 / 24, date: iso(start + days * DAY).slice(0, 10), expiryAt: iso(start + days * DAY),
    underlyingId: 'gc-1', underlyingLastTradeTime: nodes[1].lastTradeTime, points: [.8, 1, 1.2].map(m => ({ m, iv: .25 })) }));
  const surface = { symbol: 'XAU', fetchedISO: curves.asOf, spot: 100, curves, expiries };
  const input = { spot: 100, strike: 102, rate: 5, lease: 1, vol: 20, manualSpot: false, manualVol: false,
    contractSize: 10, basis: 365, tradeDate: '2026-10-04', expiryDate: '2026-11-15' };
  return { usd, snapshot, curves, surface, input };
}
test('SR1 averages reconstruct after known fixings; Friday accrues simply over the weekend', () => {
  const p = projectSofr('2026-10-01', [month('2026-10', .04)], fixings, 7);
  close(p.months[0].expectedAverage, p.months[0].reconstructedAverage);
  const friday = Date.parse('2026-10-02T00:00:00Z'), monday = friday + 3 * DAY;
  close(factorAt(p.nodes, monday) / factorAt(p.nodes, friday), 1 / (1 + .04 * 3 / 360));
  const past = [...fixings];
  for (let t = start; t < Date.parse('2026-10-15'); t += DAY) {
    const date = iso(t).slice(0, 10); if (sofrBusinessDay(date)) past.push({ date, rate: .04 });
  }
  const partial = projectSofr('2026-10-15', [month('2026-10', .05)], past, 7);
  close(partial.months[0].reconstructedAverage, .05);
  assert.ok(partial.months[0].projectedOvernight > .05);
});
test('SOFR month boundary preserves prior Friday fixing when next month starts on Sunday', () => {
  const p = projectSofr('2026-10-01', [month('2026-10', .04), month('2026-11', .05)], fixings, 61);
  close(p.months[1].projectedOvernight, (.05 * 30 - .04) / 29);
  for (const m of p.months) close(m.reconstructedAverage, m.expectedAverage);
});
test('SOFR holiday calendar and missing/duplicate inputs fail without inventing a rate', () => {
  assert.equal(sofrBusinessDay('2026-04-03'), false);
  assert.equal(sofrBusinessDay('2026-07-03'), false);
  assert.equal(sofrBusinessDay('2026-11-27'), true);
  assert.throws(() => projectSofr('2026-10-01', [], fixings, 10), /SR1/);
  assert.throws(() => projectSofr('2026-10-15', [month('2026-10', .04)], fixings, 5), /fixing eksik/);
  assert.throws(() => projectSofr('2026-10-01', [month('2026-10', .04)], [...fixings, ...fixings], 5), /yinelenmiş/);
});
test('factor interpolation is log-linear, retains negative carrying rates, and never extrapolates', () => {
  const nodes = [{ at: iso(start), value: 1 }, { at: iso(start + 10 * DAY), value: 1.01 }];
  close(factorAt(nodes, start + 5 * DAY), Math.sqrt(1.01));
  assert.equal(factorAt(nodes, start - 1), null);
  assert.equal(factorAt([...nodes, { at: iso(start + 11 * DAY), value: NaN }], start), null);
  const curve = { version: 2, usd: nodes, metal: nodes };
  assert.ok(curveFactors(curve, start, start + 10 * DAY).lease365 < 0);
});
test('metal nodes reproduce each futures price on its own real last-trade timestamp', () => {
  const f = fixture();
  for (const n of f.snapshot.products.GC.nodes) {
    const x = curveFactors(f.curves, Date.parse(f.curves.asOf), Date.parse(n.lastTradeTime));
    close(f.curves.referenceSpot.price * x.forwardRatio, n.settlement);
  }
  // Same price on a different contract must retain a separate time node.
  f.snapshot.products.GC.nodes[1].settlement = f.snapshot.products.GC.nodes[0].settlement;
  const c = buildProxyCurves(f.snapshot, 'GC', f.usd, f.curves.referenceSpot, 'test');
  assert.equal(c.metal.length, 4);
  const before = JSON.stringify(c.metal);
  f.snapshot.options = [{ expiry: '2026-10-09', underlyingId: 'gc-0' }];
  assert.equal(JSON.stringify(buildProxyCurves(f.snapshot, 'GC', f.usd, f.curves.referenceSpot, 'test').metal), before);
  f.snapshot.products.GC.nodes[1].flags = 2;
  assert.throws(() => buildProxyCurves(f.snapshot, 'GC', f.usd, f.curves.referenceSpot, 'test'), /final/);
});
test('a contract in its delivery period trades at spot and is not used as a carry node', () => {
  const f = fixture();
  // October contract on 1 October: first notice (30 September) has passed.
  assert.equal(inDeliveryPeriod('2026-10-28T17:30:00Z', '2026-10-01'), true);
  assert.equal(inDeliveryPeriod('2026-11-25T17:30:00Z', '2026-10-01'), false);
  // First notice is the last business day before the contract month (Friday 30 October 2026).
  assert.equal(inDeliveryPeriod('2026-11-25T17:30:00Z', '2026-10-30'), true);
  const spotLike = { instrumentId: 'gc-oct', lastTradeTime: '2026-10-28T17:30:00Z', settlement: 100, flags: 3 };
  f.snapshot.products.GC.nodes.unshift(spotLike);
  const c = buildProxyCurves(f.snapshot, 'GC', f.usd, f.curves.referenceSpot, 'test');
  assert.equal(JSON.stringify(c.metal), JSON.stringify(f.curves.metal));
});
test('curve prices obey put-call parity; basis and manual rate/lease fields cannot change premiums', () => {
  const { input, surface } = fixture(), p = calculatePricing(input, surface);
  assert.equal(p.priceable, true);
  close(p.result.call - p.result.put, input.spot * p.metalFactor - input.strike * p.discountFactor, 1e-8);
  const other = calculatePricing({ ...input, basis: 360, rate: 99, lease: -99 }, surface);
  close(other.result.call, p.result.call); close(other.fwd, p.fwd); close(other.effVol, p.effVol);
  close(other.displayRate / p.displayRate, 360 / 365);
  close(other.gr.call.theta, p.gr.call.theta);
});
test('manual market overrides, missing USD/metal coverage, and stale snapshot dates block pricing', () => {
  const { input, surface } = fixture();
  for (const override of [{ manualVol: true }, { manualSpot: true }, { tradeDate: '2026-09-30' }, { expiryDate: '2027-01-01' }])
    assert.equal(calculatePricing({ ...input, ...override }, surface).priceable, false);
  assert.equal(calculatePricing({ ...input, manualVol: true }, null).priceable, false);
});
test('option expiry hour ages separately from the settlement reference and futures last trade', () => {
  const { surface } = fixture(), expiry = surface.expiries[0];
  const t = Date.parse(expiry.expiryAt);
  close(rebasedExpiryDays(surface, expiry, '2026-10-04'), (t - Date.parse('2026-10-04')) / DAY);
});
test('assistant and multi-date European hedge analysis use the same dated factors as screen pricing', () => {
  const { input, surface } = fixture();
  const screen = { ...input, product: 'XAU' }, market = { product: 'XAU', spot: input.spot,
    spotSource: 'terminal', spotAt: '2026-10-04T00:00:00Z', surfaceSource: 'cme', surface };
  const { quoteOption } = load('src/lib/assistant/pricing.ts');
  const { analyzeEuropeanPosition } = load('src/lib/pricing/position-analysis.ts');
  const request = { product: 'XAU', type: 'Put', position: 'Short', strike: input.strike,
    expiryDate: input.expiryDate, contractSize: 10 };
  const q = quoteOption(request, screen, market), p = calculatePricing(input, surface);
  close(q.premiumPerUnit, p.result.put); close(q.forward, p.fwd);
  const analysis = analyzeEuropeanPosition(screen, market, [{ option: request }], 'test',
    ['2026-10-04', '2026-10-18', '2026-11-15'], [-4, 0, 4]);
  assert.equal(analysis.missingCells, 0);
  close(analysis.rows[1].cells[0].pnl, 0);
  const rolled = calculatePricing({ ...input, tradeDate: '2026-10-18' }, surface);
  close(analysis.rows[1].cells[1].pnl, (p.result.put - rolled.result.put) * 10);
  assert.ok(q.warnings.some(w => w.includes('banka metal kira')));
});
test('curve-discounted American futures options match the flat-rate solver and invert quotes', () => {
  const T = .5, r = .05, discounts = Array.from({ length: 73 }, (_, i) => Math.exp(-r * T * i / 72));
  for (const type of ['call', 'put']) {
    const p = math.americanFutureCurvePrice(100, 105, T, discounts, .3, type);
    close(p, math.americanPrice(100, 105, T, r, r, .3, type, 72), 1e-9);
    const iv = math.impliedVolAmericanFutureCurve(100, 105, T, discounts, p, type);
    assert.equal(iv.ok, true); close(iv.vol, .3, 1e-6);
  }
  assert.ok(Number.isNaN(math.americanFutureCurvePrice(100, 100, T, discounts, .3, 'bad')));
});
test('American exercise uses the discount path, not only the final equivalent rate', () => {
  const flat = Array.from({ length: 73 }, (_, i) => Math.exp(-.1 * i / 72));
  const bent = flat.map((d, i) => d * Math.exp(-.1 * Math.sin(Math.PI * i / 72)));
  close(flat.at(-1), bent.at(-1));
  const a = math.americanFutureCurvePrice(100, 80, 1, flat, .25, 'call');
  const b = math.americanFutureCurvePrice(100, 80, 1, bent, .25, 'call');
  assert.ok(Math.abs(a - b) > .01);
});
test('bundle validation rejects a half-update or a mismatched USD session', () => {
  const { usd, surface } = fixture();
  const { validatePricingBundle } = modules({ '../lib/db': {} })('src/services/pricing-bundle.service.ts');
  const bundle = { version: 2, id: 'test', sessionDate: '2026-10-01', usd,
    surfaces: { XAU: surface, XAG: { ...surface, symbol: 'XAG' } } };
  validatePricingBundle(bundle);
  assert.throws(() => validatePricingBundle({ ...bundle, surfaces: { XAU: surface } }), /aynı geçerli/);
  assert.throws(() => validatePricingBundle({ ...bundle, id: 'other' }), /aynı geçerli/);
  assert.throws(() => validatePricingBundle({ ...bundle, sessionDate: '2026-10-02' }), /USD/);
});
test('missing bundle or database failure cannot become a default 5% interest rate', async () => {
  for (const loadPricingBundle of [async () => null, async () => { throw new Error('database unavailable'); }]) {
    const service = modules({ './pricing-bundle.service': { loadPricingBundle } })('src/services/market.service.ts');
    await assert.rejects(service.getInterestRate());
    await assert.rejects(service.setInterestRate(.05), /Manuel faiz/);
  }
});
test('metal pricing has no fallback when the verified bundle is missing', async () => {
  const service = modules({ './pricing-bundle.service': { loadPricingBundle: async () => null } })('src/services/market.service.ts');
  await assert.rejects(service.getSurface('XAU'), /birlikte kurulmalı/);
  await assert.rejects(service.getSurface('GLD'), /Yalnız XAU ve XAG/);
});
