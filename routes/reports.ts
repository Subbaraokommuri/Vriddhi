import express from 'express';
import { db } from '../lib/db.ts';
import { xirr } from '../lib/xirr.ts';

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

export default router;
