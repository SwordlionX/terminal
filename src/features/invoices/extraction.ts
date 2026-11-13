import { InvoiceError, cents, currency, date, object, text, normalizeNumber, parseMoney } from './model';
import type { InvoiceCompany, DocumentSummary } from './model';
import { parseQrEvidence } from './qr-evidence';

export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_FILE = 10;

/** Match QR evidence by document number; never mix different receipts' quantities. */
export function validateExtractions(
  value: unknown,
  companies: Pick<InvoiceCompany, 'id' | 'name'>[],
  codes: unknown = [],
) {
  const batch = object(value);
  if (!Array.isArray(batch.documents) || !batch.documents.length || batch.documents.length > MAX_DOCUMENTS_PER_FILE)
    throw new InvoiceError(`Dosyada 1–${MAX_DOCUMENTS_PER_FILE} mesnet olmalı. Daha büyük dosyayı bölerek yükle.`, 422);
  if (batch.hasMoreDocuments !== false)
    throw new InvoiceError('Dosyanın tamamı okunamadı. Mesnetleri daha küçük dosyalara bölerek yükle.', 422);
  // Validate the outer transport bound before selecting evidence for any one receipt.
  parseQrEvidence(codes);
  const qrCodes = codes == null ? [] : (codes as string[]);
  const evidence = qrCodes.map(code => ({ code, qr: parseQrEvidence([code]) }));
  const qrNumbers = new Set(evidence.filter(e => e.qr.hasData && e.qr.number).map(e => normalizeNumber(e.qr.number!)));
  const rows = batch.documents.map(object);
  if (
    qrNumbers.size > 1 &&
    [...qrNumbers].some(
      number => !rows.some(row => typeof row.number === 'string' && normalizeNumber(row.number) === number),
    )
  )
    throw new InvoiceError('QR bilgisi bulunan mesnetlerin tümü okunamadı. Dosyayı bölerek yeniden yükle.', 422);
  return rows.map(row => {
    const selected =
      rows.length === 1 && qrNumbers.size <= 1
        ? qrCodes
        : evidence
            .filter(
              e =>
                typeof row.number === 'string' &&
                e.qr.number &&
                normalizeNumber(e.qr.number) === normalizeNumber(row.number),
            )
            .map(e => e.code);
    return validateExtraction(row, companies, selected);
  });
}
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
export function qrReviewAfterFailure(companies: Pick<InvoiceCompany, 'id' | 'name'>[], codes: unknown) {
  const qr = parseQrEvidence(codes);
  if (!qr.hasData || qr.conflict || qr.rateIssue === 'mismatch' || !qr.number || !qr.amountCents || !qr.currency)
    return null;
  const partial = validateExtraction({ documentType: qr.documentType }, companies, codes);
  partial.warnings.unshift(
    'Gemini okuması tamamlanamadı. QR bilgileri aktarıldı; firmayı belgeye bakarak seç ve tüm alanları doğrula.',
    'Bu sonuç yalnızca okunan QR içindir. Dosyadaki başka mesnetler okunmuş sayılmaz.',
  );
  return partial;
}
export function validateExtraction(
  value: unknown,
  companies: Pick<InvoiceCompany, 'id' | 'name'>[],
  codes: unknown = [],
) {
  const b = object(value),
    qr = parseQrEvidence(codes),
    warnings: string[] = [...qr.warnings];
  if (b.multipleDocuments === true)
    throw new InvoiceError('Dosyada birden fazla belge var. Her seferinde tek bir belge yükle.', 422);
  const read = (key: string, max = 250) => (b[key] == null || b[key] === '' ? null : text(b[key], key, max));
  const amount = (v: unknown) => {
    try {
      return v == null ? null : cents(v);
    } catch {
      return null;
    }
  };
  const printedAmount = (rawKey: string, legacyKey: string) => {
    if (!(rawKey in b)) return amount(b[legacyKey]);
    const value = b[rawKey];
    if (typeof value !== 'string' || value.length > 40) return null;
    const printed = value.trim().replace(/[ \u00a0\u202f]/g, '');
    try {
      // Scans can mix commas and dots between thousands. Only strip grouping
      // when every group has three digits and a distinct decimal tail follows.
      const grouped = /^(\d{1,3}(?:[.,]\d{3})+)\.(\d{1,2})$/.exec(printed);
      const normalized = grouped ? `${grouped[1].replace(/[.,]/g, '')}.${grouped[2]}` : printed;
      return cents(parseMoney(normalized));
    } catch {
      return null;
    }
  };
  const unit = (v: unknown) => {
    try {
      return v == null ? null : currency(String(v).toUpperCase());
    } catch {
      return null;
    }
  };
  const issuerName = read('issuerName'),
    counterpartyName = read('counterpartyName') || read('buyerName');
  const isFx = b.documentType === 'foreign_exchange' || qr.documentType === 'foreign_exchange';
  // These are source documents supplied by exchange offices, not necessarily
  // transactions involving our own company. Propose the issuing institution.
  let companyName = isFx ? issuerName : read('companyName') || issuerName;
  const match = (name: string | null) =>
    name
      ? companies.filter(c => {
          const key = companyKey(name),
            candidate = companyKey(c.name);
          return key === candidate || key.startsWith(candidate + ' ');
        })
      : [];
  let matches = match(companyName);
  if (!isFx && matches.length === 0 && counterpartyName) {
    matches = match(counterpartyName);
    if (matches.length === 1) companyName = counterpartyName;
  }
  const companyId = matches.length === 1 ? matches[0].id : null;
  if (!companyId)
    warnings.push('Takip edilecek firma kesin eşleştirilemedi. Belgedeki tarafları kontrol edip firmayı seç.');
  let number = read('number', 100),
    invoiceDate: string | null = null;
  try {
    if (b.date != null) invoiceDate = date(b.date);
  } catch {
    warnings.push('Belge tarihi doğrulanamadı.');
  }
  const foreignCurrency = unit(b.foreignCurrency) === 'TRY' ? null : unit(b.foreignCurrency);
  let foreignAmount = printedAmount('foreignAmountText', 'foreignAmountCents');
  if (isFx && foreignCurrency === 'USD') {
    const usdEquivalent = printedAmount('usdEquivalentText', 'usdEquivalentCents');
    if (usdEquivalent !== null) {
      if (foreignAmount === null) {
        foreignAmount = usdEquivalent;
        warnings.push('Döviz miktarı, belgede basılı ABD Doları Karşılığı satırından alındı. Tutarı kontrol et.');
      } else if (foreignAmount !== usdEquivalent) {
        foreignAmount = null;
        warnings.push('Basılı döviz miktarı ve ABD Doları Karşılığı farklı. Tutarı belge üzerinden doğrula.');
      }
    }
  }
  let amountCents = isFx ? foreignAmount : printedAmount('amountText', 'amountCents'),
    trackingCurrency = isFx ? foreignCurrency : unit(b.currency);
  let qrStatus: DocumentSummary['qrStatus'] = qr.conflict ? 'conflict' : qr.hasData ? 'partial' : 'not_read';
  let agreed = 0;
  if (qr.hasData && !qr.conflict) {
    if (number && qr.number && normalizeNumber(number) !== normalizeNumber(qr.number)) {
      warnings.push('Belgeden okunan Belge/Fatura No ile QR numarası farklı. Numarayı elle doğrula.');
      number = null;
      qrStatus = 'conflict';
    } else if (qr.number) {
      if (number) agreed++;
      number = qr.number;
    }
    if (
      amountCents !== null &&
      qr.amountCents !== null &&
      (amountCents !== qr.amountCents || trackingCurrency !== qr.currency)
    ) {
      warnings.push('Belgedeki takip tutarı veya para birimi QR bilgisiyle uyuşmuyor. Tutarı elle doğrula.');
      amountCents = null;
      qrStatus = 'conflict';
    } else if (qr.amountCents !== null) {
      if (amountCents !== null && trackingCurrency === qr.currency) agreed++;
      amountCents = qr.amountCents;
      trackingCurrency = qr.currency;
    }
    if (invoiceDate && qr.date && invoiceDate !== qr.date) {
      warnings.push('Belge tarihi ile QR tarihi farklı. Tarihi elle doğrula.');
      invoiceDate = null;
      qrStatus = 'conflict';
    } else if (qr.date) invoiceDate = qr.date;
    if (qrStatus !== 'conflict' && agreed === 2 && !qr.rateIssue) qrStatus = 'matched';
  }
  if (qr.conflict) {
    number = null;
    amountCents = null;
    trackingCurrency = null;
  }
  if (!trackingCurrency) {
    amountCents = null;
    warnings.push('Takip para birimi okunamadı. Para birimini ve miktarı elle doğrula.');
  }
  if (amountCents === null) warnings.push('Takip miktarı kesinleştirilemedi; belgeye bakarak gir.');
  if (!number)
    warnings.push('Sağ üstteki Belge No / Fatura No alanını kontrol ederek gir. ETTN veya işlem numarasını kullanma.');
  if (!invoiceDate) warnings.push('Belge tarihini kontrol ederek gir.');
  if (!qr.hasData)
    warnings.push(
      qr.hasLink
        ? 'QR yalnız bir belge bağlantısı içeriyor; numara ve tutar bu QR’dan doğrulanamadı.'
        : 'Veri içeren QR okunamadı; alanları belge üzerinden kontrol et.',
    );
  const tlAmount = printedAmount('tlAmountText', 'tlAmountCents') ?? qr.tlAmountCents,
    rate = read('exchangeRate', 30) ?? qr.exchangeRate;
  const document: DocumentSummary = {
    issuerName,
    counterpartyName,
    documentType: isFx ? 'foreign_exchange' : 'invoice',
    foreignAmountCents: qr.foreignAmountCents ?? foreignAmount,
    foreignCurrency: qr.foreignCurrency ?? foreignCurrency,
    exchangeRate: rate && /^\d+(?:[.,]\d{1,8})?$/.test(rate) ? rate.replace(',', '.') : null,
    tlAmountCents: tlAmount,
    qrStatus,
  };
  if (Array.isArray(b.warnings))
    for (const w of b.warnings.slice(0, 5)) if (typeof w === 'string' && w.length <= 300) warnings.push(w);
  return {
    companyName,
    companyId,
    number,
    date: invoiceDate,
    amountCents,
    currency: trackingCurrency,
    numberLabel: isFx ? 'Belge No' : read('numberLabel', 50) || 'Fatura No',
    document,
    warnings,
  };
}
