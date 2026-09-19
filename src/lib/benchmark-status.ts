/**
 * Flags benchmarks whose data is out of date. Pure — no DB, no fetch.
 * A benchmark is stale when its latest stored date is more than `thresholdDays` old
 * (Nifty data lags by a few days over weekends/holidays, so the default is a week),
 * or when it has no data at all (daysOld = null).
 */

export interface StaleBenchmark {
  name: string;
  daysOld: number | null;   // null = no data yet
}

export function daysBetween(fromIso: string, today: Date): number | null {
  const from = new Date(`${fromIso}T00:00:00Z`);
  if (isNaN(from.getTime())) return null;
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((t - from.getTime()) / (1000 * 60 * 60 * 24));
}

export function findStaleBenchmarks(
  items: { name: string; latestDate: string | null }[],
  today: Date = new Date(),
  thresholdDays = 7
): StaleBenchmark[] {
  const stale: StaleBenchmark[] = [];
  for (const item of items ?? []) {
    if (!item.latestDate) {
      stale.push({ name: item.name, daysOld: null });
      continue;
    }
    const days = daysBetween(item.latestDate, today);
    if (days === null || days > thresholdDays) {
      stale.push({ name: item.name, daysOld: days });
    }
  }
  return stale;
}
