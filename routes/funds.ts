import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/db.ts';
import { log } from '../lib/logger.ts';
import { xirr, calcMirrorXirr } from '../lib/xirr.ts';
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
    SELECT f.*, fu.name as fund_name, fu.clean_name, fu.simple_name, fu.category, fu.isin
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
    const { activeOnly, fundHouse, category, plan, fundOption, tag, search, pan } = req.query;

    let query = `
      SELECT
        f.id as folioId,
        f.pan,
        f.folio_number as folioNumber,
        f.fund_id as fundId,
        fu.name as fundName,
        fu.clean_name,
        fu.simple_name,
        fu.isin,
        fu.category,
        fu.plan,
        fu.fund_option as fundOption,
        fu.fund_house,
        fu.scheme_sub_cat,
        fu.asset_class,
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
      conditions.push('fu.asset_class = ?');
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
      conditions.push('fu.fund_house = ?');
      params.push(fundHouse);
    }
    if (pan) {
      conditions.push('f.pan = ?');
      params.push(pan);
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
        clean_name: folio.clean_name || '',
        simple_name: folio.simple_name || '',
        fundHouse: folio.fund_house || '',
        schemeSubCat: folio.scheme_sub_cat || '',
        assetClass: folio.asset_class || '',
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

function cleanFundName(raw: string): string {
  if (!raw) return raw;
  let name = raw;
  // Rule 1: strip leading folio code prefix (e.g. "PP001ZG-", "183FCDGG-", "K123D-")
  name = name.replace(/^[A-Z0-9]+-/, '');
  // Rule 2: strip plan/option suffixes
  name = name.replace(/\s*-\s*(Direct|Regular)\s+Plan\b.*/i, '');
  // Rule 3: strip demat suffixes
  name = name.replace(/\s*\((Non-)?Demat\)/i, '');
  // Rule 4: strip "formerly" clauses
  name = name.replace(/\s*\(formerly[^)]*\)/i, '');
  return name.trim();
}

async function buildGroupedFunds(): Promise<any[]> {
  // STEP 1 — Fetch all folios with fund data in one query:
  const folios = db.prepare(`
    SELECT
      fo.id          AS folioId,
      fo.folio_number,
      fo.stated_balance,
      fo.stated_cost,
      fo.pan,
      fo.investor_name,
      fu.id          AS fundId,
      fu.name        AS fundName,
      fu.clean_name,
      fu.simple_name,
      fu.isin,
      fu.category,
      fu.plan,
      fu.fund_option AS fundOption,
      fu.fund_house  AS fundHouse,
      fu.asset_class AS assetClass,
      fu.scheme_sub_cat AS schemeSubCat,
      fu.amfi_code   AS amfiCode
    FROM folios fo
    JOIN funds fu ON fo.fund_id = fu.id
  `).all() as any[];

  if (folios.length === 0) {
    return [];
  }

  // STEP 2 — Bulk-fetch all transactions in one query:
  const folioIds = folios.map(f => f.folioId);
  const placeholders = folioIds.map(() => '?').join(',');
  const txns = db.prepare(`
    SELECT folio_id, date, amount, units, transaction_type
    FROM transactions
    WHERE folio_id IN (${placeholders})
    ORDER BY folio_id, date ASC
  `).all(...folioIds) as any[];

  // Build: Map<string, Array<{date, amount, units, transaction_type}>> keyed by folioId
  const txnRawMap = new Map<string, Array<{ date: string; amount: number; units: number; transaction_type: string }>>();
  for (const t of txns) {
    if (!txnRawMap.has(t.folio_id)) {
      txnRawMap.set(t.folio_id, []);
    }
    txnRawMap.get(t.folio_id)!.push({
      date: t.date,
      amount: t.amount,
      units: t.units,
      transaction_type: t.transaction_type
    });
  }

  // STEP 3 — Bulk-fetch latest NAV per ISIN in one query:
  const navs = db.prepare(`
    SELECT n.isin, n.nav, n.nav_date
    FROM nav_history n
    INNER JOIN (
      SELECT isin, MAX(nav_date) AS max_date
      FROM nav_history
      GROUP BY isin
    ) latest ON n.isin = latest.isin AND n.nav_date = latest.max_date
  `).all() as any[];

  // Build: Map<string, { nav: number; navDate: string }> keyed by ISIN
  const navMap = new Map<string, { nav: number; navDate: string }>();
  for (const n of navs) {
    if (n.isin) {
      navMap.set(n.isin, { nav: n.nav, navDate: n.nav_date });
    }
  }

  // STEP 4 — Build per-folio transaction cashflows (do NOT add terminal cashflows here):
  const folioCashflowsMap = new Map<string, Array<{ date: Date; amount: number }>>();
  for (const folio of folios) {
    const list = txnRawMap.get(folio.folioId) ?? [];
    const transactionCashflows = list.map(t => ({
      date: new Date(t.date),
      amount: -(t.amount)
    }));
    // Store transactionCashflows alongside the folio row for use in Steps 5 and 6.
    folioCashflowsMap.set(folio.folioId, transactionCashflows);
  }

  // STEP 5 — Compute per-folio FolioXirr objects:
  const results = folios.map(folio => {
    const latestNavObj = navMap.get(folio.isin ?? '');
    const latestNav = latestNavObj ? latestNavObj.nav : 0;
    const navDate = latestNavObj ? latestNavObj.navDate : '';
    const currentValue = folio.stated_balance * latestNav;
    const gainAmount = currentValue - folio.stated_cost;
    const gainPercent = folio.stated_cost > 0 ? (gainAmount / folio.stated_cost) * 100 : 0;
    const isActive = folio.stated_balance > 0.001;

    // For per-folio XIRR, make a copy of transactionCashflows and append terminal cashflow:
    const transactionCashflows = folioCashflowsMap.get(folio.folioId) ?? [];
    const folioCashflows = [...transactionCashflows];
    if (currentValue > 0) {
      folioCashflows.push({ date: new Date(), amount: currentValue });
    }

    let xirrValue: number | null = null;
    if (folioCashflows.length >= 2) {
      const sorted = [...folioCashflows].sort((a, b) => a.date.getTime() - b.date.getTime());
      const span = sorted[sorted.length - 1].date.getTime() - sorted[0].date.getTime();
      const spanDays = span / (1000 * 60 * 60 * 24);
      if (spanDays >= 30) {
        try {
          const xirrRes = xirr(sorted);
          if (xirrRes && typeof xirrRes.value === 'number' && isFinite(xirrRes.value)) {
            xirrValue = xirrRes.value;
          }
        } catch {
          xirrValue = null;
        }
      }
    }

    const xirrWarning = xirrValue !== null && (xirrValue > 1.0 || xirrValue < -0.5);

    return {
      folioId: folio.folioId,
      folioNumber: folio.folio_number,
      pan: folio.pan,
      investorName: folio.investor_name || '',
      amfiCode: folio.amfiCode || '',
      fundId: folio.fundId,
      fundName: folio.fundName,
      clean_name: folio.clean_name || '',
      simple_name: folio.simple_name || '',
      fundHouse: folio.fundHouse || '',
      schemeSubCat: folio.schemeSubCat || '',
      assetClass: folio.assetClass || '',
      isin: folio.isin || null,
      category: folio.category || null,
      plan: folio.plan || null,
      fundOption: folio.fundOption || null,
      units: folio.stated_balance,
      nav: latestNav || null,
      navDate: navDate || null,
      currentValue,
      investedAmount: folio.stated_cost,
      gainAmount,
      gainPercent,
      xirr: xirrValue,
      xirrWarning,
      tags: [],
      isActive
    };
  });

  // STEP 6 — Group by fundId:
  const groupsMap = new Map<string, any[]>();
  for (const f of results) {
    if (!groupsMap.has(f.fundId)) {
      groupsMap.set(f.fundId, []);
    }
    groupsMap.get(f.fundId)!.push(f);
  }

  const groupsArray: any[] = [];
  for (const [fundId, groupFolios] of groupsMap.entries()) {
    const firstFolio = groupFolios[0];
    let totalUnits = 0;
    let totalInvested = 0;
    let totalCurrentValue = 0;

    for (const f of groupFolios) {
      totalUnits += f.units;
      totalInvested += f.investedAmount;
      totalCurrentValue += f.currentValue;
    }

    const gainAmount = totalCurrentValue - totalInvested;
    const gainPercent = totalInvested > 0 ? (gainAmount / totalInvested) * 100 : 0;

    // Group XIRR: concatenate ONLY transactionCashflows (from Step 4, no terminal cashflows)
    let combinedCashflows: Array<{ date: Date; amount: number }> = [];
    for (const f of groupFolios) {
      const txnCashflows = folioCashflowsMap.get(f.folioId) ?? [];
      combinedCashflows = combinedCashflows.concat(txnCashflows);
    }

    if (totalCurrentValue > 0) {
      combinedCashflows.push({ date: new Date(), amount: totalCurrentValue });
    }

    let groupXirr: number | null = null;
    if (combinedCashflows.length >= 2) {
      const sorted = [...combinedCashflows].sort((a, b) => a.date.getTime() - b.date.getTime());
      const span = sorted[sorted.length - 1].date.getTime() - sorted[0].date.getTime();
      const spanDays = span / (1000 * 60 * 60 * 24);
      if (spanDays >= 30) {
        try {
          const xirrRes = xirr(sorted);
          if (xirrRes && typeof xirrRes.value === 'number' && isFinite(xirrRes.value)) {
            groupXirr = xirrRes.value;
          }
        } catch {
          groupXirr = null;
        }
      }
    }

    const groupXirrWarning = groupXirr !== null && (groupXirr > 1.0 || groupXirr < -0.5);

    groupsArray.push({
      fundId,
      fundName: firstFolio.fundName,
      clean_name: firstFolio.clean_name || '',
      simple_name: firstFolio.simple_name || '',
      fundHouse: firstFolio.fundHouse,
      isin: firstFolio.isin || '',
      category: firstFolio.category || '',
      plan: firstFolio.plan || '',
      fundOption: firstFolio.fundOption || '',
      assetClass: firstFolio.assetClass,
      schemeSubCat: firstFolio.schemeSubCat,
      totalUnits,
      totalInvested,
      totalCurrentValue,
      gainAmount,
      gainPercent,
      groupXirr,
      groupXirrWarning,
      folioCount: groupFolios.length,
      folios: groupFolios
    });
  }

  // STEP 7 — Sort groups by totalCurrentValue descending.
  groupsArray.sort((a, b) => b.totalCurrentValue - a.totalCurrentValue);

  return groupsArray;
}

router.get('/funds-xirr-grouped', async (req, res) => {
  try {
    const groups = await buildGroupedFunds();
    res.json(groups);
  } catch (err) {
    log('app', 'ERROR', 'FUNDS_GROUPED', `Failed to fetch grouped funds: ${err}`);
    res.status(500).json({ error: 'Failed to fetch grouped funds' });
  }
});

router.get('/export-funds-grouped-csv', async (req, res) => {
  try {
    const groups = await buildGroupedFunds();

    function csvEscape(val: any): string {
      const str = val === null || val === undefined ? '' : String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }

    const headers = [
      'Fund Name',
      'Fund House',
      'ISIN',
      'AMFI Code',
      'Asset Class',
      'Scheme Sub-Cat',
      'Plan',
      'Option',
      'Folio Number',
      'Investor Name',
      'PAN',
      'Units',
      'Invested (Rs)',
      'Current Value (Rs)',
      'Gain (Rs)',
      'Gain (%)',
      'XIRR (%)',
      'NAV (Rs)',
      'NAV Date'
    ];

    const rows = [headers.join(',')];
    let totalFolioCount = 0;

    for (const group of groups) {
      for (const folio of group.folios) {
        totalFolioCount++;
        const row = [
          csvEscape(folio.clean_name || folio.fundName),
          csvEscape(folio.fundHouse),
          csvEscape(folio.isin),
          csvEscape(folio.amfiCode),
          csvEscape(folio.assetClass),
          csvEscape(folio.schemeSubCat),
          csvEscape(folio.plan),
          csvEscape(folio.fundOption),
          csvEscape(folio.folioNumber),
          csvEscape(folio.investorName),
          csvEscape(folio.pan),
          csvEscape(folio.units !== null && folio.units !== undefined ? folio.units.toFixed(4) : '0.0000'),
          csvEscape(folio.investedAmount !== null && folio.investedAmount !== undefined ? folio.investedAmount.toFixed(2) : '0.00'),
          csvEscape(folio.currentValue !== null && folio.currentValue !== undefined ? folio.currentValue.toFixed(2) : '0.00'),
          csvEscape(folio.gainAmount !== null && folio.gainAmount !== undefined ? folio.gainAmount.toFixed(2) : '0.00'),
          csvEscape(folio.gainPercent !== null && folio.gainPercent !== undefined ? folio.gainPercent.toFixed(2) : '0.00'),
          csvEscape(folio.xirr !== null && folio.xirr !== undefined ? (folio.xirr * 100).toFixed(2) : ''),
          csvEscape(folio.nav !== null && folio.nav !== undefined ? folio.nav.toFixed(4) : ''),
          csvEscape(folio.navDate)
        ];
        rows.push(row.join(','));
      }
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const filename = `vriddhi-funds-${todayStr}.csv`;

    log('app', 'INFO', 'EXPORT', `Funds CSV export: ${totalFolioCount} folios`);

    const csvString = rows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvString);

  } catch (err: any) {
    log('app', 'ERROR', 'FUNDS_CSV', `CSV export failed: ${err}`);
    res.status(500).send('CSV export failed');
  }
});

router.post('/folios-benchmark-xirr', async (req, res) => {
  try {
    const { folioIds, benchmarkSymbol } = req.body;

    if (!folioIds || !Array.isArray(folioIds) || folioIds.length === 0 || !benchmarkSymbol) {
      return res.status(400).json({ error: 'folioIds and benchmarkSymbol are required' });
    }

    log('app', 'INFO', 'BENCHMARK_XIRR',
      `Computing benchmark XIRR for ${folioIds.length} folios, symbol: ${benchmarkSymbol}`);

    // STEP 1 — Fetch folio metadata for the requested folioIds:
    const placeholders = folioIds.map(() => '?').join(',');
    const foliosMeta = db.prepare(`
      SELECT
        fo.id          AS folioId,
        fo.folio_number,
        fo.stated_balance,
        fo.stated_cost,
        fo.fund_id     AS fundId,
        fu.isin
      FROM folios fo
      JOIN funds fu ON fo.fund_id = fu.id
      WHERE fo.id IN (${placeholders})
    `).all(...folioIds) as any[];

    const folioMetaMap = new Map<string, { folioId: string; folioNumber: string; fundId: string; stated_balance: number; stated_cost: number; isin: string }>();
    const fundIdsSet = new Set<string>();
    const uniqueIsinsSet = new Set<string>();

    for (const m of foliosMeta) {
      folioMetaMap.set(m.folioId, {
        folioId: m.folioId,
        folioNumber: m.folio_number,
        fundId: m.fundId,
        stated_balance: m.stated_balance ?? 0,
        stated_cost: m.stated_cost ?? 0,
        isin: m.isin ?? ''
      });
      fundIdsSet.add(m.fundId);
      if (m.isin) {
        uniqueIsinsSet.add(m.isin);
      }
    }

    // STEP 2 — Bulk-fetch transactions for these folioIds:
    const txns = db.prepare(`
      SELECT folio_id, date, amount, units, transaction_type
      FROM transactions
      WHERE folio_id IN (${placeholders})
      ORDER BY folio_id, date ASC
    `).all(...folioIds) as any[];

    const txMap = new Map<string, any[]>();
    for (const t of txns) {
      if (!txMap.has(t.folio_id)) {
        txMap.set(t.folio_id, []);
      }
      txMap.get(t.folio_id)!.push({
        date: t.date,
        amount: t.amount,
        units: t.units,
        transaction_type: t.transaction_type
      });
    }

    // STEP 3 — Bulk-fetch latest NAV per ISIN for the folios' ISINs:
    const latestNavMap = new Map<string, number>();
    if (uniqueIsinsSet.size > 0) {
      const isinList = Array.from(uniqueIsinsSet);
      const isinPlaceholders = isinList.map(() => '?').join(',');
      const navs = db.prepare(`
        SELECT n.isin, n.nav
        FROM nav_history n
        INNER JOIN (
          SELECT isin, MAX(nav_date) AS max_date 
          FROM nav_history 
          GROUP BY isin
        ) latest ON n.isin = latest.isin AND n.nav_date = latest.max_date
        WHERE n.isin IN (${isinPlaceholders})
      `).all(...isinList) as any[];

      for (const n of navs) {
        if (n.isin) {
          latestNavMap.set(n.isin, n.nav ?? 0);
        }
      }
    }

    // STEP 4 — Fetch benchmark price history for benchmarkSymbol:
    const dbBenchmarkPrices = db.prepare(`
      SELECT price_date, value
      FROM benchmark_history
      WHERE index_name = ?
      ORDER BY price_date ASC
    `).all(benchmarkSymbol) as any[];

    const benchmarkPrices = dbBenchmarkPrices.map(bp => ({
      date: bp.price_date,
      close: bp.value ?? 0
    }));

    if (benchmarkPrices.length === 0) {
      return res.status(404).json({
        error: `No benchmark data found for symbol: ${benchmarkSymbol}`
      });
    }

    const latestBenchmarkPrice = benchmarkPrices[benchmarkPrices.length - 1].close;

    // STEP 5 — Per-folio computation
    const folioResults: any[] = [];
    for (const folioId of folioIds) {
      const meta = folioMetaMap.get(folioId);
      if (!meta) {
        folioResults.push({
          folioId,
          portfolioXirr: null,
          portfolioXirrWarning: false,
          benchmarkXirr: null,
          benchmarkXirrWarning: false,
          alpha: null
        });
        continue;
      }

      const transactions = txMap.get(folioId) ?? [];
      const latestNav = latestNavMap.get(meta.isin) ?? 0;
      const currentValue = meta.stated_balance * latestNav;

      const mirrorCashflows: Array<{ date: Date; amount: number; type: 'buy' | 'sell' }> = [];
      for (const t of transactions) {
        mirrorCashflows.push({
          date: new Date(t.date),
          amount: Math.abs(t.amount),
          type: t.transaction_type === 'sell' ? 'sell' : 'buy'
        });
      }

      const portfolioCashflows: Array<{ date: Date; amount: number }> = [];
      for (const t of transactions) {
        portfolioCashflows.push({
          date: new Date(t.date),
          amount: -(t.amount)
        });
      }
      if (currentValue > 0) {
        portfolioCashflows.push({
          date: new Date(),
          amount: currentValue
        });
      }

      // XIRR validity check
      let isPortfolioValid = false;
      if (portfolioCashflows.length >= 2) {
        const sorted = [...portfolioCashflows].sort((a, b) => a.date.getTime() - b.date.getTime());
        const span = sorted[sorted.length - 1].date.getTime() - sorted[0].date.getTime();
        const spanDays = span / (1000 * 60 * 60 * 24);
        if (spanDays >= 30) {
          isPortfolioValid = true;
        }
      }

      let isMirrorValid = false;
      const mirrorCount = mirrorCashflows.length + (currentValue > 0 ? 1 : 0);
      if (mirrorCount >= 2 && mirrorCashflows.length > 0) {
        const sorted = [...mirrorCashflows].sort((a, b) => a.date.getTime() - b.date.getTime());
        const firstDate = sorted[0].date;
        const lastDate = currentValue > 0 ? new Date() : sorted[sorted.length - 1].date;
        const span = lastDate.getTime() - firstDate.getTime();
        const spanDays = span / (1000 * 60 * 60 * 24);
        if (spanDays >= 30) {
          isMirrorValid = true;
        }
      }

      let portfolioXirr: number | null = null;
      let portfolioXirrWarning = false;
      if (isPortfolioValid) {
        try {
          const pRes = xirr(portfolioCashflows);
          if (pRes && typeof pRes.value === 'number' && isFinite(pRes.value)) {
            portfolioXirr = pRes.value;
            portfolioXirrWarning = pRes.suspect;
          }
        } catch {
          portfolioXirr = null;
        }
      }

      let benchmarkXirr: number | null = null;
      let benchmarkXirrWarning = false;
      if (isMirrorValid) {
        try {
          const bRes = calcMirrorXirr(
            mirrorCashflows,
            benchmarkPrices,
            latestBenchmarkPrice,
            { minDays: CONFIG.XIRR.MIN_DAYS, toleranceDays: CONFIG.XIRR.BENCHMARK_TOLERANCE_DAYS }
          );
          if (bRes && typeof bRes.value === 'number' && isFinite(bRes.value)) {
            benchmarkXirr = bRes.value;
            benchmarkXirrWarning = bRes.suspect;
          }
        } catch {
          benchmarkXirr = null;
        }
      }

      const alpha = (portfolioXirr !== null && benchmarkXirr !== null) ? (portfolioXirr - benchmarkXirr) : null;

      folioResults.push({
        folioId,
        portfolioXirr,
        portfolioXirrWarning,
        benchmarkXirr,
        benchmarkXirrWarning,
        alpha
      });
    }

    // STEP 6 — Per-group computation
    const fundGroupMap = new Map<string, string[]>(); // fundId -> folioIds[]
    for (const folioId of folioIds) {
      const meta = folioMetaMap.get(folioId);
      if (meta) {
        if (!fundGroupMap.has(meta.fundId)) {
          fundGroupMap.set(meta.fundId, []);
        }
        fundGroupMap.get(meta.fundId)!.push(folioId);
      }
    }

    const groupResults: any[] = [];
    for (const [fundId, gFolioIds] of fundGroupMap.entries()) {
      let combinedMirrorCashflows: Array<{ date: Date; amount: number; type: 'buy' | 'sell' }> = [];
      let combinedPortfolioCashflows: Array<{ date: Date; amount: number }> = [];
      let combinedCurrentValue = 0;

      for (const fId of gFolioIds) {
        const meta = folioMetaMap.get(fId)!;
        const transactions = txMap.get(fId) ?? [];
        const latestNav = latestNavMap.get(meta.isin) ?? 0;
        const currentValue = meta.stated_balance * latestNav;
        combinedCurrentValue += currentValue;

        for (const t of transactions) {
          combinedMirrorCashflows.push({
            date: new Date(t.date),
            amount: Math.abs(t.amount),
            type: t.transaction_type === 'sell' ? 'sell' : 'buy'
          });
          combinedPortfolioCashflows.push({
            date: new Date(t.date),
            amount: -(t.amount)
          });
        }
      }

      if (combinedCurrentValue > 0) {
        combinedPortfolioCashflows.push({
          date: new Date(),
          amount: combinedCurrentValue
        });
      }

      // Group checks
      let isGroupPortfolioValid = false;
      if (combinedPortfolioCashflows.length >= 2) {
        const sorted = [...combinedPortfolioCashflows].sort((a, b) => a.date.getTime() - b.date.getTime());
        const span = sorted[sorted.length - 1].date.getTime() - sorted[0].date.getTime();
        const spanDays = span / (1000 * 60 * 60 * 24);
        if (spanDays >= 30) {
          isGroupPortfolioValid = true;
        }
      }

      let isGroupMirrorValid = false;
      const mirrorCount = combinedMirrorCashflows.length + (combinedCurrentValue > 0 ? 1 : 0);
      if (mirrorCount >= 2 && combinedMirrorCashflows.length > 0) {
        const sorted = [...combinedMirrorCashflows].sort((a, b) => a.date.getTime() - b.date.getTime());
        const firstDate = sorted[0].date;
        const lastDate = combinedCurrentValue > 0 ? new Date() : sorted[sorted.length - 1].date;
        const span = lastDate.getTime() - firstDate.getTime();
        const spanDays = span / (1000 * 60 * 60 * 24);
        if (spanDays >= 30) {
          isGroupMirrorValid = true;
        }
      }

      let groupPortfolioXirr: number | null = null;
      let groupPortfolioXirrWarning = false;
      if (isGroupPortfolioValid) {
        try {
          const pRes = xirr(combinedPortfolioCashflows);
          if (pRes && typeof pRes.value === 'number' && isFinite(pRes.value)) {
            groupPortfolioXirr = pRes.value;
            groupPortfolioXirrWarning = pRes.suspect;
          }
        } catch {
          groupPortfolioXirr = null;
        }
      }

      let groupBenchmarkXirr: number | null = null;
      let groupBenchmarkXirrWarning = false;
      if (isGroupMirrorValid) {
        try {
          const bRes = calcMirrorXirr(
            combinedMirrorCashflows,
            benchmarkPrices,
            latestBenchmarkPrice,
            { minDays: CONFIG.XIRR.MIN_DAYS, toleranceDays: CONFIG.XIRR.BENCHMARK_TOLERANCE_DAYS }
          );
          if (bRes && typeof bRes.value === 'number' && isFinite(bRes.value)) {
            groupBenchmarkXirr = bRes.value;
            groupBenchmarkXirrWarning = bRes.suspect;
          }
        } catch {
          groupBenchmarkXirr = null;
        }
      }

      const groupAlpha = (groupPortfolioXirr !== null && groupBenchmarkXirr !== null) ? (groupPortfolioXirr - groupBenchmarkXirr) : null;

      groupResults.push({
        fundId,
        portfolioXirr: groupPortfolioXirr,
        portfolioXirrWarning: groupPortfolioXirrWarning,
        benchmarkXirr: groupBenchmarkXirr,
        benchmarkXirrWarning: groupBenchmarkXirrWarning,
        alpha: groupAlpha
      });
    }

    // STEP 7 — Overall computation
    let overallCurrentValue = 0;
    for (const folioId of folioIds) {
      const meta = folioMetaMap.get(folioId);
      if (meta) {
        const latestNav = latestNavMap.get(meta.isin) ?? 0;
        overallCurrentValue += meta.stated_balance * latestNav;
      }
    }

    const mirrorCashflows: Array<{ date: Date; amount: number; type: 'buy' | 'sell' }> = [];
    const overallPortfolioCashflows: Array<{ date: Date; amount: number }> = [];

    for (const t of txns) {
      mirrorCashflows.push({
        date: new Date(t.date),
        amount: Math.abs(t.amount),
        type: t.transaction_type === 'sell' ? 'sell' : 'buy'
      });
      overallPortfolioCashflows.push({
        date: new Date(t.date),
        amount: -(t.amount)
      });
    }

    if (overallCurrentValue > 0) {
      overallPortfolioCashflows.push({
        date: new Date(),
        amount: overallCurrentValue
      });
    }

    let isOverallPortfolioValid = false;
    if (overallPortfolioCashflows.length >= 2) {
      const sorted = [...overallPortfolioCashflows].sort((a, b) => a.date.getTime() - b.date.getTime());
      const span = sorted[sorted.length - 1].date.getTime() - sorted[0].date.getTime();
      const spanDays = span / (1000 * 60 * 60 * 24);
      if (spanDays >= 30) {
        isOverallPortfolioValid = true;
      }
    }

    let isOverallMirrorValid = false;
    const overallMirrorCount = mirrorCashflows.length + (overallCurrentValue > 0 ? 1 : 0);
    if (overallMirrorCount >= 2 && mirrorCashflows.length > 0) {
      const sorted = [...mirrorCashflows].sort((a, b) => a.date.getTime() - b.date.getTime());
      const firstDate = sorted[0].date;
      const lastDate = overallCurrentValue > 0 ? new Date() : sorted[sorted.length - 1].date;
      const span = lastDate.getTime() - firstDate.getTime();
      const spanDays = span / (1000 * 60 * 60 * 24);
      if (spanDays >= 30) {
        isOverallMirrorValid = true;
      }
    }

    let overallPortfolioXirr: number | null = null;
    let overallPortfolioXirrWarning = false;
    if (isOverallPortfolioValid) {
      try {
        const pRes = xirr(overallPortfolioCashflows);
        if (pRes && typeof pRes.value === 'number' && isFinite(pRes.value)) {
          overallPortfolioXirr = pRes.value;
          overallPortfolioXirrWarning = pRes.suspect;
        }
      } catch {
        overallPortfolioXirr = null;
      }
    }

    let overallBenchmarkXirr: number | null = null;
    let overallBenchmarkXirrWarning = false;
    if (isOverallMirrorValid) {
      try {
        const bRes = calcMirrorXirr(
          mirrorCashflows,
          benchmarkPrices,
          latestBenchmarkPrice,
          { minDays: CONFIG.XIRR.MIN_DAYS, toleranceDays: CONFIG.XIRR.BENCHMARK_TOLERANCE_DAYS }
        );
        if (bRes && typeof bRes.value === 'number' && isFinite(bRes.value)) {
          overallBenchmarkXirr = bRes.value;
          overallBenchmarkXirrWarning = bRes.suspect;
        }
      } catch {
        overallBenchmarkXirr = null;
      }
    }

    const overallAlpha = (overallPortfolioXirr !== null && overallBenchmarkXirr !== null)
      ? (overallPortfolioXirr - overallBenchmarkXirr)
      : null;

    const overallResult = {
      portfolioXirr: overallPortfolioXirr,
      portfolioXirrWarning: overallPortfolioXirrWarning,
      benchmarkXirr: overallBenchmarkXirr,
      benchmarkXirrWarning: overallBenchmarkXirrWarning,
      alpha: overallAlpha
    };

    log('app', 'INFO', 'BENCHMARK_XIRR',
      `Complete: ${folioResults.length} folios, ${groupResults.length} groups`);

    res.json({ folioResults, groupResults, overallResult });

  } catch (err) {
    log('app', 'ERROR', 'BENCHMARK_XIRR', `Benchmark XIRR failed: ${err}`);
    res.status(500).json({ error: 'Benchmark XIRR calculation failed' });
  }
});

router.post('/funds/overall-xirr', (req, res) => {
  try {
    const { folioIds } = req.body;
    if (!Array.isArray(folioIds) || folioIds.length === 0) {
      return res.status(400).json({ error: 'folioIds must be a non-empty array of strings' });
    }

    const placeholders = folioIds.map(() => '?').join(',');

    // Fetch transactions
    const txns = db.prepare(`
      SELECT t.*, fo.stated_balance, fo.id as folio_id
      FROM transactions t
      JOIN folios fo ON fo.id = t.folio_id
      WHERE t.folio_id IN (${placeholders})
      ORDER BY t.date ASC
    `).all(...folioIds) as any[];

    // Fetch latest NAV for each folio to sum current value
    const foliosInfo = db.prepare(`
      SELECT
        f.id as folioId,
        f.stated_balance as units,
        n.nav
      FROM folios f
      JOIN funds fu ON f.fund_id = fu.id
      LEFT JOIN (
        SELECT isin, nav, nav_date
        FROM nav_history nh1
        WHERE nav_date = (
          SELECT MAX(nav_date) FROM nav_history nh2 WHERE nh2.isin = nh1.isin
        )
      ) n ON fu.isin = n.isin
      WHERE f.id IN (${placeholders})
    `).all(...folioIds) as any[];

    let totalCurrentValue = 0;
    for (const folio of foliosInfo) {
      const units = folio.units ?? 0;
      const nav = folio.nav ?? 0;
      totalCurrentValue += units * nav;
    }

    const cashflows = txns.map(t => ({
      date: new Date(t.date),
      amount: -(t.amount)
    }));

    if (totalCurrentValue > 0) {
      cashflows.push({
        date: new Date(),
        amount: totalCurrentValue
      });
    }

    let xirrValue: number | null = null;
    let xirrWarning = false;

    if (cashflows.length >= 2) {
      cashflows.sort((a, b) => a.date.getTime() - b.date.getTime());
      const span = cashflows[cashflows.length - 1].date.getTime() - cashflows[0].date.getTime();
      const spanDays = span / (1000 * 60 * 60 * 24);
      if (spanDays >= 30) {
        try {
          const result = xirr(cashflows);
          if (result && typeof result.value === 'number' && isFinite(result.value)) {
            xirrValue = result.value;
            xirrWarning = result.suspect || result.value > 1.0 || result.value < -0.5;
          }
        } catch (err) {
          log('app', 'ERROR', 'overall-xirr', `Convergence failed: ${err}`);
        }
      }
    }

    log('app', 'INFO', 'overall-xirr', `Computed overall XIRR for ${foliosInfo.length} folios. Current Value: ${totalCurrentValue}. XIRR: ${xirrValue}`);

    res.json({
      xirr: xirrValue,
      xirrWarning,
      totalCurrentValue,
      folioCount: foliosInfo.length
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log('app', 'ERROR', 'overall-xirr', `Failed to compute overall XIRR: ${msg}`);
    res.status(500).json({ error: 'Failed to compute overall XIRR' });
  }
});

export default router;
