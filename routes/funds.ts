import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/db.ts';
import { log } from '../lib/logger.ts';
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

// TAG MANAGEMENT ENDPOINTS

router.get('/tags/themes', (req, res) => {
  try {
    const themes = db.prepare('SELECT * FROM tag_themes ORDER BY sort_order ASC, name ASC').all() as any[];
    const result = themes.map(theme => {
      const tags = db.prepare('SELECT tag FROM theme_tags WHERE theme_id = ?').all(theme.id) as { tag: string }[];
      return {
        ...theme,
        tags: tags.map(t => t.tag)
      };
    });
    res.json(result);
  } catch (error) {
    log('app', 'ERROR', 'TAGS', `Failed to get themes: ${String(error)}`);
    res.status(500).json({ error: 'Failed to get themes' });
  }
});

router.post('/tags/themes', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const id = uuidv4();
    db.prepare('INSERT INTO tag_themes (id, name) VALUES (?, ?)').run(id, name);
    res.json({ id });
  } catch (error) {
    log('app', 'ERROR', 'TAGS', `Failed to create theme: ${String(error)}`);
    res.status(500).json({ error: 'Failed to create theme' });
  }
});

router.put('/tags/themes/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    db.prepare('UPDATE tag_themes SET name = ? WHERE id = ?').run(name, id);
    res.json({ success: true });
  } catch (error) {
    log('app', 'ERROR', 'TAGS', `Failed to update theme: ${String(error)}`);
    res.status(500).json({ error: 'Failed to update theme' });
  }
});

router.delete('/tags/themes/:id', (req, res) => {
  try {
    const { id } = req.params;
    db.transaction(() => {
      db.prepare('UPDATE folio_tags SET theme_id = NULL WHERE theme_id = ?').run(id);
      db.prepare('DELETE FROM theme_tags WHERE theme_id = ?').run(id);
      db.prepare('DELETE FROM tag_themes WHERE id = ?').run(id);
    })();
    res.json({ success: true });
  } catch (error) {
    log('app', 'ERROR', 'TAGS', `Failed to delete theme: ${String(error)}`);
    res.status(500).json({ error: 'Failed to delete theme' });
  }
});

router.post('/tags/themes/:id/tags', (req, res) => {
  try {
    const { id } = req.params;
    const { tag } = req.body;
    if (!tag) return res.status(400).json({ error: 'Tag is required' });
    
    db.prepare('INSERT OR IGNORE INTO theme_tags (theme_id, tag) VALUES (?, ?)').run(id, tag);
    res.json({ success: true });
  } catch (error) {
    log('app', 'ERROR', 'TAGS', `Failed to add tag to theme: ${String(error)}`);
    res.status(500).json({ error: 'Failed to add tag to theme' });
  }
});

router.put('/tags/themes/:id/tags/:tag', (req, res) => {
  try {
    const { id, tag } = req.params;
    const { newTag } = req.body;
    if (!newTag) return res.status(400).json({ error: 'New tag name is required' });
    
    db.transaction(() => {
      db.prepare('UPDATE theme_tags SET tag = ? WHERE theme_id = ? AND tag = ?').run(newTag, id, tag);
      db.prepare('UPDATE folio_tags SET tag = ? WHERE theme_id = ? AND tag = ?').run(newTag, id, tag);
    })();
    res.json({ success: true });
  } catch (error) {
    log('app', 'ERROR', 'TAGS', `Failed to rename tag: ${String(error)}`);
    res.status(500).json({ error: 'Failed to rename tag' });
  }
});

router.delete('/tags/themes/:id/tags/:tag', (req, res) => {
  try {
    const { id, tag } = req.params;
    db.transaction(() => {
      db.prepare('DELETE FROM theme_tags WHERE theme_id = ? AND tag = ?').run(id, tag);
      db.prepare('DELETE FROM folio_tags WHERE theme_id = ? AND tag = ?').run(id, tag);
    })();
    res.json({ success: true });
  } catch (error) {
    log('app', 'ERROR', 'TAGS', `Failed to delete tag: ${String(error)}`);
    res.status(500).json({ error: 'Failed to delete tag' });
  }
});

