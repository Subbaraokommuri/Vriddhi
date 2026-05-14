import express from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { db } from '../lib/db.ts';
import { log } from '../lib/logger.ts';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/import-csv', upload.single('file'), async (req, res) => {
  const { benchmarkId } = req.body;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!benchmarkId) {
    return res.status(400).json({ error: 'No benchmark ID provided' });
  }

  try {
    const benchmark = db.prepare('SELECT symbol FROM user_benchmarks WHERE id = ?').get(benchmarkId) as { symbol: string } | undefined;
    if (!benchmark) {
      return res.status(404).json({ error: 'Benchmark not found' });
    }

    log('benchmark', 'INFO', 'IMPORT', `Starting CSV import for benchmark ${benchmarkId} (${benchmark.symbol})`);

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
            log('benchmark', 'INFO', 'IMPORT', `Skipping row: missing date or value. Row: ${JSON.stringify(row)}`);
            continue;
          }

          const dateObj = new Date(dateStr);
          if (isNaN(dateObj.getTime())) {
            skipped++;
            log('benchmark', 'INFO', 'IMPORT', `Skipping row: invalid date "${dateStr}". Row: ${JSON.stringify(row)}`);
            continue;
          }

          const isoDate = dateObj.toISOString().split('T')[0];
          const value = parseFloat(valueStr.replace(/,/g, ''));

          if (isNaN(value)) {
            skipped++;
            log('benchmark', 'INFO', 'IMPORT', `Skipping row: invalid value "${valueStr}". Row: ${JSON.stringify(row)}`);
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
          log('benchmark', 'ERROR', 'IMPORT', `Error processing row: ${String(e)}. Row: ${JSON.stringify(row)}`);
        }
      }
    });

    transaction(dataRows);

    log('benchmark', 'INFO', 'IMPORT', `CSV import complete for ${benchmark.symbol}. Total: ${dataRows.length}, Inserted: ${inserted}, Skipped: ${skipped}`);
    res.json({ inserted, skipped, total: dataRows.length });

  } catch (err) {
    log('benchmark', 'ERROR', 'IMPORT', `Failed to import benchmark CSV: ${String(err)}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

export default router;
