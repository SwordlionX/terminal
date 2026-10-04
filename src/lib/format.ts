/** Terminal display formats: Turkish numbers, "USD"/"TL" suffixes, %-prefix and DD.MM.YYYY dates. */
export const formatNumber = (n: number, digits = 2) =>
  Number.isFinite(n)
    ? n.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—';
export const formatMoney = (n: number, digits = 2) => `${formatNumber(n, digits)} USD`;
/** Percent points (5 → "%5,00"); the sign leads the percent sign ("-%0,39"). */
export const formatPercent = (n: number, digits = 2) =>
  Number.isFinite(n) ? `${n < 0 ? '-' : ''}%${formatNumber(Math.abs(n), digits)}` : '—';

/** YYYY-MM-DD (or an ISO timestamp's calendar day) as DD.MM.YYYY, without time-zone shifts. */
export function formatDate(value: string | null | undefined): string {
  const day = value?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return value ?? '—';
  const [y, m, d] = day.split('-');
  return `${d}.${m}.${y}`;
}

/** Instant (epoch ms or ISO) as DD.MM.YYYY HH:MM in Istanbul time. */
export function formatDateTime(value: number | string | null | undefined): string {
  const at = typeof value === 'string' ? Date.parse(value) : value;
  if (at == null || !Number.isFinite(at)) return '—';
  return new Date(at).toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
