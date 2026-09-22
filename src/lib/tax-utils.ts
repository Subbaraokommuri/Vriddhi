/**
 * Pure tax calculation helpers used by TaxReport.tsx.
 * Moved here 2026-09-22 (debt VB-25) — previously module-level functions
 * defined inside the component file.
 */

export function isCurrentOrPreviousFy(
  fyType: 'current' | 'previous' | 'historical'
): boolean {
  return fyType === 'current' || fyType === 'previous';
}

export function calc234CInterest(
  shortfall: number,
  installmentNumber: number
): number {
  if (shortfall <= 0) return 0;
  const months = installmentNumber <= 3 ? 3 : 1;
  return Math.round(shortfall * 0.01 * months * 100) / 100;
}

export function calc234BInterest(
  fullYearTax: number,
  totalPaid: number,
  selfAssessmentDate: string,
  fyEndYear: number
): { applicable: boolean; shortfall: number; interest: number } {
  const assessed = fullYearTax;
  const ninetyPct = assessed * 0.9;
  if (totalPaid >= ninetyPct) return { applicable: false, shortfall: 0, interest: 0 };
  const shortfall = assessed - totalPaid;
  // 234B: 1% per calendar month or part of a month, counted from 1 April
  const saDate = new Date(selfAssessmentDate);
  const months = Math.max(1,
    (saDate.getUTCFullYear() - fyEndYear) * 12 + (saDate.getUTCMonth() - 3) + 1
  );
  return {
    applicable: true,
    shortfall,
    interest: Math.round(shortfall * 0.01 * months * 100) / 100
  };
}
