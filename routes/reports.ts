import express from 'express';
import { db } from '../lib/db.ts';
import { xirr } from '../lib/xirr.ts';
import { groupTransactionsByCY, calcYoYGrowth, calcRollingAvgGrowth } from '../lib/finance.ts';
import { log } from '../lib/logger.ts';

const router = express.Router();

router.get('/summary', (req, res) => {
  const folios = db.prepare(`
    SELECT f.id, fu.isin,
      f.stated_balance,
      f.stated_cost,
      f.stated_market_value
    FROM folios f
    JOIN funds fu ON f.fund_id = fu.id
  `).all() as any[];

  let totalInvested = 0;
  let currentValue = 0;
  const allCashflows: { date: Date; amount: number }[] = [];

  for (const folio of folios) {
    // Use stated values directly from CAS — authoritative and correct
    totalInvested += (folio.stated_cost || 0);
    
    // Current value = stated_balance × latest NAV (live price)
    const latestNav = db.prepare(
      'SELECT nav FROM nav_history WHERE isin = ? ORDER BY nav_date DESC LIMIT 1'
    ).get(folio.isin) as any;
    const nav = latestNav ? latestNav.nav : 0;
    currentValue += (folio.stated_balance || 0) * nav;

    // XIRR cashflows — use natural signs, negate amount for convention
    const txns = db.prepare(
      'SELECT date, amount FROM transactions WHERE folio_id = ?'
    ).all(folio.id) as any[];
    for (const t of txns) {
      allCashflows.push({ date: new Date(t.date), amount: -(t.amount) });
    }
  }

  // Cashflow bug fix: terminal cashflow pushed ONCE after the folios loop
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

  const now = new Date();
  const fyStart = now.getMonth() >= 3  // April = month 3 (0-indexed)
    ? `${now.getFullYear()}-04-01`
    : `${now.getFullYear() - 1}-04-01`;
  
  const yearlyInvested = db.prepare(`
    SELECT SUM(amount) as total
    FROM transactions
    WHERE transaction_type = 'buy'
    AND amount > 0
    AND date >= ?
  `).get(fyStart) as any;

  res.json({
    totalInvested,
    currentValue,
    gain: currentValue - totalInvested,
    xirr: overallXirr,
    yearlyInvested: yearlyInvested ? yearlyInvested.total : 0
  });
});

router.get('/investment-trend', (req, res) => {
  try {
    const rawTxns = db.prepare('SELECT date, amount FROM transactions ORDER BY date ASC').all() as any[];
    
    const transactions = rawTxns.map(t => ({
      date: t.date,
      amount: t.amount
    }));

    const grouped = groupTransactionsByCY(transactions);
    const withYoY = calcYoYGrowth(grouped);
    const withRolling = calcRollingAvgGrowth(withYoY);

    const currentYear = new Date().getFullYear().toString();
    const data = withRolling.map(row => ({
      ...row,
      isPartialYear: row.year === currentYear
    }));

    res.json({ data });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log('app', 'ERROR', 'investment-trend', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/dashboard-stats', (req, res) => {
  try {
    const truncate = (name: string) => name.length > 30 ? name.substring(0, 30) + '…' : name;

    // Query 1: Counts and Plan Mix
    const counts = db.prepare(`
      SELECT
        COUNT(*) as totalFolios,
        SUM(CASE WHEN f.stated_balance > 0 THEN 1 ELSE 0 END) as activeFolios,
        COUNT(DISTINCT CASE WHEN f.stated_balance > 0 THEN f.fund_id END) as activeFunds,
        SUM(CASE WHEN f.stated_balance > 0 AND (fu.plan = 'Direct' OR fu.name LIKE '%Direct%') THEN 1 ELSE 0 END) as directCount,
        SUM(CASE WHEN f.stated_balance > 0 AND (fu.plan IS NULL OR (fu.plan != 'Direct' AND fu.name NOT LIKE '%Direct%')) THEN 1 ELSE 0 END) as regularCount
      FROM folios f
      LEFT JOIN funds fu ON f.fund_id = fu.id
    `).get() as any;

    // Query 2: Best Return Fund
    const bestReturn = db.prepare(`
      SELECT
        fu.name,
        f.stated_cost,
        (f.stated_balance * n.nav) as currentValue
      FROM folios f
      JOIN funds fu ON f.fund_id = fu.id
      JOIN (
        SELECT isin, nav, nav_date
        FROM nav_history
        WHERE (isin, nav_date) IN (
          SELECT isin, MAX(nav_date) FROM nav_history GROUP BY isin
        )
      ) n ON fu.isin = n.isin
      WHERE f.stated_balance > 0 AND f.stated_cost > 0
      ORDER BY ((f.stated_balance * n.nav) - f.stated_cost) / f.stated_cost DESC
      LIMIT 1
    `).get() as any;

    let bestReturnFund = null;
    if (bestReturn) {
      const gainPercent = ((bestReturn.currentValue - bestReturn.stated_cost) / bestReturn.stated_cost) * 100;
      bestReturnFund = {
        name: truncate(bestReturn.name),
        gainPercent: Math.round(gainPercent * 100) / 100
      };
    }

    // Query 3: Highest Loss Fund
    const highestLoss = db.prepare(`
      SELECT
        fu.name,
        f.stated_cost,
        (f.stated_balance * n.nav) as currentValue
      FROM folios f
      JOIN funds fu ON f.fund_id = fu.id
      JOIN (
        SELECT isin, nav, nav_date
        FROM nav_history
        WHERE (isin, nav_date) IN (
          SELECT isin, MAX(nav_date) FROM nav_history GROUP BY isin
        )
      ) n ON fu.isin = n.isin
      WHERE f.stated_balance > 0 AND f.stated_cost > 0 AND (f.stated_balance * n.nav) < f.stated_cost
      ORDER BY (f.stated_balance * n.nav) - f.stated_cost ASC
      LIMIT 1
    `).get() as any;

    let highestLossFund = null;
    if (highestLoss) {
      highestLossFund = {
        name: truncate(highestLoss.name),
        absoluteLoss: Math.round(highestLoss.stated_cost - highestLoss.currentValue)
      };
    }

    // Query 4: Average holding age
    let avgHoldingAgeYears = 0;
    try {
      const ageRows = db.prepare(`
        SELECT (julianday('now') - julianday(firstDate)) / 365.25 as ageYears
        FROM (
          SELECT t.folio_id, MIN(t.date) as firstDate
          FROM transactions t
          JOIN folios f ON t.folio_id = f.id
          WHERE f.stated_balance > 0
          GROUP BY t.folio_id
        )
      `).all() as { ageYears: number }[];

      if (ageRows.length > 0) {
        const total = ageRows.reduce((sum, r) => sum + (r.ageYears ?? 0), 0);
        avgHoldingAgeYears = Math.round((total / ageRows.length) * 10) / 10;
      }
    } catch (e: any) {
      log('app', 'WARN', 'dashboard-stats', `Avg holding age query failed: ${e.message}`);
    }

    const stats = {
      totalFolios: counts.totalFolios || 0,
      activeFolios: counts.activeFolios || 0,
      activeFunds: counts.activeFunds || 0,
      directCount: counts.directCount || 0,
      regularCount: counts.regularCount || 0,
      bestReturnFund,
      highestLossFund,
      avgHoldingAgeYears: avgHoldingAgeYears
    };

    log('app', 'INFO', 'dashboard-stats', 'Dashboard stats computed successfully');
    res.json(stats);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log('app', 'ERROR', 'dashboard-stats', msg);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});

export default router;
