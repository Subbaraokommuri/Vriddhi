import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPercent(value: number | null) {
  if (value === null) return 'N/A';
  return (value * 100).toFixed(2) + '%';
}

export function formatIndianNumber(num: number) {
  if (num >= 10000000) return (num / 10000000).toFixed(2) + ' Cr';
  if (num >= 100000) return (num / 100000).toFixed(2) + ' L';
  return num.toLocaleString('en-IN');
}

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Strips folio code prefix and plan/option/demat/formerly suffixes from raw CAS fund names.
 * Raw example: "PP001ZG-Parag Parikh Flexi Cap Fund - Direct Plan Growth (Non-Demat)"
 * Clean result: "Parag Parikh Flexi Cap Fund"
 *
 * Rules applied in order:
 * 1. Strip leading folio code — everything up to and including the first hyphen
 *    where the prefix is all uppercase letters and digits e.g. "PP001ZG-"
 * 2. Strip trailing " - Direct Plan ..." / " - Regular Plan ..." suffixes
 * 3. Strip trailing " (Non-Demat)" / " (Demat)" suffixes
 * 4. Strip trailing " (formerly ...)" clauses
 * 5. Trim whitespace
 */
export function formatFundName(raw: string): string {
  if (!raw) return raw;

  let name = raw;

  // Rule 1: strip leading folio code prefix (e.g. "PP001ZG-", "183FCDGG-", "K123D-")
  name = name.replace(/^[A-Z0-9]+-/, '');

  // Rule 2: strip plan/option suffixes
  // Matches: " - Direct Plan Growth", " - Regular Plan IDCW", " - Direct Plan Bonus" etc.
  name = name.replace(/\s*-\s*(Direct|Regular)\s+Plan\b.*/i, '');

  // Rule 3: strip demat suffixes
  name = name.replace(/\s*\((Non-)?Demat\)/i, '');

  // Rule 4: strip "formerly" clauses
  name = name.replace(/\s*\(formerly[^)]*\)/i, '');

  // Rule 5: trim
  return name.trim();
}