router.get('/tags/unassigned', (req, res) => {
  try {
    const tags = db.prepare('SELECT DISTINCT tag FROM folio_tags WHERE theme_id IS NULL').all() as { tag: string }[];
    res.json(tags.map(t => t.tag));
  } catch (error) {
    log('app', 'ERROR', 'TAGS', `Failed to get unassigned tags: ${String(error)}`);
    res.status(500).json({ error: 'Failed to get unassigned tags' });
  }
});

router.delete('/tags/unassigned/:tag', (req, res) => {
  try {
    const { tag } = req.params;
    db.prepare('DELETE FROM folio_tags WHERE tag = ? AND theme_id IS NULL').run(tag);
    res.json({ success: true });
  } catch (error) {
    log('app', 'ERROR', 'TAGS', `Failed to delete unassigned tag: ${String(error)}`);
    res.status(500).json({ error: 'Failed to delete unassigned tag' });
  }
});

// FOLIO TAGS ENDPOINTS

router.get('/folios/:id/tags', (req, res) => {
  try {
    const { id } = req.params;
    const tags = db.prepare(`
      SELECT ft.tag, ft.theme_id, tt.name as theme_name
      FROM folio_tags ft
      LEFT JOIN tag_themes tt ON ft.theme_id = tt.id
      WHERE ft.folio_id = ?
    `).all(id) as any[];
    res.json(tags);
  } catch (error) {
    log('app', 'ERROR', 'TAGS', `Failed to get folio tags: ${String(error)}`);
    res.status(500).json({ error: 'Failed to get folio tags' });
  }
});

router.post('/folios/:id/tags', (req, res) => {
  try {
    const { id } = req.params;
    const { tag, theme_id } = req.body;
    if (!tag) return res.status(400).json({ error: 'Tag is required' });
    
    db.prepare('INSERT OR IGNORE INTO folio_tags (folio_id, tag, theme_id) VALUES (?, ?, ?)').run(id, tag, theme_id || null);
    res.json({ success: true });
  } catch (error) {
    log('app', 'ERROR', 'TAGS', `Failed to assign tag to folio: ${String(error)}`);
    res.status(500).json({ error: 'Failed to assign tag to folio' });
  }
});

router.delete('/folios/:id/tags/:tag', (req, res) => {
  try {
    const { id, tag } = req.params;
    db.prepare('DELETE FROM folio_tags WHERE folio_id = ? AND tag = ?').run(id, tag);
    res.json({ success: true });
  } catch (error) {
    log('app', 'ERROR', 'TAGS', `Failed to remove tag from folio: ${String(error)}`);
    res.status(500).json({ error: 'Failed to remove tag from folio' });
  }
});

router.post('/tags/assign-all-mf', (req, res) => {
  try {
    const theme = db.prepare('SELECT id FROM tag_themes WHERE name = ?').get('Portfolio') as { id: string } | undefined;
    if (!theme) {
      return res.status(404).json({ error: 'Portfolio theme not seeded' });
    }

    const folios = db.prepare('SELECT id FROM folios').all() as { id: string }[];
    let assigned = 0;

    const sync = db.transaction((themeId: string, folioIds: string[]) => {
      for (const fId of folioIds) {
        const result = db.prepare('INSERT OR IGNORE INTO folio_tags (folio_id, tag, theme_id) VALUES (?, ?, ?)')
          .run(fId, 'All MF', themeId);
        if (result.changes > 0) {
          assigned++;
        }
      }
    });

    sync(theme.id, folios.map(f => f.id));

    const total = folios.length;
    const skipped = total - assigned;

    log('app', 'INFO', 'TAGS', `All MF sync: ${assigned} assigned, ${skipped} skipped`);
    res.json({ assigned, skipped, total });
  } catch (error) {
    log('app', 'ERROR', 'TAGS', `All MF sync failed: ${String(error)}`);
    res.status(500).json({ error: 'Internal server error while syncing All MF tags' });
  }
});

