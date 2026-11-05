import { InvoiceError, cents, date, object, text } from './model';
import type { InvoiceCompany } from './model';

export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
export function documentMime(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  throw new InvoiceError('PDF, JPEG, PNG veya WebP dosyası yükle.');
}
function companyKey(name: string) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('ı', 'i')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
export function validateExtraction(value: unknown, companies: Pick<InvoiceCompany, 'id' | 'name'>[]) {
  const b = object(value),
    warnings: string[] = [];
  const read = (key: string, max = 100) => (b[key] == null || b[key] === '' ? null : text(b[key], key, max));
  const companyName = read('companyName', 250),
    number = read('number'),
    currency = read('currency', 12)?.toUpperCase() || null;
  let invoiceDate: string | null = null,
    amountCents: number | null = null;
  try {
    if (b.date != null) invoiceDate = date(b.date);
  } catch {
    warnings.push('Belgedeki tarih doğrulanamadı. Fatura tarihini elle gir.');
  }
  try {
    if (b.amountCents != null) amountCents = cents(b.amountCents);
  } catch {
    warnings.push('Belgedeki toplam tutar doğrulanamadı. Tutarı elle gir.');
  }
  if (currency && !['TRY', 'TL', 'TRL'].includes(currency)) {
    amountCents = null;
    warnings.push(`Belge para birimi ${currency}. Bu uygulama TL kaydı tutar; TL tutarını kontrol edip elle gir.`);
  }
  if (!currency) {
    amountCents = null;
    warnings.push('Belgenin para birimi okunamadı. TL tutarını kontrol edip elle gir.');
  }
  const key = companyName ? companyKey(companyName) : '';
  // Prefix matches must start at the seller name, and exactly one company must match.
  const matches = key
    ? companies.filter(c => {
        const candidate = companyKey(c.name);
        return candidate === key || key.startsWith(candidate + ' ');
      })
    : [];
  const companyId = matches.length === 1 ? matches[0].id : null;
  if (!companyId) warnings.push('Belgedeki satıcı firma otomatik eşleştirilemedi. Firmayı seç.');
  if (!number) warnings.push('Fatura numarası okunamadı. Belgeden kontrol ederek gir.');
  if (!invoiceDate && !warnings.some(w => w.includes('tarih'))) warnings.push('Fatura tarihi okunamadı.');
  if (amountCents === null && !warnings.some(w => w.includes('tutar'))) warnings.push('Fatura toplamı okunamadı.');
  if (Array.isArray(b.warnings))
    for (const w of b.warnings.slice(0, 6)) if (typeof w === 'string' && w.length <= 300) warnings.push(w);
  return { companyName, companyId, number, date: invoiceDate, amountCents, currency, warnings };
}
