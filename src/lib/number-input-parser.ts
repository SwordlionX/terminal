/**
 * Parse the complete contents of a localized decimal input.
 *
 * A comma is treated as the decimal mark. When both separators occur, dots
 * must form valid three-digit groups (for example, `1.250,50`). A dot alone
 * is always decimal, so `1.250` means 1.25 rather than 1250.
 */
export function parseNumberInput(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;

  const exponentMatch = text.match(/([eE][+-]?\d+)$/);
  const mantissa = exponentMatch ? text.slice(0, -exponentMatch[0].length) : text;
  const exponent = exponentMatch?.[0] ?? '';
  if (/[eE]/.test(mantissa)) return null;

  let normalized: string;
  if (mantissa.includes(',')) {
    const commaParts = mantissa.split(',');
    if (commaParts.length !== 2) return null;
    const [integer, fraction] = commaParts;
    if (fraction === '' || !/^\d+$/.test(fraction)) return null;

    const unsignedInteger = integer.replace(/^[+-]/, '');
    const sign = integer.slice(0, integer.length - unsignedInteger.length);
    const validInteger =
      unsignedInteger === '' || /^\d+$/.test(unsignedInteger) || /^\d{1,3}(?:\.\d{3})+$/.test(unsignedInteger);
    if (!validInteger) return null;
    normalized = `${sign}${unsignedInteger.replace(/\./g, '') || '0'}.${fraction}`;
  } else {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(mantissa)) return null;
    normalized = mantissa;
  }

  const value = Number(`${normalized}${exponent}`);
  return Number.isFinite(value) ? value : null;
}
