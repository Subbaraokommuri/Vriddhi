import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { db } from '../lib/db.ts';
import { log } from '../lib/logger.ts';
import { fetchFullNiftyTRIHistory } from '../lib/benchmarks.ts';
import { ACTIVE_AMC_LIST } from '../lib/config.ts';

const router = express.Router();
const METADATA_PATH = path.join(process.cwd(), 'metadata.json');
 
router.get('/amfi-metadata/status', (req, res) => {
  try {
    if (fs.existsSync(METADATA_PATH)) {
      const data = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
      const count = Array.isArray(data) ? data.length : 0;
      log('benchmark', 'INFO', 'STATUS', `Metadata status: ${count} funds`);
      return res.json({ exists: true, count });
    }
    log('benchmark', 'INFO', 'STATUS', 'Metadata status: 0 funds (file missing)');
    res.json({ exists: false, count: 0 });
  } catch (err) {
    log('benchmark', 'ERROR', 'STATUS', `Failed to check metadata status: ${String(err)}`);
    res.json({ exists: false, count: 0 });
  }
});

router.get('/amfi-metadata/fund-houses', (req, res) => {
  try {
    log('benchmark', 'INFO', 'STATUS', `Returning ${ACTIVE_AMC_LIST.length} canonical AMCs`);
    res.json({ fundHouses: ACTIVE_AMC_LIST });
  } catch (err) {
    log('benchmark', 'ERROR', 'STATUS', `Failed to get fund houses: ${String(err)}`);
    res.json({ fundHouses: [] });
  }
});

router.get('/amfi-search', async (req, res) => {
  const { q } = req.query as { q?: string };
  if (!q) return res.json({ results: [], total: 0 });

  log('benchmark', 'INFO', 'SEARCH', `Searching for fund: "${q}"`);

  try {
    let metadata: { schemeCode: number; schemeName: string }[] = [];

    if (!fs.existsSync(METADATA_PATH)) {
      log('benchmark', 'INFO', 'SEARCH', 'metadata.json not found, fetching from AMFI API');
      const response = await fetch('https://api.mfapi.in/mf');
      if (!response.ok) throw new Error(`AMFI API error: ${response.status}`);
      metadata = await response.json();
      fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata));
      log('benchmark', 'INFO', 'SEARCH', `Saved metadata.json with ${metadata.length} entries`);
    } else {
      metadata = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
    }

    const filtered = metadata
      .filter(f => f.schemeName.toLowerCase().includes(q.toLowerCase()))
      .map(f => {
        const name = f.schemeName;
        const matched = ACTIVE_AMC_LIST.find(amc => 
          name.toLowerCase().startsWith(amc.toLowerCase())
        );
        return {
          amfi_code: String(f.schemeCode),
          name: f.schemeName,
          fundHouse: matched ?? 'Other'
        };
      });

    res.json({
      results: filtered.slice(0, 50), // Standard limit for search
      total: filtered.length
    });
  } catch (err) {
    log('benchmark', 'ERROR', 'SEARCH', `AMFI search failed: ${String(err)}`);
    res.status(500).json({ error: 'Failed to search AMFI metadata' });
  }
});

router.post('/amfi-metadata/refresh', async (req, res) => {
  log('benchmark', 'INFO', 'REFRESH', 'Manual AMFI metadata refresh started');
  try {
    const response = await fetch('https://api.mfapi.in/mf');
    if (!response.ok) throw new Error(`AMFI API error: ${response.status}`);
    const metadata = await response.json();
    fs.writeFileSync(METADATA_PATH, JSON.stringify(metadata));
    log('benchmark', 'INFO', 'REFRESH', `Metadata refresh complete. Saved ${metadata.length} funds.`);
    res.json({ success: true, count: metadata.length });
  } catch (err) {
    log('benchmark', 'ERROR', 'REFRESH', `Metadata refresh failed: ${String(err)}`);
    res.status(500).json({ error: 'Failed to refresh AMFI metadata' });
  }
});

router.get('/user-benchmarks', (req, res) => {
  const benchmarks = db.prepare(`
    SELECT ub.*, 
      CASE 
        WHEN ub.benchmark_type = 'mf_nav' THEN (SELECT COUNT(*) FROM nav_history WHERE isin = ub.amfi_code)
        ELSE (SELECT COUNT(*) FROM benchmark_history WHERE index_name = ub.symbol)
      END as data_count
    FROM user_benchmarks ub
  `).all();
  res.json(benchmarks);
});

