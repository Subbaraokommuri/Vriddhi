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
 * XIRR of a set of transaction cashflows plus one terminal (current value)
 * cashflow dated today. Returns null when there are fewer than 2 cashflows,
 * the span is under 30 days, or the solver fails. Pure function.
 */
export function calcXirrWithTerminal(
  cashflows: { date: Date; amount: number }[],
  terminalValue: number
): { value: number | null; warning: boolean } {
  const all = [...(cashflows ?? [])];
  if (terminalValue > 0) all.push({ date: new Date(), amount: terminalValue });
  if (all.length < 2) return { value: null, warning: false };

  all.sort((a, b) => a.date.getTime() - b.date.getTime());
  const spanDays = (all[all.length - 1].date.getTime() - all[0].date.getTime()) / (1000 * 60 * 60 * 24);
  if (spanDays < 30) return { value: null, warning: false };

  try {
    const res = xirr(all);
    if (res && typeof res.value === 'number' && isFinite(res.value)) {
      return { value: res.value, warning: res.value > 1.0 || res.value < -0.5 };
    }
  } catch {
    // solver failed to converge
  }
  return { value: null, warning: false };
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
      // Mirror the buy branch: skip the sell entirely when no benchmark price is
      // in tolerance, otherwise the mirror gets an inflow without a unit reduction.
      if (closest) {
        const unitsToSell = Math.abs(cf.amount) / closest.close;
        totalBenchmarkUnits = Math.max(0, totalBenchmarkUnits - unitsToSell);
        mirrorCashflows.push({ date: cf.date, amount: Math.abs(cf.amount) });
      }
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
