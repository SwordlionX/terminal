export const INITIAL_COMPANIES = [
  ['albayrak', 'Albayrak'],
  ['cizgi', 'Çizgi'],
  ['tempo', 'Tempo'],
  ['aliyuce', 'Aliyüce'],
  ['kalender', 'Kalender'],
  ['elve', 'Elve'],
  ['rezerv', 'Rezerv'],
  ['celebi', 'Çelebi'],
  ['zirve', 'Zirve'],
  ['cakmakci', 'Çakmakçı'],
] as const;

export interface InvoiceAccount {
  id: string;
  name: string;
  role: 'admin' | 'member';
  active: boolean;
}
export interface InvoiceCompany {
  id: string;
  name: string;
  sortOrder: number;
  totalCents: number;
  usedCents: number;
  remainingCents: number;
  openCount: number;
  invoiceCount: number;
}
export interface Invoice {
  id: string;
  companyId: string;
  companyName: string;
  number: string;
  date: string;
  amountCents: number;
  usedCents: number;
  remainingCents: number;
  version: number;
  status: 'unused' | 'partial' | 'closed';
  updatedAt: string;
}
export interface InvoiceEvent {
  id: string;
  invoiceId: string;
  deltaCents: number;
  date: string;
  note: string;
  accountName: string;
  createdAt: string;
  reversalOf: string | null;
  reversed: boolean;
}
export interface InvoiceSnapshot {
  companies: InvoiceCompany[];
  invoices: Invoice[];
  total: number;
  totals: { amountCents: number; usedCents: number; remainingCents: number; openCount: number };
}
export const STATUS_LABELS = {
  unused: 'Kullanılmamış',
  partial: 'Kısmen kullanılmış',
  closed: 'Tamamı kullanılmış',
} as const;
export function formatMoney(cents: number) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(cents / 100);
}
export function todayInTurkey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function parseMoney(value: string): number {
  const input = value.trim();
  // Turkish input: 1.250,50 or 1250,50. A decimal dot is also accepted without grouping.
  let normalized: string;
  if (input.includes(',')) {
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(input)) throw new Error('Tutarı 1.250,50 biçiminde gir.');
    normalized = input.replaceAll('.', '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(input)) normalized = input.replaceAll('.', '');
  else if (/^\d+(?:\.\d{1,2})?$/.test(input)) normalized = input;
  else throw new Error('Geçerli bir tutar gir.');
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents > 999_999_999_999_99) throw new Error('Tutar çok büyük.');
  return cents;
}

export class InvoiceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvoiceError('İstek geçersiz.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f]/.test(value))
    throw new InvoiceError(`${label} gerekli (en fazla ${max} karakter).`);
  return value.trim();
}
export function cents(value: unknown, allowZero = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > 999_999_999_999_99
  )
    throw new InvoiceError('Tutar geçersiz.');
  return value;
}
export function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31')
    throw new InvoiceError('Tarih geçersiz.');
  const parsed = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new InvoiceError('Tarih geçersiz.');
  return value;
}
export function pin(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) throw new InvoiceError('Hesap kodu tam 4 rakam olmalı.');
  return value;
}
export const normalizeNumber = (number: string) =>
  number.normalize('NFKC').replace(/\s+/g, '').toUpperCase().replaceAll('İ', 'I');

export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
