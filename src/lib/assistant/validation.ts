import type { OptionRequest, ScreenContext } from './types';
import { assertCurvePricing } from './policy';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Nesne biçiminde girdi gerekli.');
  return value as Record<string, unknown>;
}
export function number(value: unknown, name: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${name}: geçerli bir sayı gerekli (${min}–${max}).`);
  return value;
}
export function choice<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (!values.includes(value as T)) throw new Error(`${name}: ${values.join(' / ')} seçilmeli.`);
  return value as T;
}
export function date(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name}: YYYY-MM-DD gerekli.`);
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error(`${name}: tarih geçersiz.`);
  return value;
}
export const products = ['XAU', 'XAG', 'GLD', 'SLV'] as const;

export function validateContext(value: unknown): ScreenContext {
  const o = object(value);
  if (typeof o.manualVol !== 'boolean' || typeof o.manualSpot !== 'boolean') throw new Error('Piyasa veri modu gerekli.');
  if (o.basis !== 360 && o.basis !== 365) throw new Error('Gün bazı 360 veya 365 olmalı.');
  return {
    product: choice(o.product, products, 'Ürün'), spot: number(o.spot, 'Spot', 0.000001, 1e9),
    strike: number(o.strike, 'Strike', 0.000001, 1e9), rate: number(o.rate, 'Faiz', -100, 100),
    lease: number(o.lease, 'Kira', -100, 400), vol: number(o.vol, 'Volatilite', 0.000001, 399.999),
    contractSize: number(o.contractSize, 'Miktar', 0.000001, 1e9), basis: number(o.basis, 'Gün bazı', 360, 365),
    tradeDate: date(o.tradeDate, 'Değerleme tarihi'), expiryDate: date(o.expiryDate, 'Vade'),
    manualVol: o.manualVol, manualSpot: o.manualSpot,
  };
}

export function validateOption(value: unknown): OptionRequest {
  const o = object(value);
  assertCurvePricing(o, { manualSpot: false, manualVol: false } as ScreenContext);
  const request: OptionRequest = {
    type: choice(o.type, ['Call', 'Put'], 'Opsiyon tipi'),
    position: choice(o.position, ['Long', 'Short'], 'Müşteri yönü'),
  };
  const numeric = { strike: [0.000001, 1e9], contractSize: [0.000001, 1e9], basis: [360, 365] } as const;
  for (const field of Object.keys(numeric) as (keyof typeof numeric)[]) {
    if (o[field] !== undefined) Object.assign(request, { [field]: number(o[field], field, ...numeric[field]) });
  }
  if (request.basis !== undefined && request.basis !== 360 && request.basis !== 365) throw new Error('Gün bazı 360 veya 365 olmalı.');
  if (o.product !== undefined) request.product = choice(o.product, products, 'Ürün');
  if (o.tradeDate !== undefined) request.tradeDate = date(o.tradeDate, 'Değerleme tarihi');
  if (o.expiryDate !== undefined) request.expiryDate = date(o.expiryDate, 'Vade');
  if (o.barrier !== undefined) {
    const b = object(o.barrier);
    if (Object.keys(b).some(k => !['variant', 'level', 'rebate'].includes(k))) throw new Error('Tanımlanmamış bariyer fiyatlama alanı.');
    request.barrier = { variant: choice(b.variant, ['uo', 'do', 'ui', 'di'], 'Bariyer tipi'),
      level: number(b.level, 'Bariyer', 0.000001, 1e9), rebate: b.rebate === undefined ? 0 : number(b.rebate, 'Rebate', 0, 1e9) };
  }
  const allowed = new Set(['type', 'position', 'product', 'tradeDate', 'expiryDate', 'barrier', ...Object.keys(numeric)]);
  if (Object.keys(o).some(k => !allowed.has(k))) throw new Error('Tanımlanmamış fiyatlama alanı; dış fiyat/veri girişi kabul edilmez.');
  return request;
}
