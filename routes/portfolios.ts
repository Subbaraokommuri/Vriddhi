import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, log } from '../lib/db.ts';
import { xirr } from '../lib/xirr.ts';
import { CONFIG } from '../lib/config.ts';

const router = express.Router();

router.post('/portfolios', (req, res) => {
  const { name, description, color } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO portfolios (id, name, description, color) VALUES (?, ?, ?, ?)').run(id, name, description, color || CONFIG.DEFAULT_THEME_COLOR);
  res.json({ id });
});

router.get('/portfolios', (req, res) => {
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
      const fund = db.prepare('SELECT isin FROM funds WHERE id = ?').get(folio.fund_id) as any;
      const latestNav = fund?.isin
        ? db.prepare('SELECT nav FROM nav_history WHERE isin = ? ORDER BY nav_date DESC LIMIT 1').get(fund.isin) as any
        : null;
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

    // Terminal cashflow pushed ONCE after the folios loop
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

router.post('/portfolio-folio', (req, res) => {
  const { portfolio_id, folio_id } = req.body;
  db.prepare("INSERT OR IGNORE INTO portfolio_assets (portfolio_id, asset_type, asset_id) VALUES (?, 'mf', ?)").run(portfolio_id, folio_id);
  res.json({ success: true });
});

router.delete('/portfolio-folio', (req, res) => {
  const { portfolio_id, folio_id } = req.body;
  db.prepare("DELETE FROM portfolio_assets WHERE portfolio_id = ? AND asset_type = 'mf' AND asset_id = ?").run(portfolio_id, folio_id);
  res.json({ success: true });
});

export default router;