router.post('/user-benchmarks', async (req, res) => {
  const { symbol, name, source, category, color, benchmark_type = 'nifty_tri', amfi_code = null } = req.body;
  const id = uuidv4();

  log('benchmark', 'INFO', 'CREATE', `START: Creating benchmark ${name} type=${benchmark_type}`);

  try {
    if (benchmark_type === 'mf_nav') {
      if (!amfi_code) {
        throw new Error('AMFI code is required for mf_nav benchmark type');
      }

      log('benchmark', 'INFO', 'CREATE', `Fetching NAV history for AMFI code ${amfi_code}`);
      const response = await fetch(`https://api.mfapi.in/mf/${amfi_code}`);
      if (!response.ok) throw new Error(`AMFI API error: ${response.status}`);
      const navData = await response.json();

      if (!navData.data || !Array.isArray(navData.data)) {
        throw new Error('Invalid NAV data received from AMFI API');
      }

      let inserted = 0;
      let skipped = 0;

      const sync = db.transaction(() => {
        db.prepare('INSERT INTO user_benchmarks (id, symbol, name, source, category, color, benchmark_type, amfi_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, symbol, name, source, category, color, benchmark_type, amfi_code);

        const insertNav = db.prepare('INSERT OR IGNORE INTO nav_history (isin, nav_date, nav) VALUES (?, ?, ?)');
        for (const row of navData.data) {
          // DD-MM-YYYY -> YYYY-MM-DD
          const [d, m, y] = row.date.split('-');
          const isoDate = `${y}-${m}-${d}`;
          const result = insertNav.run(amfi_code, isoDate, parseFloat(row.nav));
          if (result.changes > 0) {
            inserted++;
          } else {
            skipped++;
          }
        }
      });

      sync();

      log('benchmark', 'INFO', 'CREATE', `Success: Inserted ${inserted} NAV records for ${amfi_code}`);
      if (skipped > 0) log('benchmark', 'INFO', 'CREATE', `SKIP: ${skipped} records already existed`);
      log('benchmark', 'INFO', 'CREATE', `END: Benchmark ${id} created with ${inserted} data points`);
      
      res.json({ id, rowsInserted: inserted });
    } else {
      db.prepare('INSERT INTO user_benchmarks (id, symbol, name, source, category, color, benchmark_type, amfi_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, symbol, name, source, category, color, benchmark_type, amfi_code);
      
      log('benchmark', 'INFO', 'CREATE', `END: Benchmark ${id} created (type: ${benchmark_type})`);
      res.json({ id });
    }
  } catch (err) {
    log('benchmark', 'ERROR', 'CREATE', `ERROR: Failed to create benchmark: ${String(err)}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

router.delete('/user-benchmarks/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM user_benchmarks WHERE id = ?').run(id);
  res.json({ success: true });
});

router.get('/benchmarks/:id/data-summary', (req, res) => {
  const { id } = req.params;
  const benchmark = db.prepare('SELECT symbol, benchmark_type, amfi_code FROM user_benchmarks WHERE id = ?').get(id) as { symbol: string; benchmark_type: string; amfi_code: string | null } | undefined;
  
  if (!benchmark) {
    return res.status(404).json({ error: 'Benchmark not found' });
  }

  let summary: { oldest: string | null; latest: string | null; count: number };

  if (benchmark.benchmark_type === 'mf_nav') {
    summary = db.prepare(`
      SELECT 
        MIN(nav_date) as oldest,
        MAX(nav_date) as latest,
        COUNT(*) as count
      FROM nav_history 
      WHERE isin = ?
    `).get(benchmark.amfi_code) as { oldest: string | null; latest: string | null; count: number };
  } else {
    summary = db.prepare(`
      SELECT 
        MIN(price_date) as oldest,
        MAX(price_date) as latest,
        COUNT(*) as count
      FROM benchmark_history 
      WHERE index_name = ?
    `).get(benchmark.symbol) as { oldest: string | null; latest: string | null; count: number };
  }

  res.json(summary.count > 0 ? summary : null);
});

router.post('/benchmarks/:id/fetch', async (req, res) => {
  const { id } = req.params;
  try {
    const benchmark = db.prepare('SELECT symbol, name, benchmark_type FROM user_benchmarks WHERE id = ?').get(id) as { symbol: string; name: string; benchmark_type: string } | undefined;
    
    if (!benchmark) {
      return res.status(404).json({ error: 'Benchmark not found' });
    }

    if (benchmark.benchmark_type !== 'nifty_tri') {
      return res.status(400).json({
        error: `Fetch not supported for benchmark_type '${benchmark.benchmark_type}'`
      });
    }

    log('benchmark', 'INFO', 'FETCH', `Starting automatic fetch for ${benchmark.name} (${benchmark.symbol})`);

    const data = await fetchFullNiftyTRIHistory(benchmark.symbol);
    
    const insert = db.prepare('INSERT OR IGNORE INTO benchmark_history (index_name, price_date, value) VALUES (?, ?, ?)');
    let inserted = 0;

    const transaction = db.transaction((rows: Array<{date: string, value: number}>) => {
      for (const row of rows) {
        const result = insert.run(benchmark.symbol, row.date, row.value);
        if (result.changes > 0) {
          inserted++;
        }
      }
    });

    transaction(data);

    log('benchmark', 'INFO', 'FETCH', `Fetched ${data.length} rows for ${benchmark.symbol}, inserted ${inserted} new records`);
    res.json({ inserted, total: data.length });
  } catch (err) {
    log('benchmark', 'ERROR', 'FETCH', `Failed to fetch benchmark data: ${String(err)}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

router.get('/portfolio-growth-vs-benchmark', (req, res) => {
  const { benchmark_symbol } = req.query as any;
  const txns = db.prepare(`
    SELECT t.date, t.amount, t.units, t.folio_id, t.transaction_type, fu.isin
    FROM transactions t
    JOIN folios f ON t.folio_id = f.id
    JOIN funds fu ON f.fund_id = fu.id
    ORDER BY t.date ASC
  `).all() as any[];
  if (txns.length === 0) return res.json([]);

  const startDate = new Date(txns[0].date);
  const endDate = new Date();
  const result = [];

  // Get all unique ISINs
  const isins = [...new Set(txns.map(t => t.isin).filter(Boolean))];
  const navs: Record<string, any[]> = {};
  for (const isin of isins) {
    navs[isin] = db.prepare('SELECT nav_date as date, nav FROM nav_history WHERE isin = ? ORDER BY nav_date ASC').all(isin) as any[];
  }

  const benchmarkPrices = db.prepare('SELECT price_date as date, value as close FROM benchmark_history WHERE index_name = ? ORDER BY price_date ASC').all(benchmark_symbol) as any[];
  const bPricesMap = new Map(benchmarkPrices.map(p => [p.date, p.close]));

  let currentPortfolioUnits: Record<string, number> = {};
  let totalBenchmarkUnits = 0;
  let firstBenchmarkPrice = 0;

  // Iterate by month to keep it fast
  let curr = new Date(startDate);
  while (curr <= endDate) {
    const dateStr = curr.toISOString().split('T')[0];
    
    // Update units up to this date
    const txnsToDate = txns.filter(t => new Date(t.date) <= curr);
    currentPortfolioUnits = {};
    totalBenchmarkUnits = 0;
    let totalInvested = 0;

    for (const t of txnsToDate) {
      const type = t.transaction_type as 'buy' | 'sell';
      if (!currentPortfolioUnits[t.folio_id]) currentPortfolioUnits[t.folio_id] = 0;
      if (type === 'buy') {
        currentPortfolioUnits[t.folio_id] += t.units;
        totalInvested += t.amount;
        
        // Mirror in benchmark
        const bPriceRow = benchmarkPrices.find(p => new Date(p.date) <= new Date(t.date)); // Simplified
        const bPrice = bPriceRow ? bPriceRow.close : 0;
        if (bPrice > 0) {
          totalBenchmarkUnits += t.amount / bPrice;
          if (firstBenchmarkPrice === 0) firstBenchmarkPrice = bPrice;
        }
      } else {
        currentPortfolioUnits[t.folio_id] -= t.units;
        totalInvested -= t.amount;
      }
    }

    // Calculate current values
    let portfolioValue = 0;
    for (const id in currentPortfolioUnits) {
      const txn = txns.find(t => t.folio_id === id);
      if (!txn || !txn.isin) continue;
      const fundNavs = navs[txn.isin];
      const closestNav = fundNavs.filter(n => new Date(n.date) <= curr).pop();
      if (closestNav) {
        portfolioValue += currentPortfolioUnits[id] * closestNav.nav;
      }
    }

    const bPriceRow = benchmarkPrices.filter(p => new Date(p.date) <= curr).pop();
    const bPrice = bPriceRow ? bPriceRow.close : 0;
    const benchmarkValue = totalBenchmarkUnits * bPrice;

    if (totalInvested > 0) {
      result.push({
        date: dateStr,
        portfolio: (portfolioValue / totalInvested) * 100,
        benchmark: (benchmarkValue / totalInvested) * 100
      });
    }

    curr.setMonth(curr.getMonth() + 1);
  }

  res.json(result);
});

export default router;