router.get('/folios-xirr', (req, res) => {
  try {
    const { activeOnly, fundHouse, category, plan, fundOption, tag, search } = req.query;

    let query = `
      SELECT
        f.id as folioId,
        f.folio_number as folioNumber,
        f.fund_id as fundId,
        fu.name as fundName,
        fu.isin,
        fu.category,
        fu.plan,
        fu.fund_option as fundOption,
        f.stated_balance as units,
        f.stated_cost as investedAmount,
        n.nav,
        n.nav_date as navDate
      FROM folios f
      JOIN funds fu ON f.fund_id = fu.id
      LEFT JOIN (
        SELECT isin, nav, nav_date
        FROM nav_history nh1
        WHERE nav_date = (
          SELECT MAX(nav_date) FROM nav_history nh2 WHERE nh2.isin = nh1.isin
        )
      ) n ON fu.isin = n.isin
    `;

    const conditions: string[] = [];
    const params: any[] = [];

    if (activeOnly === '1') {
      conditions.push('f.stated_balance > 0');
    }
    if (category) {
      conditions.push('fu.category = ?');
      params.push(category);
    }
    if (plan) {
      conditions.push('fu.plan = ?');
      params.push(plan);
    }
    if (fundOption) {
      conditions.push('fu.fund_option = ?');
      params.push(fundOption);
    }
    if (tag) {
      query += ' JOIN folio_tags ft ON f.id = ft.folio_id ';
      conditions.push('ft.tag = ?');
      params.push(tag);
    }
    if (fundHouse) {
      conditions.push('fu.name LIKE ?');
      params.push(`${fundHouse}%`);
    }
    if (search) {
      conditions.push('(fu.name LIKE ? OR f.folio_number LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY fu.name ASC';

    const folios = db.prepare(query).all(...params) as any[];

    // Part 2: Fetch all transactions for bulk XIRR
    const allTxns = db.prepare(`
      SELECT folio_id, date, amount, transaction_type
      FROM transactions
      ORDER BY folio_id, date ASC
    `).all() as any[];

    const txnMap = new Map<string, any[]>();
    for (const t of allTxns) {
      if (!txnMap.has(t.folio_id)) txnMap.set(t.folio_id, []);
      txnMap.get(t.folio_id)!.push(t);
    }

    // Part 5: Fetch tags for all folios
    const allTags = db.prepare(`
      SELECT folio_id, tag FROM folio_tags ORDER BY folio_id
    `).all() as any[];

    const tagMap = new Map<string, string[]>();
    for (const t of allTags) {
      if (!tagMap.has(t.folio_id)) tagMap.set(t.folio_id, []);
      tagMap.get(t.folio_id)!.push(t.tag);
    }

    const results = folios.map(folio => {
      const currentValue = (folio.units ?? 0) * (folio.nav ?? 0);
      const gainAmount = currentValue - (folio.investedAmount ?? 0);
      const gainPercent = folio.investedAmount > 0
        ? (gainAmount / folio.investedAmount) * 100
        : null;

      let xirrValue: number | null = null;
      let xirrWarning = false;

      const folioTxns = txnMap.get(folio.folioId) ?? [];
      const cashflows = folioTxns.map(t => ({
        date: new Date(t.date),
        amount: -(t.amount)
      }));

      if (currentValue > 0) {
        cashflows.push({ date: new Date(), amount: currentValue });
      }

      if (cashflows.length >= 2) {
        const span = cashflows[cashflows.length - 1].date.getTime() - cashflows[0].date.getTime();
        const spanDays = span / (1000 * 60 * 60 * 24);
        if (spanDays >= 30) {
          try {
            const result = xirr(cashflows);
            if (result && typeof result.value === 'number' && isFinite(result.value)) {
              xirrValue = result.value;
              xirrWarning = result.value > 1.0 || result.value < -0.5;
            }
          } catch {
            // XIRR failed to converge
          }
        }
      }

      return {
        ...folio,
        fundHouse: folio.fundName.split(' ')[0],
        currentValue,
        gainAmount,
        gainPercent,
        xirr: xirrValue,
        xirrWarning,
        tags: tagMap.get(folio.folioId) ?? [],
        isActive: folio.units > 0
      };
    });

    log('app', 'INFO', 'folios-xirr', `Computed XIRR for ${results.length} folios`);
    res.json({ folios: results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log('app', 'ERROR', 'folios-xirr', msg);
    res.status(500).json({ error: 'Failed to load folios XIRR data' });
  }
});

export default router;
