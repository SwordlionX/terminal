# Two designs, one European position engine

The main pricing page now has two complete presentations: Terminal (charcoal/amber, compact ticket and risk desk) and Meridian (ivory/purple, horizontal ticket and larger quote). Both use the same engine, sources and analysis components. Only `src/lib/terminal-design.ts` differs between `codex/terminal-bloomberg-v1` and `codex/terminal-meridian-v1`.

## Included

- Equal prominence for total USD premium and percentage of spot nominal, including assistant quote cards.
- Full-width smile and ATM volatility term view with source expiry selection.
- `/pricing/position-analysis`: up to eight editable vanilla legs, historical execution premiums, combined P/L, price/date heatmap, delta/gamma maps and theoretical expiry limits.
- Hedge, matched opposite transactions and opposite transactions plus a new expiry compared on the same horizon and nominal denominator. Added transactions show their own premium cash flow; historical receipts are not collected twice.
- Assistant `analyze_position` tool generates the same deterministic result card. The full grid is sent to the UI; a smaller summary is returned to the model to avoid repeated large prompts.
- Sidebar, footer, assistant launcher, panel and cards follow the selected palette. Applying an assistant quote preserves Call/Put and customer Long/Short selection.

## Financial scope

European exercise is at expiry. The comparison neither exercises nor terminates existing contracts. Matched opposite trades do not remove original contractual obligations, collateral or counterparty risk. New maturity means new legs. There is no open-interest density or inferred dealer GEX feature.

Prices use the existing terminal spot and surface through `quoteOption` and `calculatePricing`. New screens and tools block manual market overrides. Historical execution premium is a cash-flow reference, not an IV, interest or carry override. Scenario calculations run locally and never research outside quotes.

The future map holds the existing dated surface and rate/carry assumptions; it is not a future curve forecast. Missing smile coverage remains an empty cell. Expiry cells use intrinsic payoff and suppress expiry Greeks. Mixed expiries stop at the earliest expiry so previous settlement is not recomputed using a later spot. Common-expiry limits are calculated piecewise over all S >= 0, not estimated from the plotted shock range. All directions are from the customer's perspective. Percentages use spot times the original reference quantity, not invested collateral. Funding, fees, spread and settlement costs are excluded.

**USD discount-curve construction and the audited metal carry/maturity correction are not implemented by this change.** The new screens say so explicitly. Existing stored rate and carry metadata remain the inputs; this is indicative analysis, not an approved bank lease curve or executable bank quote. Source timestamps and source warnings remain visible.

## Verification

- 136 automated tests passed with `node --test --test-concurrency=2 tests/*.test.cjs`, including 14 position-analysis tests using the actual shared engine.
- Tests cover unlimited short-call vs bounded short-put risk, protected and unequal-quantity structures, historical premium preservation on offset, time value before expiry, expiry intrinsic payoff, mixed maturities, percentage denominator, immutable inputs, rejected manual overrides and missing coverage.
- Assistant tool tested with a cached market fixture and no provider/research calls. This does not claim a new live Gemini end-to-end evaluation.
- TypeScript, ESLint and production build checked. Visual inspection uses the application's real stored-data feed, not synthetic pricing data.
- This development pass makes no Gemini generation calls or Databento downloads and submits no client orders or customer trade writes.

Run each branch in a separate checkout when previewing both together. Do not share `.next` between running builds. Secrets belong in ignored local/Vercel configuration, never in Git.
