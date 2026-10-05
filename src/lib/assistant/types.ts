import type { PricingInputs } from '../pricing/engine';
import type { VolSurface } from '../vol/surface';
import type { PositionAnalysis } from '../pricing/position-analysis';

export type Product = 'XAU' | 'XAG';
export type OptionType = 'Call' | 'Put';
export type Position = 'Long' | 'Short';
export interface ScreenContext extends PricingInputs {
  product: Product;
  manualSpot: boolean;
  type?: OptionType;
  position?: Position;
  barrier?: OptionRequest['barrier'];
}
export interface MarketSnapshot {
  product: Product;
  spot: number | null;
  spotSource: string;
  spotAt: string | null;
  spotStale?: boolean;
  surface: VolSurface | null;
  surfaceSource: string | null;
  error?: string;
}
export interface OptionRequest {
  product?: Product;
  type: OptionType;
  position: Position;
  strike?: number;
  expiryDate?: string;
  tradeDate?: string;
  contractSize?: number;
  basis?: 360 | 365;
  barrier?: { variant: 'uo' | 'do' | 'ui' | 'di'; level: number; rebate?: number };
}
export interface Quote {
  forward?: number;
  id: string;
  product: Product;
  type: OptionType;
  position: Position;
  inputs: PricingInputs;
  barrier?: OptionRequest['barrier'];
  premiumPerUnit: number;
  premiumTotal: number;
  premiumPctSpot: number;
  premiumPctStrike: number;
  cashflow: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  /** What the bank (the customer's counterparty) trades in the metal to be delta neutral. */
  bankHedge: BankHedge;
  effectiveVol: number;
  volMode: string;
  model: string;
  spotSource: string;
  spotAt: string | null;
  surfaceAt: string | null;
  pricedAt: string;
  warnings: string[];
}
export type PremiumUnit = 'usd_per_unit' | 'total_usd' | 'pct_spot' | 'pct_strike';
export interface SearchResult {
  target: number;
  unit: PremiumUnit;
  tolerance: number;
  reached: boolean;
  candidates: { quote: Quote; actual: number; error: number }[];
  nearest: { quote: Quote; actual: number; error: number } | null;
  evaluations: number;
  unavailable: number;
}
export interface ScenarioResult {
  label: string;
  quotes: Quote[];
  netCashflow: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  bankHedge: BankHedge;
  points: { movePct: number; spot: number; pnl: number }[];
  product: Product;
  horizon: 'expiry' | 'now';
  note: string;
}
export type AssistantArtifact =
  | { kind: 'customers'; matches: { id: string; name: string }[]; truncated: boolean }
  | { kind: 'workspace'; snapshot: WorkspaceSnapshot }
  | { kind: 'position_analysis'; result: PositionAnalysis }
  | { kind: 'quote'; quote: Quote }
  | { kind: 'search'; result: SearchResult }
  | { kind: 'scenarios'; results: ScenarioResult[] }
  | {
      kind: 'collateral_added';
      customer: string;
      asset: 'USD' | 'XAU' | 'XAG';
      amount: number;
      marketValueUsd: number;
      at: string;
    }
  | { kind: 'research'; text: string; sources: { title: string; url: string }[]; searchEntryHtml?: string };
export type AssistantEvent =
  | { type: 'status'; text: string }
  | { type: 'artifact'; artifact: AssistantArtifact }
  | { type: 'text'; text: string }
  | { type: 'error'; text: string }
  | { type: 'done'; modelCalls: number; durationMs: number; model?: string };
export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}
export interface WorkspaceSnapshot {
  area: import('@/lib/workspace').WorkspaceArea;
  observedAt: string;
  customer?: { id: string; name: string };
  trades: {
    id: string;
    customerId: string;
    product: Product | null;
    underlying: string;
    type: OptionType;
    position: Position;
    strike: number;
    expiryDate: string;
    originalTradeDate: string;
    contractSize: number;
    premiumTotal: number;
    entryPremiumPerUnit: number | null;
    status: string;
    barrier: { type: string; level?: number; style?: string; historyRequired: boolean } | null;
  }[];
  totalTrades: number;
  truncated: boolean;
  margin?: import('@/lib/margin/engine').MarginResult & { method: string };
  riskSummary?: {
    customerCount: number;
    openTrades: number;
    cureAmount: number;
    priorities: { customerId: string; name: string; cureAmount: number; status: string; dataWarning?: string }[];
  };
}

/** Explicit direction so no reader has to infer it from a signed number. */
export interface BankHedge {
  side: 'AL' | 'SAT' | 'NÖTR';
  units: number;
  /** How the bank adjusts the hedge as spot moves, from the customer's gamma. */
  rebalance: string;
}
