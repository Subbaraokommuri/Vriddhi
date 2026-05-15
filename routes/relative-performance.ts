import express from 'express';
import { db } from '../lib/db.ts';
import { log } from '../lib/logger.ts';
import { xirr, calcMirrorXirr } from '../lib/xirr.ts';
import { CONFIG } from '../lib/config.ts';

const router = express.Router();

router.get('/relative-performance', (req, res) => {
  const { theme_id, tag, benchmark_symbol } = req.query as { theme_id: string; tag: string; benchmark_symbol: string };

  if (!theme_id || !tag || !benchmark_symbol) {
    return res.status(400).json({ error: 'Missing required parameters: theme_id, tag, benchmark_symbol' });
  }

  try {
    // Step 1 — Resolve inputs
    const benchmarkPrices = db.prepare('SELECT price_date as date, value as close FROM benchmark_history WHERE index_name = ? ORDER BY price_date ASC').all(benchmark_symbol) as { date: string; close: number }[];
    const benchmarkInfo = db.prepare('SELECT name FROM user_benchmarks WHERE symbol = ? AND is_active = 1').get(benchmark_symbol) as { name: string } | undefined;
    const themeInfo = db.prepare('SELECT name FROM tag_themes WHERE id = ?').get(theme_id) as { name: string } | undefined;

    if (!benchmarkInfo) return res.status(404).json({ error: 'Benchmark not found or inactive' });
    if (benchmarkPrices.length === 0) return res.status(404).json({ error: 'No history data for benchmark' });
    if (!themeInfo) return res.status(404).json({ error: 'Theme not found' });

    const taggedFolios = db.prepare('SELECT DISTINCT folio_id FROM folio_tags WHERE theme_id = ? AND tag = ?').all(theme_id, tag) as { folio_id: string }[];
    if (taggedFolios.length === 0) return res.status(404).json({ error: 'No folios found for the specified tag' });

    const folioIds = taggedFolios.map(f => f.folio_id);
    const placeholders = folioIds.map(() => '?').join(',');
    const transactions = db.prepare(`
      SELECT t.date, t.amount, t.units, t.transaction_type, t.folio_id, f.fund_id, fu.isin, f.stated_balance
      FROM transactions t
      JOIN folios f ON t.folio_id = f.id
      JOIN funds fu ON f.fund_id = fu.id
      WHERE t.folio_id IN (${placeholders})
      ORDER BY t.date ASC
    `).all(...folioIds) as any[];

    if (transactions.length === 0) return res.status(404).json({ error: 'No transactions found for the tagged folios' });

    // Step 2 — Portfolio XIRR cashflows
    const cashflows: { date: Date; amount: number }[] = [];
    for (const t of transactions) {
      cashflows.push({ date: new Date(t.date), amount: -(t.amount) });
    }

    let totalCurrentValue = 0;
    const latestNavsStatement = db.prepare('SELECT nav FROM nav_history WHERE isin = ? ORDER BY nav_date DESC LIMIT 1');
    
    // Group folioIds by isin to avoid redundant queries in larger sets if multiple folios share same isin
    const uniqueIsins = Array.from(new Set(transactions.map(t => t.isin)));
    const navMap: Record<string, number> = {};
    for (const isin of uniqueIsins) {
      const result = latestNavsStatement.get(isin) as { nav: number } | undefined;
      navMap[isin] = result?.nav || 0;
    }

    // Step 5 Folio details gathering started here for Step 2 terminal value
    const foliosSummaryData = db.prepare(`
      SELECT f.id, f.folio_number, f.stated_balance, f.stated_cost, fu.name as fund_name, fu.isin, f.fund_id
      FROM folios f JOIN funds fu ON f.fund_id = fu.id
      WHERE f.id IN (${placeholders})
    `).all(...folioIds) as any[];

    for (const f of foliosSummaryData) {
      const nav = navMap[f.isin] || 0;
      totalCurrentValue += (f.stated_balance || 0) * nav;
    }

    const today = new Date();
    cashflows.push({ date: today, amount: totalCurrentValue });

    let portfolioXirr: number | null = null;
    let xirrWarning = false;

    try {
      const result = xirr(cashflows);
      portfolioXirr = result.value;
      if (result.suspect) xirrWarning = true;
    } catch (e) {
      log('app', 'ERROR', 'RELATIVE_PERF', `Portfolio XIRR failed: ${String(e)}`);
    }

    // Step 3 — Mirror XIRR
    const typedCashflows = transactions.map(t => ({
      date: new Date(t.date),
      amount: -(t.amount),
      type: t.transaction_type as 'buy' | 'sell'
    }));

    let benchmarkXirr: number | null = null;
    try {
      const latestBenchmarkPrice = benchmarkPrices[benchmarkPrices.length - 1].close;
      const result = calcMirrorXirr(
        typedCashflows,
        benchmarkPrices,
        latestBenchmarkPrice,
        { minDays: CONFIG.XIRR.MIN_DAYS, toleranceDays: CONFIG.XIRR.BENCHMARK_TOLERANCE_DAYS }
      );
      benchmarkXirr = result.value;
      if (result.suspect) xirrWarning = true;
    } catch (e) {
      log('app', 'ERROR', 'RELATIVE_PERF', `Mirror XIRR failed: ${String(e)}`);
    }

    if (portfolioXirr !== null && (portfolioXirr > 1.0 || portfolioXirr < -0.5)) xirrWarning = true;
    if (benchmarkXirr !== null && (benchmarkXirr > 1.0 || benchmarkXirr < -0.5)) xirrWarning = true;

    // Step 4 — Monthly time series
    const timeSeries: any[] = [];
    const firstTxnDate = new Date(transactions[0].date);
    let currentIterDate = new Date(firstTxnDate.getFullYear(), firstTxnDate.getMonth(), 1);
    const endIterDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    // Pre-calculate all available NAVs for all featured funds
    const allNavs = db.prepare(`SELECT isin, nav_date as date, nav FROM nav_history WHERE isin IN (${uniqueIsins.map(() => '?').join(',')}) ORDER BY nav_date ASC`).all(...uniqueIsins) as any[];
    const isinNavMap: Record<string, typeof allNavs> = {};
    for (const nav of allNavs) {
      if (!isinNavMap[nav.isin]) isinNavMap[nav.isin] = [];
      isinNavMap[nav.isin].push(nav);
    }

    const findClosestValue = (history: any[], date: Date, dateField: string, valueField: string) => {
      const targetDate = date.toISOString().split('T')[0];
      let closest = null;
      for (const entry of history) {
        if (entry[dateField] <= targetDate) {
          closest = entry[valueField];
        } else {
          break;
        }
      }
      return closest;
    };

    while (currentIterDate <= endIterDate) {
      const iterTarget = currentIterDate > today ? today : currentIterDate;
      const iterTargetStr = iterTarget.toISOString().split('T')[0];

      let investedValue = 0;
      let portfolioValue = 0;
      let benchmarkUnits = 0;

      const txnsUpToT = transactions.filter(t => t.date <= iterTargetStr);
      
      // Invested Value: sum of t.amount
      for (const t of txnsUpToT) {
        investedValue += t.amount;
      }

      // Portfolio Value: sum (units * NAV at T)
      const folioUnits: Record<string, { units: number, isin: string }> = {};
      for (const t of txnsUpToT) {
        if (!folioUnits[t.folio_id]) folioUnits[t.folio_id] = { units: 0, isin: t.isin };
        folioUnits[t.folio_id].units += t.units;
      }

      for (const fId in folioUnits) {
        const units = Math.max(0, folioUnits[fId].units);
        const navAtT = findClosestValue(isinNavMap[folioUnits[fId].isin] || [], iterTarget, 'date', 'nav');
        if (navAtT !== null) {
          portfolioValue += units * navAtT;
        } else {
          // If no NAV before date T, try the first available NAV but this is unlikely to be accurate.
          // Better logic: if no NAV, value is units * 0 or units * first known NAV. 
          // Usually we want the closest on or BEFORE.
        }
      }

      // Benchmark Value: mirrored buys
      const benchmarkPriceAtT = findClosestValue(benchmarkPrices, iterTarget, 'date', 'close');
      if (benchmarkPriceAtT !== null) {
        for (const t of txnsUpToT) {
          if (t.transaction_type === 'buy') {
            const price = findClosestValue(benchmarkPrices, new Date(t.date), 'date', 'close');
            if (price !== null) {
              benchmarkUnits += Math.abs(t.amount) / price;
            }
          } else if (t.transaction_type === 'sell') {
            const price = findClosestValue(benchmarkPrices, new Date(t.date), 'date', 'close');
            if (price !== null) {
              benchmarkUnits -= Math.abs(t.amount) / price;
            }
            benchmarkUnits = Math.max(0, benchmarkUnits);
          }
        }
        const benchmarkValue = benchmarkUnits * benchmarkPriceAtT;

        if (investedValue > 0) {
          timeSeries.push({
            date: iterTargetStr,
            portfolioValue: Math.round(portfolioValue),
            benchmarkValue: Math.round(benchmarkValue),
            investedValue: Math.round(investedValue)
          });
        }
      }

      if (currentIterDate > today) break;
      currentIterDate.setMonth(currentIterDate.getMonth() + 1);
      currentIterDate.setDate(1);
    }

    // Step 5 & 6 — Finalize response
    const lastPoint = timeSeries[timeSeries.length - 1];
    const finalInvested = lastPoint?.investedValue || 0;
    const finalPortfolio = lastPoint?.portfolioValue || 0;

    const responseFolios = foliosSummaryData.map(f => {
      const nav = navMap[f.isin] || 0;
      return {
        id: f.id,
        folio_number: f.folio_number,
        fund_name: f.fund_name,
        invested: f.stated_cost || 0,
        currentValue: (f.stated_balance || 0) * nav
      };
    });

    res.json({
      tag,
      theme: themeInfo.name,
      benchmarkName: benchmarkInfo.name,
      folioCount: folioIds.length,
      fundCount: new Set(foliosSummaryData.map(f => f.fund_id)).size,
      portfolioXirr,
      benchmarkXirr,
      alpha: (portfolioXirr !== null && benchmarkXirr !== null) ? (portfolioXirr - benchmarkXirr) : null,
      investedAmount: finalInvested,
      currentValue: finalPortfolio,
      unrealisedPnl: finalPortfolio - finalInvested,
      xirrWarning,
      timeSeries,
      folios: responseFolios
    });

  } catch (err) {
    log('app', 'ERROR', 'RELATIVE_PERF', `Failed to generate relative performance report: ${String(err)}`);
    res.status(500).json({ error: 'Internal server error while generating performance report' });
  }
});

export default router;
