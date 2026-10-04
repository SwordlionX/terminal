import type { Trade } from '@/types';
import type { AnalysisLeg } from '@/lib/pricing/position-analysis';
export type WorkspaceArea = 'pricing' | 'positions' | 'customers' | 'risk' | 'curves';
export interface WorkspaceSelection {
  area: WorkspaceArea;
  customerId?: string;
  tradeIds?: string[];
}
export function workspaceArea(path: string): WorkspaceArea {
  if (path.startsWith('/customers')) return 'customers';
  if (['/margin', '/dashboard'].includes(path)) return 'risk';
  if (['/trades', '/archive', '/pricing/position-analysis'].includes(path)) return 'positions';
  if (['/curves', '/settings'].includes(path)) return 'curves';
  return 'pricing';
}
export const areaLabels: Record<WorkspaceArea, string> = {
  pricing: 'Fiyatlama',
  positions: 'Pozisyonlar',
  customers: 'Müşteri dosyası',
  risk: 'Risk ve teminat',
  curves: 'Eğriler ve veri',
};
export function metalProduct(underlying: string): 'XAU' | 'XAG' | null {
  const p = underlying.toUpperCase();
  return p === 'XAU' || p === 'XAU/USD' ? 'XAU' : p === 'XAG' || p === 'XAG/USD' ? 'XAG' : null;
}
export function activeTrade(trade: Trade) {
  return trade.status === 'Open' || trade.status === 'Near Expiry';
}
export function tradeLeg(trade: Trade): AnalysisLeg {
  const product = metalProduct(trade.underlying);
  if (!product || trade.barrierType || !(trade.contractSize > 0) || !(trade.strike > 0) || !(trade.premium >= 0))
    throw new Error(
      'Bu kayıt vanilya metal pozisyon analizine uygun değil. Bariyerli kayıtlar geçmiş gözlem gerektirir.',
    );
  return {
    option: {
      product,
      type: trade.type,
      position: trade.position,
      strike: trade.strike,
      expiryDate: trade.expiryDate.slice(0, 10),
      contractSize: trade.contractSize,
    },
    entryPremiumPerUnit: trade.premium / trade.contractSize,
  };
}
export function validateWorkspace(value: unknown): WorkspaceSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Çalışma alanı seçimi geçersiz.');
  const o = value as Record<string, unknown>;
  if (!['pricing', 'positions', 'customers', 'risk', 'curves'].includes(String(o.area)))
    throw new Error('Çalışma alanı geçersiz.');
  const id = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
  if (o.customerId !== undefined && !id(o.customerId)) throw new Error('Müşteri seçimi geçersiz.');
  if (
    o.tradeIds !== undefined &&
    (!Array.isArray(o.tradeIds) ||
      o.tradeIds.length > 8 ||
      !o.tradeIds.every(id) ||
      new Set(o.tradeIds).size !== o.tradeIds.length)
  )
    throw new Error('En fazla sekiz farklı işlem seçilebilir.');
  if (Object.keys(o).some(k => !['area', 'customerId', 'tradeIds'].includes(k)))
    throw new Error('Çalışma alanı yalnız kayıt kimliklerini kabul eder.');
  return {
    area: o.area as WorkspaceArea,
    customerId: o.customerId as string | undefined,
    tradeIds: o.tradeIds as string[] | undefined,
  };
}
