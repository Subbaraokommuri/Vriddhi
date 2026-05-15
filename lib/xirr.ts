/**
 * XIRR Calculation Logic
 * Pure functions for financial calculations
 */

export interface XirrResult {
  value: number | null;
  suspect: boolean;
  reason?: string;
}

/**
 * Calculates the Internal Rate of Return for a series of cashflows
 * @param cashflows Array of { date, amount }
 * @param guess Initial guess for the rate
 * @throws Error if fewer than 2 cashflows or span < 30 days
 */
export function xirr(cashflows: { date: Date; amount: number }[], guess = 0.1): XirrResult {
  if (cashflows.length < 2) {
    throw new Error("At least 2 cashflows required for XIRR calculation");
  }

  const sortedCf = [...cashflows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const firstDate = sortedCf[0].date;
  const lastDate = sortedCf[sortedCf.length - 1].date;
  const diffDays = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);

  if (diffDays < 30) {
    throw new Error("Cashflow span must be at least 30 days for XIRR calculation");
  }

  const maxIter = 100;
  const precision = 1e-7;
  let rate = guess;

  for (let i = 0; i < maxIter; i++) {
    let npv = 0;
    let dNpv = 0;

    for (const cf of sortedCf) {
      const days = (cf.date.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
      const yearFraction = days / 365;
      const factor = Math.pow(1 + rate, yearFraction);
      npv += cf.amount / factor;
      dNpv -= (cf.amount * yearFraction) / (factor * (1 + rate));
    }

    if (Math.abs(npv) < precision) {
      return finalize(rate);
    }
    if (dNpv === 0) break;

    const nextRate = rate - npv / dNpv;
    if (Math.abs(nextRate - rate) < precision) {
      return finalize(nextRate);
    }
    rate = nextRate;
  }

  return { value: null, suspect: false };
}

function finalize(value: number): XirrResult {
  const suspect = value > 1 || value < -0.5;
  return {
    value,
    suspect,
    reason: suspect ? `XIRR ${value > 1 ? '> 100%' : '< -50%'} is suspect` : undefined
  };
}

/**
 * Calculates XIRR for a "mirror" portfolio using benchmark prices
 * Pure function: caller must provide benchmark data
 */
export function calcMirrorXirr(
  cashflows: { date: Date; amount: number; type: 'buy' | 'sell' }[],
  benchmarkPrices: { date: string; close: number }[],
  latestPrice: number | null,
  options: { minDays: number; toleranceDays: number }
): XirrResult {
  const mirrorCashflows: { date: Date; amount: number }[] = [];
  let totalBenchmarkUnits = 0;

  // Sort cashflows by date
  const sortedCf = [...cashflows].sort((a, b) => a.date.getTime() - b.date.getTime());

  for (const cf of sortedCf) {
    if (cf.type === 'buy') {
      const cfDate = cf.date.getTime();
      let closest = null;
      let minDiff = Infinity;

      // Find closest price within tolerance
      for (const p of benchmarkPrices) {
        const pDate = new Date(p.date).getTime();
        const diff = Math.abs(pDate - cfDate) / (1000 * 60 * 60 * 24);
        if (diff <= options.toleranceDays && diff < minDiff) {
          minDiff = diff;
          closest = p;
        }
      }

      if (closest) {
        const units = Math.abs(cf.amount) / closest.close;
        totalBenchmarkUnits += units;
        mirrorCashflows.push({ date: cf.date, amount: -Math.abs(cf.amount) });
      }
    } else {
      // Find closest benchmark price on sell date
      const cfDate = cf.date.getTime();
      let closest: { date: string; close: number } | null = null;
      let minDiff = Infinity;
      for (const p of benchmarkPrices) {
        const pDate = new Date(p.date).getTime();
        const diff = Math.abs(pDate - cfDate) / (1000 * 60 * 60 * 24);
        if (diff <= options.toleranceDays && diff < minDiff) {
          minDiff = diff;
          closest = p;
        }
      }
      if (closest) {
        const unitsToSell = Math.abs(cf.amount) / closest.close;
        totalBenchmarkUnits = Math.max(0, totalBenchmarkUnits - unitsToSell);
      }
      mirrorCashflows.push({ date: cf.date, amount: Math.abs(cf.amount) });
    }
  }

  if (latestPrice && totalBenchmarkUnits > 0) {
    mirrorCashflows.push({ date: new Date(), amount: totalBenchmarkUnits * latestPrice });
  }

  try {
    return xirr(mirrorCashflows);
  } catch (e) {
    return { value: null, suspect: false };
  }
}
