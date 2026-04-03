import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, log } from '../lib/db.ts';
import { xirr } from '../lib/xirr.ts';
import { CONFIG } from '../lib/config.ts';

const router = express.Router();

router.get('/funds', (req, res) => {
  const funds = db.prepare('SELECT * FROM funds').all();
  res.json(funds);
});

router.post('/funds', (req, res) => {
  const { name, isin, scheme_code, amfi_code, category } = req.body;
  const id = isin || uuidv4();
  db.prepare('INSERT INTO funds (id, name, isin, scheme_code, amfi_code, category) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, isin, scheme_code, amfi_code, category);
  res.json({ id });
});

router.get('/folios', (req, res) => {
  const folios = db.prepare(`
    SELECT f.*, fu.name as fund_name, fu.category
    FROM folios f
    JOIN funds fu ON f.fund_id = fu.id
  `).all() as any[];

  const result = folios.map(folio => {
    const txns = db.prepare('SELECT date, amount, units, transaction_type FROM transactions WHERE folio_id = ?').all(folio.id) as any[];
    const latestNav = db.prepare('SELECT nav FROM nav_history WHERE fund_id = ? ORDER BY date DESC LIMIT 1').get(folio.fund_id) as any;
    const nav = latestNav ? latestNav.nav : 0;

    let currentUnits = 0;
    let investedAmount = 0;
    const cashflows: { date: Date; amount: number }[] = [];

    for (const t of txns) {
      if (t.transaction_type === 'buy') {
        currentUnits += t.units;
        investedAmount += t.amount;
        cashflows.push({ date: new Date(t.date), amount: -t.amount });
      } else {
        currentUnits -= t.units;
        investedAmount -= t.amount;
        cashflows.push({ date: new Date(t.date), amount: t.amount });
      }
    }

    if (currentUnits > 0 && nav > 0) {
      cashflows.push({ date: new Date(), amount: currentUnits * nav });
    }

    cashflows.sort((a, b) => a.date.getTime() - b.date.getTime());
    let folioXirr = null;
    try {
      if (cashflows.length >= 2) {
        folioXirr = xirr(cashflows).value;
      }
    } catch (e) {
      console.warn(`XIRR calculation failed for folio ${folio.id}:`, e);
    }

    return {
      ...folio,
      currentUnits,
      investedAmount,
      currentValue: currentUnits * nav,
      xirr: folioXirr
    };
  });

  res.json(result);
});

router.put('/funds/:id/nav', (req, res) => {
  const { id } = req.params;
  const { nav, date } = req.body;
  db.prepare('INSERT OR REPLACE INTO nav_history (fund_id, date, nav) VALUES (?, ?, ?)').run(id, date || new Date().toISOString().split('T')[0], nav);
  res.json({ success: true });
});

export default router;
