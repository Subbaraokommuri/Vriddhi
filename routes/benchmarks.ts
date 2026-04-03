import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import yahooFinance from 'yahoo-finance2';
import { db, log } from '../lib/db.ts';
import { CONFIG } from '../lib/config.ts';

const router = express.Router();

router.get('/user-benchmarks', (req, res) => {
  const benchmarks = db.prepare('SELECT * FROM user_benchmarks').all();
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

router.post('/fetch-all-benchmarks', async (req, res) => {
  const benchmarks = db.prepare('SELECT * FROM user_benchmarks WHERE is_active = 1').all() as any[];
  const updated = [];

  for (const b of benchmarks) {
    try {
      if (b.source === 'yahoo') {
        const result = await yahooFinance.historical(b.symbol, { period1: '2010-01-01' }) as any[];
        const insert = db.prepare('INSERT OR REPLACE INTO benchmark_prices (symbol, name, date, close, source) VALUES (?, ?, ?, ?, ?)');
        const transaction = db.transaction((data) => {
          for (const item of data) {
            insert.run(b.symbol, b.name, item.date.toISOString().split('T')[0], item.close, 'index');
          }
        });
        transaction(result);
        updated.push({ name: b.name, days_fetched: result.length });
      } else if (b.source === 'mf') {
        const response = await fetch(`${CONFIG.APIS.MF_DATA}${b.symbol}`);
        const data = await response.json() as any;
        if (data && data.data) {
          const insert = db.prepare('INSERT OR REPLACE INTO benchmark_prices (symbol, name, date, close, source, amfi_code) VALUES (?, ?, ?, ?, ?, ?)');
          const transaction = db.transaction((items) => {
            for (const item of items) {
              const [d, m, y] = item.date.split('-');
              const isoDate = `${y}-${m}-${d}`;
              insert.run(b.symbol, b.name, isoDate, parseFloat(item.nav), 'mf', b.symbol);
            }
          });
          transaction(data.data);
          updated.push({ name: b.name, days_fetched: data.data.length });
        }
      }
    } catch (e) {
      log('app', 'ERROR', 'BENCHMARK', `Failed to fetch benchmark ${b.name}: ${String(e)}`);
      console.error(`Failed to fetch benchmark ${b.name}`, e);
    }
  }
  log('app', 'INFO', 'BENCHMARK', `Benchmark update complete: ${updated.length} benchmarks updated`);
  res.json({ updated });
});

router.post('/fetch-mf-benchmark', async (req, res) => {
  const { amfi_code, name } = req.body;
  try {
    const response = await fetch(`${CONFIG.APIS.MF_DATA}${amfi_code}`);
    const data = await response.json() as any;
    if (data && data.data) {
      const insert = db.prepare('INSERT OR REPLACE INTO benchmark_prices (symbol, name, date, close, source, amfi_code) VALUES (?, ?, ?, ?, ?, ?)');
      const transaction = db.transaction((items) => {
        for (const item of items) {
          const [d, m, y] = item.date.split('-');
          const isoDate = `${y}-${m}-${d}`;
          insert.run(amfi_code, name, isoDate, parseFloat(item.nav), 'mf', amfi_code);
        }
      });
      transaction(data.data);
      log('app', 'INFO', 'BENCHMARK', `Fetched MF benchmark ${name} (${amfi_code}): ${data.data.length} days`);
      res.json({ count: data.data.length });
    } else {
      log('app', 'WARN', 'BENCHMARK', `MF benchmark ${name} (${amfi_code}) not found`);
      res.status(404).json({ error: 'MF not found' });
    }
  } catch (e) {
    log('app', 'ERROR', 'BENCHMARK', `Failed to fetch MF benchmark ${name} (${amfi_code}): ${String(e)}`);
    res.status(500).json({ error: String(e) });
  }
});

router.get('/portfolio-growth-vs-benchmark', (req, res) => {
  const { benchmark_symbol } = req.query as any;
  const txns = db.prepare('SELECT date, amount, units, folio_id, transaction_type FROM transactions ORDER BY date ASC').all() as any[];
  if (txns.length === 0) return res.json([]);

  const startDate = new Date(txns[0].date);
  const endDate = new Date();
  const result = [];

  // Get all unique fund IDs
  const fundIds = [...new Set(txns.map(t => t.folio_id))];
  const navs: Record<string, any[]> = {};
  for (const id of fundIds) {
    navs[id] = db.prepare('SELECT date, nav FROM nav_history WHERE fund_id = ? ORDER BY date ASC').all(id) as any[];
  }

  const benchmarkPrices = db.prepare('SELECT date, close FROM benchmark_prices WHERE symbol = ? ORDER BY date ASC').all(benchmark_symbol) as any[];
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
        // For simplicity, we don't sell benchmark units here, we just track growth of invested capital
      }
    }

    // Calculate current values
    let portfolioValue = 0;
    for (const id in currentPortfolioUnits) {
      const fundNavs = navs[id];
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
