import { validateExtractions, MAX_DOCUMENTS_PER_FILE } from './extraction';
import type { InvoiceCompany } from './model';
import { normalizeNumber } from './model';
import { parseQrEvidence } from './qr-evidence';

/** Conservative fast path for text-based FX source documents. Unknown layouts
 * and incomplete pages go to the visual reader, never a partial success. All
 * input is untrusted upload data and still requires the user's confirmation. */
export function reviewPdfText(value: unknown, codes: unknown, companies: Pick<InvoiceCompany, 'id' | 'name'>[]) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_DOCUMENTS_PER_FILE) return null;
  if (value.some(page => typeof page !== 'string' || !page.trim() || page.length > 20000)) return null;
  const qrCodes = Array.isArray(codes) ? codes : [];
  const evidence = qrCodes.map(code => parseQrEvidence([code]));
  const documents: Record<string, unknown>[] = [];
  for (const page of value as string[]) {
    const text = page.replace(/\s+/g, ' ').trim();
    // Only one complete, recognizable receipt per page can take this path.
    if ((text.match(/DÜZENLEYEN YETKİLİ/gu) || []).length !== 1 || (text.match(/Belge No/gu) || []).length !== 1)
      return null;
    const issuerName = /DÜZENLEYEN YETKİLİ\s+(.+?(?:A\.\s*Ş\.|AŞ|LTD\.\s*ŞTİ\.))(?=\s)/u.exec(text)?.[1];
    const counterpartyName = /(?:SATAN|ALAN) KİŞİ\s*\/\s*KURULUŞ\s+(.+?(?:A\.\s*Ş\.|AŞ|LTD\.\s*ŞTİ\.))(?=\s|[-])/u.exec(
      text,
    )?.[1];
    const number = /Belge No\s+([A-Z0-9]{10,30})(?=\s)/u.exec(text)?.[1];
    const date = /Oluşturma Tarihi\s+(\d{2})-(\d{2})-(\d{4})/u.exec(text);
    const foreignAmountText = /Döviz\s*\/\s*Kıymetli Maden Miktarı\s+([\d.,]+)/u.exec(text)?.[1];
    const foreignCurrency = /Döviz\s*\/\s*Kıymetli Maden Cinsi\s+([A-Z]{3})(?=\s)/u.exec(text)?.[1];
    const exchangeRate = /Uygulanan Kur\s+(\d+(?:[.,]\d{1,8})?)(?=\s)/u.exec(text)?.[1];
    const tlAmountText = /TL Karşılığı\s+([\d.,]+)\s*TL/u.exec(text)?.[1];
    if (
      !text.includes('EDOVIZBELGE') ||
      !issuerName ||
      !counterpartyName ||
      !number ||
      !date ||
      !foreignAmountText ||
      !foreignCurrency ||
      !exchangeRate ||
      !tlAmountText
    )
      return null;
    const matching = evidence.filter(q => q.number && normalizeNumber(q.number) === normalizeNumber(number));
    if (
      !matching.length ||
      matching.some(q => q.conflict || q.rateIssue === 'mismatch' || !q.date || !q.amountCents || !q.currency)
    )
      return null;
    documents.push({
      documentType: 'foreign_exchange',
      issuerName,
      counterpartyName,
      number,
      date: `${date[3]}-${date[2]}-${date[1]}`,
      foreignAmountText,
      foreignCurrency,
      exchangeRate,
      tlAmountText,
      multipleDocuments: false,
      warnings: ['PDF metni ve QR bilgisi karşılaştırıldı. Kaydetmeden önce kaynak firmayı ve belgeyi kontrol et.'],
    });
  }
  const numbers = new Set(documents.map(d => normalizeNumber(String(d.number))));
  if (numbers.size !== documents.length || evidence.some(q => q.number && !numbers.has(normalizeNumber(q.number))))
    return null;
  try {
    const results = validateExtractions({ documents, hasMoreDocuments: false }, companies, codes);
    if (
      results.some(
        r =>
          !r.companyId || !r.number || !r.date || !r.currency || !r.amountCents || r.document.qrStatus === 'conflict',
      )
    )
      return null;
    return results;
  } catch {
    return null;
  }
}
