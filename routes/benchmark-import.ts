import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { db } from '../lib/db.ts';
import { log } from '../lib/logger.ts';
import { v4 as uuidv4 } from 'uuid';
import { CONFIG } from '../lib/config.ts';
import { parseNiftyCsv, indexNameFromFilename, matchIndexEntry } from '../lib/benchmark-csv.ts';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function parseNiftyDate(dateStr: string): string | null {
  if (!dateStr) return null;
  const match = dateStr.match(/^(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/);
  if (!match) return null;
  const [, day, monthStr, year] = match;
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
  };
  const month = months[monthStr];
  return `${year}-${month}-${day}`;
}

router.post('/import-csv', upload.single('file'), async (req, res) => {
  const { benchmarkId } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!benchmarkId) {
    return res.status(400).json({ error: 'No benchmark ID provided' });
  }

  const filename = file.originalname;

  try {
    const benchmark = db.prepare('SELECT symbol FROM user_benchmarks WHERE id = ?').get(benchmarkId) as { symbol: string } | undefined;
    if (!benchmark) {
      return res.status(404).json({ error: 'Benchmark not found' });
    }

    log('benchmark', 'INFO', 'IMPORT', `[${filename}] Starting CSV import for benchmark ${benchmarkId} (${benchmark.symbol})`);

    const content = file.buffer.toString();
    const records = parse(content, {
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    }) as string[][];

    if (records.length <= 1) {
      return res.status(400).json({ error: 'CSV file is empty or has no data rows' });
    }

    // Skip header row
    const dataRows = records.slice(1);
    let inserted = 0;
    let skipped = 0;

    const insert = db.prepare('INSERT OR IGNORE INTO benchmark_history (index_name, price_date, value) VALUES (?, ?, ?)');
    
    const transaction = db.transaction((rows: string[][]) => {
      for (const row of rows) {
        try {
          const dateStr = row[1]; // Column 1: Date
          const valueStr = row[2]; // Column 2: Total Returns Index

          if (!dateStr || !valueStr) {
            skipped++;
            log('benchmark', 'INFO', 'IMPORT', `[${filename}] Skipping row: missing date or value. Row: ${JSON.stringify(row)}`);
            continue;
          }

          const isoDate = parseNiftyDate(dateStr);
          if (!isoDate) {
            skipped++;
            log('benchmark', 'INFO', 'IMPORT', `[${filename}] Skipping row: invalid date "${dateStr}". Row: ${JSON.stringify(row)}`);
            continue;
          }

          const value = parseFloat(valueStr.replace(/,/g, ''));

          if (isNaN(value)) {
            skipped++;
            log('benchmark', 'INFO', 'IMPORT', `[${filename}] Skipping row: invalid value "${valueStr}". Row: ${JSON.stringify(row)}`);
            continue;
          }

          const result = insert.run(benchmark.symbol, isoDate, value);
          if (result.changes > 0) {
            inserted++;
          } else {
            // Already exists or IGNORE hit
            skipped++;
          }
        } catch (e) {
          skipped++;
          log('benchmark', 'ERROR', 'IMPORT', `[${filename}] Error processing row: ${String(e)}. Row: ${JSON.stringify(row)}`);
        }
      }
    });

    transaction(dataRows);

    log('benchmark', 'INFO', 'IMPORT', `[${filename}] CSV import complete for ${benchmark.symbol}. Total: ${dataRows.length}, Inserted: ${inserted}, Skipped: ${skipped}`);
    res.json({ inserted, skipped, total: dataRows.length });

  } catch (err) {
    log('benchmark', 'ERROR', 'IMPORT', `[${filename}] Failed to import benchmark CSV: ${String(err)}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

interface BulkFileResult {
  filename: string;
  indexName: string | null;      // name as read from the file (or filename fallback)
  benchmarkSymbol: string | null;
  created: boolean;              // benchmark was auto-created from the catalogue
  inserted: number;
  alreadyPresent: number;
  unreadable: number;
  error?: string;
}

/**
 * Bulk CSV import: many niftyindices TRI files at once, any indices. The index of each file is
 * read from its IndexName column (filename as fallback) and matched to an existing nifty_tri
 * benchmark or to NIFTY_TRI_CATALOGUE (auto-creating the benchmark). Unrecognised indices are
 * reported and skipped — never guessed.
 */
router.post('/import-csv-bulk', upload.array('files', 50), (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    log('benchmark', 'INFO', 'BULK-IMPORT', `START: ${files.length} file(s)`);

    const existing = db.prepare(
      "SELECT id, symbol, name FROM user_benchmarks WHERE benchmark_type = 'nifty_tri'"
    ).all() as { id: string; symbol: string; name: string }[];
    const insertRow = db.prepare('INSERT OR IGNORE INTO benchmark_history (index_name, price_date, value) VALUES (?, ?, ?)');
    const insertBenchmark = db.prepare(
      'INSERT INTO user_benchmarks (id, symbol, name, source, category, color, benchmark_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

    const results: BulkFileResult[] = [];

    for (const file of files) {
      const filename = file.originalname;
      const result: BulkFileResult = {
        filename, indexName: null, benchmarkSymbol: null,
        created: false, inserted: 0, alreadyPresent: 0, unreadable: 0
      };

      try {
        const parsed = parseNiftyCsv(file.buffer.toString());
        result.unreadable = parsed.unreadable;
        result.indexName = parsed.indexName ?? indexNameFromFilename(filename);

        // Existing benchmark first (covers indices outside the catalogue), then the catalogue.
        // The filename is only a fallback when the file has no IndexName — never a second guess.
        let target: { symbol: string } | null = matchIndexEntry(result.indexName, existing);

        if (!target) {
          const entry = matchIndexEntry(result.indexName, CONFIG.NIFTY_TRI_CATALOGUE);
          if (!entry) {
            throw new Error(`Unrecognised index "${result.indexName}" — not in the Nifty TRI catalogue`);
          }
          insertBenchmark.run(uuidv4(), entry.symbol, entry.name, 'niftyindices', entry.category, '#01696f', 'nifty_tri');
          existing.push({ id: '', symbol: entry.symbol, name: entry.name });
          target = entry;
          result.created = true;
          log('benchmark', 'INFO', 'BULK-IMPORT', `[${filename}] Created benchmark ${entry.symbol}`);
        }

        result.benchmarkSymbol = target.symbol;

        db.transaction((rows: { date: string; value: number }[]) => {
          for (const row of rows) {
            const r = insertRow.run(target!.symbol, row.date, row.value);
            if (r.changes > 0) result.inserted++;
            else result.alreadyPresent++;
          }
        })(parsed.rows);

        log('benchmark', 'INFO', 'BULK-IMPORT',
          `[${filename}] ${target.symbol}: inserted ${result.inserted}, already present ${result.alreadyPresent}, unreadable ${result.unreadable}`);
      } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
        log('benchmark', 'ERROR', 'BULK-IMPORT', `[${filename}] ${result.error}`);
      }

      results.push(result);
    }

    const totals = {
      files: results.length,
      failed: results.filter(r => r.error).length,
      created: results.filter(r => r.created).length,
      inserted: results.reduce((n, r) => n + r.inserted, 0)
    };
    log('benchmark', 'INFO', 'BULK-IMPORT', `END: ${totals.files} files, ${totals.failed} failed, ${totals.created} benchmark(s) created, ${totals.inserted} rows inserted`);
    res.json({ files: results, totals });
  } catch (err) {
    log('benchmark', 'ERROR', 'BULK-IMPORT', `Bulk import failed: ${String(err)}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

export default router;
