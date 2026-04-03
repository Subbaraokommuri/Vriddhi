import express from 'express';
import { db } from '../lib/db.ts';
import { xirr } from '../lib/xirr.ts';

const router = express.Router();

router.get('/summary', (req, res) => {
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

export default router;
