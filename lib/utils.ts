/**
 * Canonical folio-key normaliser — the ONLY folio sanitizer; the CAS parser and any
 * future importer (e.g. KFin XLSX) must use this so the same folio always gets the same key.
 * - scientific notation per "/"-segment (e.g. "5.9935E+11") → plain integer string
 * - strips CAMS's trailing "/0" (KFin omits it), so one physical folio isn't stored twice
 * - keeps other suffixes like "/76"
 */
export function sanitizeFolio(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const cleaned = String(raw).replace(/\s+/g, "");
  const fixed = cleaned.split("/").map(p => {
    try {
      if (p.toLowerCase().includes("e")) {
        return Math.round(parseFloat(p)).toString();
      }
    } catch { }
    return p;
  });
  let result = fixed.join("/");
  if (result.endsWith("/0")) {
    result = result.slice(0, -2);
  }
  return result;
}
