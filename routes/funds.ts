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
    SELECT f.*, fu.name as fund_name, fu.category, fu.isin
    FROM folios f
    JOIN funds fu ON f.fund_id = fu.id
  `).all() as any[];

  const result = folios.map(folio => {
    const txns = db.prepare('SELECT date, amount, units, transaction_type FROM transactions WHERE folio_id = ?').all(folio.id) as any[];
    const latestNav = db.prepare('SELECT nav, nav_date as date FROM nav_history WHERE isin = ? ORDER BY nav_date DESC LIMIT 1').get(folio.isin) as any;
    const nav = latestNav ? latestNav.nav : 0;
    const navDate = latestNav ? latestNav.date : null;

    let currentUnits = 0;
    let investedAmount = 0;
    const cashflows: { date: Date; amount: number }[] = [];

    for (const t of txns) {
      currentUnits += t.units;
      investedAmount += t.amount;
      cashflows.push({ date: new Date(t.date), amount: -(t.amount) });
    }
    currentUnits = Math.max(0, currentUnits);

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
      stated_balance: folio.stated_balance,
      stated_market_value: folio.stated_market_value,
      currentValue: currentUnits * nav,
      nav,
      navDate,
      xirr: folioXirr
    };
  });

  res.json(result);
});

router.put('/funds/:id/nav', (req, res) => {
  const { id } = req.params;
  const { nav, date } = req.body;
  const fund = db.prepare('SELECT isin FROM funds WHERE id = ?').get(id) as any;
  if (fund && fund.isin) {
    db.prepare('INSERT OR REPLACE INTO nav_history (isin, nav_date, nav) VALUES (?, ?, ?)').run(fund.isin, date || new Date().toISOString().split('T')[0], nav);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Fund ISIN missing' });
  }
});

router.get('/export-holdings-csv', (req, res) => {
  try {
    const folios = db.prepare(`
      SELECT f.id, f.folio_number, fu.isin, fu.name as fund_name, fu.id as fund_id
      FROM folios f
      JOIN funds fu ON f.fund_id = fu.id
      ORDER BY fu.name ASC, f.folio_number ASC
    `).all() as any[];

    const rows: string[] = [
      'Folio,ISIN,Fund_Name,Unit_Balance,Cost_Value,NAV_Date,NAV,Market_Value,Registrar'
    ];

    let totalCost = 0;
    let totalMarketValue = 0;

    for (const folio of folios) {
      const txns = db.prepare('SELECT amount, units, transaction_type FROM transactions WHERE folio_id = ?').all(folio.id) as any[];
      const latestNavData = db.prepare('SELECT nav, nav_date as date FROM nav_history WHERE isin = ? ORDER BY nav_date DESC LIMIT 1').get(folio.isin) as any;
      
      const nav = latestNavData ? latestNavData.nav : 0;
      const navDate = latestNavData ? latestNavData.date : '';

      let currentUnits = 0;
      let investedAmount = 0;

      for (const t of txns) {
        currentUnits += t.units;
        investedAmount += t.amount;
      }
      currentUnits = Math.max(0, currentUnits);

      const marketValue = currentUnits * nav;
      
      totalCost += investedAmount;
      totalMarketValue += marketValue;

      const escape = (val: any) => {
        const str = String(val ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      rows.push([
        escape(folio.folio_number),
        escape(folio.isin),
        escape(folio.fund_name),
        currentUnits.toFixed(4),
        investedAmount.toFixed(2),
        escape(navDate),
        nav.toFixed(4),
        marketValue.toFixed(2),
        '' // Registrar field (empty as it's not in DB)
      ].join(','));
    }

    // Totals row
    rows.push([
      'TOTAL',
      '',
      '',
      '',
      totalCost.toFixed(2),
      '',
      '',
      totalMarketValue.toFixed(2),
      ''
    ].join(','));

    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="holdings-export-${dateStr}.csv"`);
    res.status(200).send(rows.join('\n'));

  } catch (error) {
    log('app', 'ERROR', 'FUNDS', `Export failed: ${String(error)}`);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
