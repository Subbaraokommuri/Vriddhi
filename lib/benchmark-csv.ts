import { parse } from 'csv-parse/sync';

/**
 * Pure helpers for niftyindices.com Total Returns Index CSV files.
 * Expected columns: IndexName, Date ("DD Mon YYYY"), Total Returns Index, [Net Total Return Index].
 * No DB, no Express — the route does all writes.
 */

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
};

export interface ParsedNiftyCsv {
  indexName: string | null;            // value of the IndexName column, null if absent/blank
  rows: { date: string; value: number }[];   // ISO date + TRI value
  unreadable: number;                  // rows skipped: missing/invalid date or value
  totalRows: number;                   // data rows (header excluded)
}

/** 'DD Mon YYYY' -> 'YYYY-MM-DD'; null on any mismatch (strict, no lenient fallback). */
export function parseNiftyDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const m = dateStr.trim().match(/^(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${MONTHS[m[2]]}-${m[1]}`;
}

/**
 * Normalises an index name for matching: 'NIFTY 50', 'Nifty_50_TRI', 'nifty 50 total returns index'
 * all become 'NIFTY 50'.
 */
export function normalizeIndexName(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw
    .replace(/\.csv$/i, '')
    .replace(/\(\d+\)\s*$/, '')                     // browser duplicate suffix: 'file (1)'
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/\s+(TOTAL RETURNS? INDEX|TRI)$/, '')
    .trim();
}

/** Best-effort index name from a filename, e.g. 'NIFTY_50_TRI.csv' -> 'NIFTY 50'. */
export function indexNameFromFilename(filename: string): string {
  return normalizeIndexName(filename);
}

/**
 * Parses a niftyindices TRI CSV. Throws if the file has no data rows or mixes several indices.
 * Duplicate dates are kept (the DB INSERT OR IGNORE dedups).
 */
export function parseNiftyCsv(content: string): ParsedNiftyCsv {
  const records = parse(content ?? '', {
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  }) as string[][];

  if (records.length <= 1) {
    throw new Error('CSV file is empty or has no data rows');
  }

  const dataRows = records.slice(1); // header row skipped, same as the single-file importer
  const names = new Set<string>();
  const rows: { date: string; value: number }[] = [];
  let unreadable = 0;

  for (const row of dataRows) {
    const name = (row[0] ?? '').trim();
    if (name) names.add(normalizeIndexName(name));

    const isoDate = parseNiftyDate(row[1]);
    const value = parseFloat((row[2] ?? '').replace(/,/g, ''));
    if (!isoDate || !Number.isFinite(value)) {
      unreadable++;
      continue;
    }
    rows.push({ date: isoDate, value });
  }

  if (names.size > 1) {
    throw new Error(`File contains more than one index (${[...names].slice(0, 3).join(', ')}…)`);
  }

  const firstName = dataRows.map(r => (r[0] ?? '').trim()).find(n => n.length > 0) ?? null;
  return { indexName: firstName, rows, unreadable, totalRows: dataRows.length };
}

/** Finds the entry whose normalised symbol equals the normalised name; null if none. */
export function matchIndexEntry<T extends { symbol: string }>(
  name: string | undefined | null,
  entries: T[] | undefined | null
): T | null {
  const target = normalizeIndexName(name);
  if (!target) return null;
  return (entries ?? []).find(e => normalizeIndexName(e.symbol) === target) ?? null;
}
