import { db } from './db.ts';
import { PanCapitalGainsSummary } from './capital-gains.ts';

/**
 * Shared FY/date/installment helpers for routes/tax.ts and routes/tax-export.ts.
 * Moved here 2026-09-22 (debt VB-27) — previously duplicated byte-identically
 * in both route files.
 */

export interface QuarterRedemption {
  date: string;
  fundName: string;
  folioNumber: string;
  units: number;     // absolute value, positive
  amount: number;    // absolute value, positive
}

export interface AdvanceTaxInstallment {
  installmentNumber: number;       // 1–4
  dueDate: string;                 // payment due date: Jun15/Sep15/Dec15/Mar15
  cutoffDate: string;              // gains computed up to this date
                                   // Q1-Q3: same as dueDate; Q4: fyEnd (Mar31)
  cumulativePercent: number;       // 15 | 45 | 75 | 100
  cumulativeTaxUpToCutoff: number; // total estimated tax on gains fyStart–cutoffDate
  cumulativeObligation: number;    // cumulativePercent/100 × cumulativeTaxUpToCutoff
  dueAmount: number;               // cumulativeObligation minus previous installment's
                                   // cumulativeObligation (0 for installment 1 if
                                   // cumulativeObligation is the full obligation)
  quarterSTCG: number;             // STCG from sells in THIS quarter only
  quarterLTCG: number;             // LTCG from sells in THIS quarter only
  quarterTaxContribution: number;  // incremental tax this quarter contributed
  quarterRedemptions: QuarterRedemption[];
  isPastDue: boolean;
  isCurrentInstallment: boolean;
}

/**
 * navOnDate(isin, targetDate)
 * Queries nav_history for the closest available NAV on or before targetDate.
 */
export function navOnDate(isin: string, targetDate: string): number | null {
  try {
    const row = db.prepare(`
      SELECT nav FROM nav_history
      WHERE isin = ? AND nav_date <= ?
      ORDER BY nav_date DESC LIMIT 1
    `).get(isin, targetDate) as { nav: number } | undefined;

    return row ? row.nav : null;
  } catch (err) {
    return null;
  }
}

/**
 * getFyBounds(fy)
 * Parses fy param like '2025-26' into fyStart='2025-04-01' and fyEnd='2026-03-31'.
 */
export function getFyBounds(fy: string): { fyStart: string, fyEnd: string } {
  if (!/^\d{4}-\d{2}$/.test(fy)) {
    throw new Error('Invalid FY format. Expected YYYY-YY');
  }

  const [startYearStr, endYearShort] = fy.split('-');
  const startYear = parseInt(startYearStr);
  const endYear = startYear + 1;

  return {
    fyStart: `${startYear}-04-01`,
    fyEnd: `${endYear}-03-31`
  };
}

/**
 * getDefaultFy()
 * Returns just-completed FY as 'YYYY-YY' string.
 */
export function getDefaultFy(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed, April is 3

  let startYear: number;
  if (month >= 3) { // April or later
    startYear = year - 1;
  } else {
    startYear = year - 2;
  }

  const endYearShort = (startYear + 1).toString().slice(-2);
  return `${startYear}-${endYearShort}`;
}

/**
 * getCurrentFy()
 * Returns the current active Financial Year as a YYYY-YY string.
 */
export function getCurrentFy(): string {
  const today = new Date();
  const year  = today.getFullYear();
  const month = today.getMonth() + 1; // 1-indexed
  if (month >= 4) {
    return `${year}-${String(year + 1).slice(-2)}`;
  }
  return `${year - 1}-${String(year).slice(-2)}`;
}

/**
 * buildInstallmentsFromSummaries
 */
export function buildInstallmentsFromSummaries(
  summaries: PanCapitalGainsSummary[],  // array of 4, index 0=Q1 ... 3=Q4
  cutoffDates: string[],                // ['YYYY-06-15','YYYY-09-15','YYYY-12-15','YYYY-03-31']
  dueDates: string[],                   // ['YYYY-06-15','YYYY-09-15','YYYY-12-15','YYYY+1-03-15']
  quarterRedemptionsList: QuarterRedemption[][],  // array of 4, one per quarter
  today: Date
): AdvanceTaxInstallment[] {
  const percents = [15, 45, 75, 100];
  const installments: AdvanceTaxInstallment[] = [];
  let foundCurrent = false;

  const todayStr = today.toISOString().slice(0, 10);

  for (let i = 0; i < 4; i++) {
    const summary = summaries[i];
    const prevSummary = i > 0 ? summaries[i - 1] : null;

    const cumulativeTax = (summary.estimatedSTCGTax ?? 0) + (summary.estimatedLTCGTax ?? 0);
    const cumulativeObligation = (percents[i] / 100) * cumulativeTax;

    const prevCumulativeTax = prevSummary
      ? (prevSummary.estimatedSTCGTax ?? 0) + (prevSummary.estimatedLTCGTax ?? 0)
      : 0;
    const prevCumulativeObligation = prevSummary
      ? (percents[i - 1] / 100) * prevCumulativeTax
      : 0;

    const dueAmount = cumulativeObligation - prevCumulativeObligation;

    const quarterSTCG = summary.totalSTCG - (prevSummary ? prevSummary.totalSTCG : 0);
    const quarterLTCG = summary.totalLTCG - (prevSummary ? prevSummary.totalLTCG : 0);
    const quarterTaxContribution = cumulativeTax - (prevSummary ? prevCumulativeTax : 0);

    const isPastDue = dueDates[i] < todayStr;
    const isCurrentInstallment = !isPastDue && !foundCurrent;
    if (isCurrentInstallment) {
      foundCurrent = true;
    }

    installments.push({
      installmentNumber: i + 1,
      dueDate: dueDates[i],
      cutoffDate: cutoffDates[i],
      cumulativePercent: percents[i],
      cumulativeTaxUpToCutoff: Math.round(cumulativeTax * 100) / 100,
      cumulativeObligation: Math.round(cumulativeObligation * 100) / 100,
      dueAmount: Math.round(dueAmount * 100) / 100,
      quarterSTCG: Math.round(quarterSTCG * 100) / 100,
      quarterLTCG: Math.round(quarterLTCG * 100) / 100,
      quarterTaxContribution: Math.round(quarterTaxContribution * 100) / 100,
      quarterRedemptions: quarterRedemptionsList[i] || [],
      isPastDue,
      isCurrentInstallment,
    });
  }

  return installments;
}
