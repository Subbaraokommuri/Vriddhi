import express from 'express';
import { db, log } from '../lib/db.ts';
import { xirr, calcMirrorXirr } from '../lib/xirr.ts';
import { CONFIG } from '../lib/config.ts';

const router = express.Router();

router.get('/benchmark-xirr', (req, res) => {
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
      const fund = db.prepare('SELECT fu.isin FROM funds fu JOIN folios f ON f.fund_id = fu.id WHERE f.id = ?').get(f.id) as any;
      const latestNav = fund?.isin
        ? db.prepare('SELECT nav FROM nav_history WHERE isin = ? ORDER BY nav_date DESC LIMIT 1').get(fund.isin) as any
        : null;
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
      const fund = db.prepare('SELECT fu.isin FROM funds fu JOIN folios f ON f.fund_id = fu.id WHERE f.id = ?').get(a.asset_id) as any;
      const latestNav = fund?.isin
        ? db.prepare('SELECT nav FROM nav_history WHERE isin = ? ORDER BY nav_date DESC LIMIT 1').get(fund.isin) as any
        : null;
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
    const fund = db.prepare('SELECT fu.isin FROM funds fu JOIN folios f ON f.fund_id = fu.id WHERE f.id = ?').get(folio_id) as any;
    const latestNav = fund?.isin
      ? db.prepare('SELECT nav FROM nav_history WHERE isin = ? ORDER BY nav_date DESC LIMIT 1').get(fund.isin) as any
      : null;
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

export default router;
