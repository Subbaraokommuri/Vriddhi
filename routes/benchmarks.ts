import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/db.ts';
import { log } from '../lib/logger.ts';
import { fetchFullNiftyTRIHistory } from '../lib/benchmarks.ts';

const router = express.Router();

router.get('/user-benchmarks', (req, res) => {
  const benchmarks = db.prepare(`
    SELECT ub.*, COUNT(bh.price_date) as data_count
    FROM user_benchmarks ub
    LEFT JOIN benchmark_history bh ON bh.index_name = ub.symbol
    GROUP BY ub.id
  `).all();
  res.json(benchmarks);
});

router.post('/user-benchmarks', (req, res) => {
  const { symbol, name, source, category, color } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO user_benchmarks (id, symbol, name, source, category, color) VALUES (?, ?, ?, ?, ?, ?)').run(id, symbol, name, source, category, color);
  res.json({ id });
});

router.delete('/user-benchmarks/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM user_benchmarks WHERE id = ?').run(id);
  res.json({ success: true });
});

router.get('/benchmarks/:id/data-summary', (req, res) => {
  const { id } = req.params;
  const benchmark = db.prepare('SELECT symbol FROM user_benchmarks WHERE id = ?').get(id) as { symbol: string } | undefined;
  
  if (!benchmark) {
    return res.status(404).json({ error: 'Benchmark not found' });
  }

  const summary = db.prepare(`
    SELECT 
      MIN(price_date) as oldest,
      MAX(price_date) as latest,
      COUNT(*) as count
    FROM benchmark_history 
    WHERE index_name = ?
  `).get(benchmark.symbol) as { oldest: string | null; latest: string | null; count: number };

  res.json(summary.count > 0 ? summary : null);
});

router.post('/benchmarks/:id/fetch', async (req, res) => {
  const { id } = req.params;
  try {
    const benchmark = db.prepare('SELECT symbol, name FROM user_benchmarks WHERE id = ?').get(id) as { symbol: string; name: string } | undefined;
    
    if (!benchmark) {
      return res.status(404).json({ error: 'Benchmark not found' });
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
