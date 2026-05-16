/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CONFIG } from './config.ts';

/**
 * Groups raw transaction rows by calendar year and sums amounts (natural sign: buys +, sells −).
 * Returns array sorted ascending by year.
 */
export function groupTransactionsByCY(
  transactions: { date: string; amount: number }[]
): { year: string; netInvested: number }[] {
  const groups: Record<string, number> = {};
  for (const t of transactions) {
    if (!t.date) continue;
    const year = t.date.substring(0, 4);
    if (!groups[year]) groups[year] = 0;
    groups[year] += t.amount;
  }
  
  return Object.entries(groups)
    .map(([year, netInvested]) => ({ year, netInvested }))
    .sort((a, b) => a.year.localeCompare(b.year));
}

/**
 * Adds yoyGrowth (% change vs prior year's netInvested).
 * Returns null for the first year, or when prior netInvested === 0.
 */
export function calcYoYGrowth(
  data: { year: string; netInvested: number }[]
): { year: string; netInvested: number; yoyGrowth: number | null }[] {
  return data.map((item, index) => {
    if (index === 0) return { ...item, yoyGrowth: null };
    const prior = data[index - 1].netInvested;
    if (prior === 0) return { ...item, yoyGrowth: null };
    
    if (Math.abs(prior) < CONFIG.INVESTMENT_TREND.MIN_MEANINGFUL_BASE_INR) {
      return { ...item, yoyGrowth: null };
    }
    
    // Calculate percentage change
    const yoyGrowth = ((item.netInvested - prior) / Math.abs(prior)) * 100;
    return { ...item, yoyGrowth };
  });
}

/**
 * Adds rollingAvgGrowth: mean of the last n non-null yoyGrowth values (default n=3).
 * Returns null until n non-null yoyGrowth values are available.
 */
export function calcRollingAvgGrowth(
  data: { year: string; netInvested: number; yoyGrowth: number | null }[],
  n: number = 3
): { year: string; netInvested: number; yoyGrowth: number | null; rollingAvgGrowth: number | null }[] {
  return data.map((item, index) => {
    const recentGrows: number[] = [];
    
    // Look back from current index to find n non-null yoyGrowth values
    for (let i = index; i >= 0 && recentGrows.length < n; i--) {
      if (data[i].yoyGrowth !== null) {
        recentGrows.push(data[i].yoyGrowth as number);
      }
    }

    if (recentGrows.length < n) {
      return { ...item, rollingAvgGrowth: null };
    }

    const sum = recentGrows.reduce((acc, val) => acc + val, 0);
    return { ...item, rollingAvgGrowth: sum / n };
  });
}
