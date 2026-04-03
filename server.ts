import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import yahooFinance from 'yahoo-finance2';
import { CONFIG } from './lib/config.ts';
import { db, initDb, log } from './lib/db.ts';
import { xirr, calcMirrorXirr } from './lib/xirr.ts';
import fundsRouter from './routes/funds.ts';
import transactionsRouter from './routes/transactions.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initDb();

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api', fundsRouter);
  app.use('/api', transactionsRouter);

  // API Routes
  app.get('/api/summary', (req, res) => {
    const folios = db.prepare(`
      SELECT f.id, f.fund_id, 
             SUM(CASE WHEN t.transaction_type = 'buy' THEN t.units ELSE -t.units END) as current_units,
             SUM(CASE WHEN t.transaction_type = 'buy' THEN t.amount ELSE -t.amount END) as invested_amount
      FROM folios f
      JOIN transactions t ON f.id = t.folio_id
      GROUP BY f.id
    `).all() as any[];

    let totalInvested = 0;
    let currentValue = 0;
    const allCashflows: { date: Date; amount: number }[] = [];

    for (const folio of folios) {
      const latestNav = db.prepare('SELECT nav FROM nav_history WHERE fund_id = ? ORDER BY date DESC LIMIT 1').get(folio.fund_id) as any;
      const nav = latestNav ? latestNav.nav : 0;
      
      totalInvested += folio.invested_amount;
      currentValue += folio.current_units * nav;

      const txns = db.prepare('SELECT date, amount, transaction_type FROM transactions WHERE folio_id = ?').all(folio.id) as any[];
      for (const t of txns) {
        allCashflows.push({
          date: new Date(t.date),
          amount: t.transaction_type === 'buy' ? -t.amount : t.amount
        });
      }
    }

    if (currentValue > 0) {
      allCashflows.push({
        date: new Date(),
        amount: currentValue
      });
    }

    allCashflows.sort((a, b) => a.date.getTime() - b.date.getTime());
    let overallXirr = null;
    try {
      if (allCashflows.length >= 2) {
        overallXirr = xirr(allCashflows).value;
      }
    } catch (e) {
      console.warn('Overall XIRR calculation failed:', e);
    }

    const currentYear = new Date().getFullYear().toString();
    const yearlyInvested = db.prepare(`
      SELECT SUM(amount) as total 
      FROM transactions 
      WHERE transaction_type = 'buy' AND date LIKE ?
    `).get(`${currentYear}%`) as any;

    res.json({
      totalInvested,
      currentValue,
      gain: currentValue - totalInvested,
      xirr: overallXirr,
      yearlyInvested: yearlyInvested ? yearlyInvested.total : 0
    });
  });

  app.post('/api/fetch-nav', async (req, res) => {
    const funds = db.prepare('SELECT id, amfi_code FROM funds WHERE amfi_code IS NOT NULL').all() as any[];
    let updated = 0;

    for (const fund of funds) {
      try {
        const response = await fetch(`${CONFIG.APIS.MF_DATA}${fund.amfi_code}`);
        const data = await response.json() as any;
        if (data && data.data && data.data.length > 0) {
          const latest = data.data[0];
          // Date format in mfapi is DD-MM-YYYY, convert to YYYY-MM-DD
          const [d, m, y] = latest.date.split('-');
          const isoDate = `${y}-${m}-${d}`;
          db.prepare('INSERT OR REPLACE INTO nav_history (fund_id, date, nav) VALUES (?, ?, ?)').run(fund.id, isoDate, parseFloat(latest.nav));
          updated++;
        }
      } catch (e) {
        log('app', 'ERROR', 'NAV', `Failed to fetch NAV for ${fund.id}: ${String(e)}`);
        console.error(`Failed to fetch NAV for ${fund.id}`, e);
      }
    }
    log('app', 'INFO', 'NAV', `NAV update complete: ${updated} funds updated`);
    res.json({ updated });
  });

  app.post('/api/portfolios', (req, res) => {
    const { name, description, color } = req.body;
    const id = uuidv4();
    db.prepare('INSERT INTO portfolios (id, name, description, color) VALUES (?, ?, ?, ?)').run(id, name, description, color || CONFIG.DEFAULT_THEME_COLOR);
    res.json({ id });
  });

  app.get('/api/portfolios', (req, res) => {
    const portfolios = db.prepare('SELECT * FROM portfolios').all() as any[];
    const result = portfolios.map(p => {
      const folios = db.prepare(`
        SELECT f.*, fu.name as fund_name
        FROM portfolio_assets pa
        JOIN folios f ON pa.asset_id = f.id
        JOIN funds fu ON f.fund_id = fu.id
        WHERE pa.portfolio_id = ? AND pa.asset_type = 'mf'
      `).all(p.id) as any[];

      // Calculate XIRR for portfolio
      const allCashflows: { date: Date; amount: number }[] = [];
      let currentValue = 0;
      let investedAmount = 0;

      for (const folio of folios) {
        const txns = db.prepare('SELECT date, amount, units, transaction_type FROM transactions WHERE folio_id = ?').all(folio.id) as any[];
        const latestNav = db.prepare('SELECT nav FROM nav_history WHERE fund_id = ? ORDER BY date DESC LIMIT 1').get(folio.fund_id) as any;
        const nav = latestNav ? latestNav.nav : 0;

        let currentUnits = 0;
        for (const t of txns) {
          const amount = t.transaction_type === 'buy' ? -t.amount : t.amount;
          allCashflows.push({ date: new Date(t.date), amount });
          if (t.transaction_type === 'buy') {
            currentUnits += t.units;
            investedAmount += t.amount;
          } else {
            currentUnits -= t.units;
            investedAmount -= t.amount;
          }
        }
        if (currentUnits > 0 && nav > 0) {
          currentValue += currentUnits * nav;
        }
      }

      if (currentValue > 0) {
        allCashflows.push({ date: new Date(), amount: currentValue });
      }

      allCashflows.sort((a, b) => a.date.getTime() - b.date.getTime());
      let portfolioXirr = null;
      try {
        if (allCashflows.length >= 2) {
          portfolioXirr = xirr(allCashflows).value;
        }
      } catch (e) {
        console.warn(`XIRR calculation failed for portfolio ${p.id}:`, e);
      }

      return { ...p, folios, xirr: portfolioXirr, currentValue, investedAmount };
    });
    res.json(result);
  });

  app.post('/api/portfolio-folio', (req, res) => {
    const { portfolio_id, folio_id } = req.body;
    db.prepare("INSERT OR IGNORE INTO portfolio_assets (portfolio_id, asset_type, asset_id) VALUES (?, 'mf', ?)").run(portfolio_id, folio_id);
    res.json({ success: true });
  });

  app.delete('/api/portfolio-folio', (req, res) => {
    const { portfolio_id, folio_id } = req.body;
    db.prepare("DELETE FROM portfolio_assets WHERE portfolio_id = ? AND asset_type = 'mf' AND asset_id = ?").run(portfolio_id, folio_id);
    res.json({ success: true });
  });

  app.get('/api/user-benchmarks', (req, res) => {
    const benchmarks = db.prepare('SELECT * FROM user_benchmarks').all();
    res.json(benchmarks);
  });

  app.post('/api/user-benchmarks', (req, res) => {
    const { symbol, name, source, category, color } = req.body;
    const id = uuidv4();
    db.prepare('INSERT INTO user_benchmarks (id, symbol, name, source, category, color) VALUES (?, ?, ?, ?, ?, ?)').run(id, symbol, name, source, category, color);
    res.json({ id });
  });

  app.delete('/api/user-benchmarks/:id', (req, res) => {
    const { id } = req.params;
    db.prepare('DELETE FROM user_benchmarks WHERE id = ?').run(id);
    res.json({ success: true });
  });

  app.post('/api/fetch-all-benchmarks', async (req, res) => {
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

  app.post('/api/fetch-mf-benchmark', async (req, res) => {
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

  app.get('/api/benchmark-xirr', (req, res) => {
    const { portfolio_id, folio_id, benchmark_ids } = req.query as any;
    const benchmarkIds = Array.isArray(benchmark_ids) ? benchmark_ids : [benchmark_ids];
    
    let cashflows: { date: Date; amount: number; type: 'buy' | 'sell' }[] = [];
    let actualXirr = null;

    if (portfolio_id === 'all') {
      const folios = db.prepare('SELECT id FROM folios').all() as any[];
      const allCf: { date: Date; amount: number }[] = [];
      let totalCurrentValue = 0;

      for (const f of folios) {
        const txns = db.prepare('SELECT date, amount, units, transaction_type FROM transactions WHERE folio_id = ?').all(f.id) as any[];
        const latestNav = db.prepare('SELECT nav FROM nav_history WHERE fund_id = ? ORDER BY date DESC LIMIT 1').get(f.id) as any;
        const nav = latestNav ? latestNav.nav : 0;
        let currentUnits = 0;

        for (const t of txns) {
          const type = t.transaction_type as 'buy' | 'sell';
          const amount = type === 'buy' ? -t.amount : t.amount;
          cashflows.push({ date: new Date(t.date), amount, type });
          allCf.push({ date: new Date(t.date), amount });
          if (type === 'buy') currentUnits += t.units;
          else currentUnits -= t.units;
        }
        if (currentUnits > 0 && nav > 0) {
          totalCurrentValue += currentUnits * nav;
        }
      }
      if (totalCurrentValue > 0) {
        allCf.push({ date: new Date(), amount: totalCurrentValue });
      }
      allCf.sort((a, b) => a.date.getTime() - b.date.getTime());
      try {
        actualXirr = allCf.length >= 2 ? xirr(allCf).value : null;
      } catch (e) {
        console.warn('XIRR calculation failed for all portfolios:', e);
      }
    } else if (portfolio_id) {
      const assets = db.prepare("SELECT asset_id FROM portfolio_assets WHERE portfolio_id = ? AND asset_type = 'mf'").all(portfolio_id) as any[];
      const allCf: { date: Date; amount: number }[] = [];
      let totalCurrentValue = 0;

      for (const a of assets) {
        const txns = db.prepare('SELECT date, amount, units, transaction_type FROM transactions WHERE folio_id = ?').all(a.asset_id) as any[];
        const latestNav = db.prepare('SELECT nav FROM nav_history WHERE fund_id = ? ORDER BY date DESC LIMIT 1').get(a.asset_id) as any;
        const nav = latestNav ? latestNav.nav : 0;
        let currentUnits = 0;

        for (const t of txns) {
          const type = t.transaction_type as 'buy' | 'sell';
          const amount = type === 'buy' ? -t.amount : t.amount;
          cashflows.push({ date: new Date(t.date), amount, type });
          allCf.push({ date: new Date(t.date), amount });
          if (type === 'buy') currentUnits += t.units;
          else currentUnits -= t.units;
        }
        if (currentUnits > 0 && nav > 0) {
          totalCurrentValue += currentUnits * nav;
        }
      }
      if (totalCurrentValue > 0) {
        allCf.push({ date: new Date(), amount: totalCurrentValue });
      }
      allCf.sort((a, b) => a.date.getTime() - b.date.getTime());
      try {
        actualXirr = allCf.length >= 2 ? xirr(allCf).value : null;
      } catch (e) {
        console.warn(`XIRR calculation failed for portfolio ${portfolio_id}:`, e);
      }
    } else if (folio_id) {
      const txns = db.prepare('SELECT date, amount, units, transaction_type FROM transactions WHERE folio_id = ?').all(folio_id) as any[];
      const latestNav = db.prepare('SELECT nav FROM nav_history WHERE fund_id = ? ORDER BY date DESC LIMIT 1').get(folio_id) as any;
      const nav = latestNav ? latestNav.nav : 0;
      let currentUnits = 0;
      const allCf: { date: Date; amount: number }[] = [];

      for (const t of txns) {
        const type = t.transaction_type as 'buy' | 'sell';
        const amount = type === 'buy' ? -t.amount : t.amount;
        cashflows.push({ date: new Date(t.date), amount, type });
        allCf.push({ date: new Date(t.date), amount });
        if (type === 'buy') currentUnits += t.units;
        else currentUnits -= t.units;
      }
      if (currentUnits > 0 && nav > 0) {
        allCf.push({ date: new Date(), amount: currentUnits * nav });
      }
      allCf.sort((a, b) => a.date.getTime() - b.date.getTime());
      try {
        actualXirr = allCf.length >= 2 ? xirr(allCf).value : null;
      } catch (e) {
        console.warn(`XIRR calculation failed for folio ${folio_id}:`, e);
      }
    }

    const benchmarks = [];
    for (const bid of benchmarkIds) {
      const b = db.prepare('SELECT * FROM user_benchmarks WHERE id = ?').get(bid) as any;
      if (b) {
        const context = folio_id ? `folio ${folio_id}` : (portfolio_id === 'all' ? 'all portfolios' : `portfolio ${portfolio_id}`);
        
        const benchmarkPrices = db.prepare('SELECT date, close FROM benchmark_prices WHERE symbol = ?').all(b.symbol) as any[];
        const latestPriceRow = db.prepare('SELECT close FROM benchmark_prices WHERE symbol = ? ORDER BY date DESC LIMIT 1').get(b.symbol) as any;
        const latestPrice = latestPriceRow ? latestPriceRow.close : null;

        const bResult = calcMirrorXirr(cashflows, benchmarkPrices, latestPrice, {
          minDays: CONFIG.XIRR.MIN_DAYS,
          toleranceDays: CONFIG.XIRR.BENCHMARK_TOLERANCE_DAYS
        });

        const bXirr = bResult.value;
        log('benchmark', 'INFO', 'BENCHMARK', `Mirror XIRR for ${context} vs ${b.symbol}: result: ${bXirr !== null ? (bXirr * 100).toFixed(1) + '%' : 'N/A'}`);

        benchmarks.push({
          name: b.name,
          xirr: bXirr,
          diff: (actualXirr !== null && bXirr !== null) ? actualXirr - bXirr : null
        });
      }
    }

    res.json({ actual_xirr: actualXirr, benchmarks });
  });

  app.get('/api/portfolio-growth-vs-benchmark', (req, res) => {
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

  app.get('/api/logs', (req, res) => {
    const { type, date } = req.query as { type: string, date: string };
    if (!type || !date) return res.status(400).send('Missing type or date');
    const logFile = path.join(process.cwd(), 'logs', `${type}-${date}.log`);
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      res.header('Content-Type', 'text/plain');
      res.send(content);
    } else {
      res.status(404).send('Log file not found');
    }
  });

  // Vite setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(3000, '0.0.0.0', () => {
    console.log('Server running on http://localhost:3000');
  });
}

startServer();
