export const formatNumber = (n: number, digits = 2) => Number.isFinite(n) ? n.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
export const formatMoney = (n: number) => `${formatNumber(n)} USD`;
