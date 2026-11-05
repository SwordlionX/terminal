import { currency, date, normalizeNumber, parseMoney, InvoiceError } from './model';

export interface QrEvidence {
  number: string | null;
  date: string | null;
  currency: string | null;
  amountCents: number | null;
  foreignCurrency: string | null;
  foreignAmountCents: number | null;
  tlAmountCents: number | null;
  exchangeRate: string | null;
  documentType: 'foreign_exchange' | 'invoice';
  conflict: boolean;
  hasData: boolean;
  hasLink: boolean;
  warnings: string[];
}
export function parseQrEvidence(codes: unknown): QrEvidence {
  const result: QrEvidence = {
    number: null,
    date: null,
    currency: null,
    amountCents: null,
    foreignCurrency: null,
    foreignAmountCents: null,
    tlAmountCents: null,
    exchangeRate: null,
    documentType: 'invoice',
    conflict: false,
    hasData: false,
    hasLink: false,
    warnings: [],
  };
  if (codes == null) return result;
  if (!Array.isArray(codes) || codes.length > 4 || codes.some(s => typeof s !== 'string' || s.length > 4096))
    throw new InvoiceError('QR bilgisi geçersiz.');
  const readAmount = (v: unknown) => {
    try {
      if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
      return typeof v === 'string' ? parseMoney(v) : null;
    } catch {
      return null;
    }
  };
  for (const code of codes as string[]) {
    if (/^https?:\/\//i.test(code)) {
      result.hasLink = true;
      continue;
    } // Never follow document QR links.
    let b: Record<string, unknown>;
    try {
      const raw = JSON.parse(code);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      b = raw;
    } catch {
      continue;
    }
    const num = typeof b.no === 'string' ? b.no : typeof b.faturano === 'string' ? b.faturano : null;
    if (!num || num.length > 100) continue;
    if (result.number && normalizeNumber(result.number) !== normalizeNumber(num)) {
      result.conflict = true;
      continue;
    }
    const fx = String(b.senaryo || '')
      .toUpperCase()
      .includes('DOVIZ');
    let unit: string | null = null,
      amount: number | null = null;
    if (fx) {
      const keys = Object.keys(b).filter(k => /^miktari\([A-Z]{3}\)$/i.test(k));
      if (keys.length === 1) {
        try {
          unit = currency(keys[0].slice(8, -1).toUpperCase());
          amount = readAmount(b[keys[0]]);
        } catch {
          result.warnings.push('QR içindeki döviz para birimi desteklenmiyor.');
        }
      }
      result.documentType = 'foreign_exchange';
      result.foreignCurrency = unit;
      result.foreignAmountCents = amount;
      result.tlAmountCents = readAmount(b['odenecek(TRY)'] ?? b.tlkarsiligi);
      if (typeof b.uygulanankur === 'string' && /^\d+(?:[.,]\d{1,8})?$/.test(b.uygulanankur))
        result.exchangeRate = b.uygulanankur.replace(',', '.');
    } else {
      const key = Object.keys(b).find(k => /^odenecek\([A-Z]{3}\)$/i.test(k));
      try {
        unit = currency(key ? key.slice(9, -1).toUpperCase() : String(b.parabirimi || b.currency || ''));
      } catch {
        /* unknown stays blank */
      }
      amount = readAmount(key ? b[key] : b.odenecek);
    }
    if (result.amountCents !== null && amount !== null && (result.amountCents !== amount || result.currency !== unit)) {
      result.conflict = true;
      continue;
    }
    result.number = num.trim();
    result.currency = unit;
    result.amountCents = amount;
    result.hasData = true;
    try {
      result.date = date(b.tarih);
    } catch {
      /* not invented */
    }
  }
  if (result.conflict)
    result.warnings.push(
      'Dosyada farklı belge numarası veya tutarı taşıyan QR bilgileri var. Alanları belgeye bakarak elle doğrula.',
    );
  if (
    result.documentType === 'foreign_exchange' &&
    result.foreignAmountCents !== null &&
    result.tlAmountCents !== null &&
    result.exchangeRate
  ) {
    const [whole, fraction = ''] = result.exchangeRate.split('.'),
      divisor = BigInt(10) ** BigInt(fraction.length),
      rate = BigInt(whole + fraction);
    const rounded = (BigInt(result.foreignAmountCents) * rate * BigInt(2) + divisor) / (BigInt(2) * divisor);
    if (rounded > BigInt(Number.MAX_SAFE_INTEGER) || Math.abs(Number(rounded) - result.tlAmountCents) > 1) {
      result.conflict = true;
      result.warnings.push('QR içindeki döviz miktarı × kur, TL karşılığıyla uyuşmuyor.');
    }
  }
  return result;
}
