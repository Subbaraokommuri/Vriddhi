import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import fs from 'fs';
import { CONFIG } from './lib/config.ts';
import { db, initDb, log } from './lib/db.ts';
import { xirr, calcMirrorXirr } from './lib/xirr.ts';
import fundsRouter from './routes/funds.ts';
import transactionsRouter from './routes/transactions.ts';
import navRouter from './routes/nav.ts';
import portfoliosRouter from './routes/portfolios.ts';
import benchmarksRouter from './routes/benchmarks.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initDb();

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api', fundsRouter);
  app.use('/api', transactionsRouter);
  app.use('/api', navRouter);
  app.use('/api', portfoliosRouter);
  app.use('/api', benchmarksRouter);

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
