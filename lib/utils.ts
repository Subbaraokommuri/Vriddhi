/**
 * Sanitizes folio numbers to prevent precision loss and scientific notation issues.
 * Logic: if the value is in scientific notation, use BigInt(Math.round(Number(raw))).toString()
 * Keeps full folio as-is including suffixes like "/76".
 */
export function sanitizeFolio(raw: string | number | any): string {
  if (raw === null || raw === undefined) return '';
  let str = String(raw).trim();
  
  // Handle scientific notation (e.g., "5.9935E+11")
  if (/e\+/i.test(str)) {
    try {
      const num = Number(raw);
      if (!isNaN(num)) {
        str = BigInt(Math.round(num)).toString();
      }
    } catch (e) {
      // If conversion fails, return original trimmed string
    }
  }
  
  return str;
}
