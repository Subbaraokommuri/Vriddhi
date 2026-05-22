import { Router, Request, Response } from 'express';
import { 
  computeCapitalGains, 
  aggregatePanGains, 
  FolioCapitalGains, 
  PanCapitalGainsSummary 
} from '../lib/tax.ts';
import { db, log } from '../lib/db.ts';
import { CONFIG } from '../lib/config.ts';

const router = Router();
const MODULE = 'TAX';

/**
 * Helper: navOnDate(isin, targetDate)
 * Queries nav_history for the closest available NAV on or before targetDate
 */
function navOnDate(isin: string, targetDate: string): number | null {
  try {
    const row = db.prepare(`
      SELECT nav FROM nav_history 
      WHERE isin = ? AND nav_date <= ? 
      ORDER BY nav_date DESC LIMIT 1
    `).get(isin, targetDate) as { nav: number } | undefined;
    
    return row ? row.nav : null;
  } catch (err) {
    return null;
  }
}

/**
 * Helper: getFyBounds(fy)
 * Parses fy param like '2025-26' into fyStart='2025-04-01' and fyEnd='2026-03-31'
 */
function getFyBounds(fy: string): { fyStart: string, fyEnd: string } {
  if (!/^\d{4}-\d{2}$/.test(fy)) {
    throw new Error('Invalid FY format. Expected YYYY-YY');
  }
  
  const [startYearStr, endYearShort] = fy.split('-');
  const startYear = parseInt(startYearStr);
  const endYear = startYear + 1;
  
  return {
    fyStart: `${startYear}-04-01`,
    fyEnd: `${endYear}-03-31`
  };
}

/**
 * Helper: getDefaultFy()
 * Returns just-completed FY as 'YYYY-YY' string.
 */
function getDefaultFy(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed, April is 3
  
  let startYear: number;
  if (month >= 3) { // April or later
    startYear = year - 1;
  } else {
    startYear = year - 2;
  }
  
  const endYearShort = (startYear + 1).toString().slice(-2);
  return `${startYear}-${endYearShort}`;
}

/**
 * GET /api/tax/pans
 */
router.get('/pans', (req, res) => {
  try {
    const investors = db.prepare('SELECT pan, name FROM investors ORDER BY name ASC').all() as Array<{ pan: string, name: string }>;
    res.json({ pans: investors || [] });
  } catch (error: any) {
    log('app', 'ERROR', MODULE, `Error fetching PANS: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Internal logic for capital gains calculation
 */
async function getCapitalGainsSummary(pan: string, fyInput?: string) {
  const fy = fyInput || getDefaultFy();
  const { fyStart, fyEnd } = getFyBounds(fy);
  
  // Fetch investor name
  const investor = db.prepare('SELECT name FROM investors WHERE pan = ?').get(pan) as { name: string } | undefined;
  if (!investor) {
    throw new Error(`Investor with PAN ${pan} not found`);
  }
  
  // Fetch all folios for this PAN
  const folios = db.prepare(`
    SELECT f.id, f.folio_number, f.fund_id, fu.name as fund_name, fu.isin, fu.category, fu.asset_class 
    FROM folios f 
    JOIN funds fu ON f.fund_id = fu.id 
    WHERE f.pan = ?
  `).all(pan) as Array<{ id: string, folio_number: string, fund_id: string, fund_name: string, isin: string, category: string, asset_class: string }>;
  
  if (folios.length === 0) {
    return {
      fy,
      pan,
      investorName: investor.name,
      totalSTCG: 0,
      totalLTCG: 0,
      ltcgExemptionUsed: 0,
      ltcgTaxable: 0,
      totalDebtGain: 0,
      estimatedSTCGTax: 0,
      estimatedLTCGTax: 0,
      folios: [],
      hasGrandfatheringFlags: false
    };
  }

  // Bulk fetch all transactions
  const allTxns = db.prepare(`
    SELECT t.date, t.transaction_type, t.units, t.amount, t.nav, t.folio_id 
    FROM transactions t 
    WHERE t.folio_id IN (SELECT id FROM folios WHERE pan = ?) 
    ORDER BY t.date ASC
  `).all(pan) as any[];

  // Partition into Map<folioId, txn[]>
  const txnMap = new Map<string, any[]>();
  for (const txn of allTxns) {
    if (!txnMap.has(txn.folio_id)) {
      txnMap.set(txn.folio_id, []);
    }
    txnMap.get(txn.folio_id)!.push(txn);
  }

  const folioGains: FolioCapitalGains[] = [];
  for (const f of folios) {
    const txns = txnMap.get(f.id) || [];
    const result = computeCapitalGains(
      f.id,
      f.folio_number,
      f.fund_name,
      f.isin,
      f.category,
      f.asset_class || '',
      txns,
      navOnDate,
      fyStart,
      fyEnd
    );
    
    // Skip if no sells in FY
    if (result.matchedLots.length > 0) {
      folioGains.push(result);
    }
  }

  const summary = aggregatePanGains(pan, investor.name, folioGains);

  // Proportionally allocate LTCG Tax
  if (summary.totalLTCG > 0) {
    for (const f of summary.folios) {
      f.estimatedLTCGTax = (f.totalLTCG / summary.totalLTCG) * summary.estimatedLTCGTax;
    }
  } else {
    for (const f of summary.folios) {
      f.estimatedLTCGTax = 0;
    }
  }

  return { fy, ...summary };
}

/**
 * GET /api/tax/capital-gains
 */
router.get('/capital-gains', async (req, res) => {
  try {
    const { pan, fy } = req.query as { pan: string, fy?: string };
    
    if (!pan) {
      return res.status(400).json({ error: 'PAN is required' });
    }

    log('app', 'INFO', MODULE, `Starting CG calculation for PAN: ${pan}, FY: ${fy || 'default'}`);
    const result = await getCapitalGainsSummary(pan, fy);
    log('app', 'INFO', MODULE, `Completed CG calculation for PAN: ${pan}. Folios with gains: ${result.folios.length}`);
    res.json(result);
  } catch (error: any) {
    const status = error.message.includes('Invalid FY format') ? 400 : 500;
    log('app', 'ERROR', MODULE, `Error in capital-gains: ${error.message}`);
    res.status(status).json({ error: error.message });
  }
});

/**
 * GET /api/tax/capital-gains/export
 */
router.get('/capital-gains/export', async (req, res) => {
  const { pan, fy, format } = req.query as { pan: string, fy?: string, format: string };
  
  if (!pan || !format || !['cleartax', 'quicko'].includes(format)) {
    return res.status(400).json({ error: 'PAN and valid format (cleartax|quicko) are required' });
  }

  try {
    const summary = await getCapitalGainsSummary(pan, fy);
    
    // Build CSV rows for MatchedLots (LTCG only)
    const rows: string[][] = [];
    
    for (const folio of summary.folios) {
      for (const lot of folio.matchedLots) {
        if (lot.gainType !== 'LTCG') continue;

        const isin = folio.isin || 'INNOTAVAILAB';
        const fundName = folio.fundName.replace(/[^a-zA-Z0-9 ]/g, '');
        const units = lot.units.toFixed(4);
        const saleNav = lot.saleNav.toFixed(4);
        const saleValue = (lot.units * lot.saleNav).toFixed(2);
        const col7 = (Math.max(lot.costPerUnit, lot.fmvJan2018 ?? 0) * lot.units).toFixed(2);
        
        // col9: Lower of FMV and Sale Value
        const lowerFmvSale = lot.fmvJan2018 
          ? Math.min(lot.fmvJan2018 * lot.units, parseFloat(saleValue)).toFixed(2) 
          : '';
        
        const fmvPerUnit = lot.fmvJan2018 ? lot.fmvJan2018.toFixed(4) : '';
        const totalFmv = lot.fmvJan2018 ? (lot.fmvJan2018 * lot.units).toFixed(2) : '';
        
        const row = [
          lot.acquiredFlag,
          lot.transferredFlag,
          isin,
          fundName,
          units,
          saleNav,
          saleValue,
          col7,
          lot.buyNav.toFixed(4),
          lowerFmvSale,
          fmvPerUnit,
          totalFmv,
          '0',
          col7,
          (parseFloat(saleValue) - parseFloat(col7)).toFixed(2)
        ];
        rows.push(row);
      }
    }

    let header = '';
    if (format === 'cleartax') {
      header = 'Acquired BE/AE,Transferred BE/AE,ISIN Code,Name of Share/Unit,No. of Units/Share,Sale Price per Unit/Share,Full Value of Consideration,Cost of Acquisition without Indexation,Cost of Acquisition (Actual),Lower of FMV and Sale Value,FMV per Unit as on 31.01.2018,Total FMV (col4 x col10),Expenditure on Transfer,Total Deductions,Balance (Gain/Loss)';
    } else {
      header = 'Acquisition Type,Transfer Type,ISIN,Scrip Name,Quantity,Sale Price,Sale Value,CoA (Without Indexation),Actual CoA,Lower of FMV & Sale Value,FMV as on 31-Jan-2018,Total FMV,Transfer Expenses,Total Cost,Net Gain/Loss';
    }

    const csvContent = [header, ...rows.map(r => r.join(','))].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="capital-gains-${pan}-FY${summary.fy}-${format}.csv"`);
    res.send(csvContent);
    
  } catch (error: any) {
    log('app', 'ERROR', MODULE, `Error in export: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/tax/unrealized
 */
router.get('/unrealized', async (req, res) => {
  const { pan } = req.query as { pan: string };
  if (!pan) return res.status(400).json({ error: 'PAN is required' });

  try {
    const investor = db.prepare('SELECT name FROM investors WHERE pan = ?').get(pan) as { name: string } | undefined;
    if (!investor) throw new Error(`Investor with PAN ${pan} not found`);

    const folios = db.prepare(`
      SELECT f.id, f.folio_number, f.fund_id, fu.name as fund_name, fu.isin, fu.category, fu.asset_class, f.stated_balance
      FROM folios f 
      JOIN funds fu ON f.fund_id = fu.id 
      WHERE f.pan = ? AND f.stated_balance > 0
    `).all(pan) as any[];

    const allTxns = db.prepare(`
      SELECT t.date, t.transaction_type, t.units, t.amount, t.nav, t.folio_id 
      FROM transactions t 
      WHERE t.folio_id IN (SELECT id FROM folios WHERE pan = ?) 
      ORDER BY t.date ASC
    `).all(pan) as any[];

    const txnMap = new Map<string, any[]>();
    for (const txn of allTxns) {
      if (!txnMap.has(txn.folio_id)) txnMap.set(txn.folio_id, []);
      txnMap.get(txn.folio_id)!.push(txn);
    }

    const today = new Date().toISOString().split('T')[0];
    const folioGains: FolioCapitalGains[] = [];

    for (const f of folios) {
      const latestNavRow = db.prepare('SELECT nav FROM nav_history WHERE isin = ? ORDER BY nav_date DESC LIMIT 1').get(f.isin) as { nav: number } | undefined;
      const latestNav = latestNavRow ? latestNavRow.nav : 0;

      const txns = [...(txnMap.get(f.id) || [])];
      // Synthetic sell
      txns.push({
        date: today,
        transaction_type: 'sell',
        units: -f.stated_balance,
        amount: -(f.stated_balance * latestNav),
        nav: latestNav
      });

      const result = computeCapitalGains(f.id, f.folio_number, f.fund_name, f.isin, f.category, f.asset_class || '', txns, navOnDate, '1900-01-01', today);
      folioGains.push(result);
    }

    const summary = aggregatePanGains(pan, investor.name, folioGains);
    res.json({ asOfDate: today, ...summary });
  } catch (error: any) {
    log('app', 'ERROR', MODULE, `Error in unrealized: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/tax/harvesting
 */
router.get('/harvesting', async (req, res) => {
  const { pan, fy } = req.query as { pan: string, fy?: string };
  if (!pan) return res.status(400).json({ error: 'PAN is required' });

  try {
    // This is a bit heavy, call helpers?
    // 1. Get Unrealized
    const unrealizedRes = await (async () => {
      const investor = db.prepare('SELECT name FROM investors WHERE pan = ?').get(pan) as { name: string };
      const folios = db.prepare(`
        SELECT f.id, f.folio_number, f.fund_id, fu.name as fund_name, fu.isin, fu.category, fu.asset_class, f.stated_balance 
        FROM folios f 
        JOIN funds fu ON f.fund_id = fu.id 
        WHERE f.pan = ? AND f.stated_balance > 0
      `).all(pan) as any[];

      const allTxns = db.prepare(`
        SELECT t.date, t.transaction_type, t.units, t.amount, t.nav, t.folio_id 
        FROM transactions t 
        WHERE t.folio_id IN (SELECT id FROM folios WHERE pan = ?) 
        ORDER BY t.date ASC
      `).all(pan) as any[];

      const txnMap = new Map<string, any[]>();
      for (const txn of allTxns) {
        if (!txnMap.has(txn.folio_id)) txnMap.set(txn.folio_id, []);
        txnMap.get(txn.folio_id)!.push(txn);
      }

      const today = new Date().toISOString().split('T')[0];
      const gains: FolioCapitalGains[] = [];
      for (const f of folios) {
        const row = db.prepare('SELECT nav FROM nav_history WHERE isin = ? ORDER BY nav_date DESC LIMIT 1').get(f.isin) as { nav: number };
        const nav = row ? row.nav : 0;
        const txns = [...(txnMap.get(f.id) || [])];
        txns.push({ date: today, transaction_type: 'sell', units: -f.stated_balance, amount: -(f.stated_balance * nav), nav });
        gains.push(computeCapitalGains(f.id, f.folio_number, f.fund_name, f.isin, f.category, f.asset_class || '', txns, navOnDate, '1900-01-01', today));
      }
      return aggregatePanGains(pan, investor.name, gains);
    })();

    // 2. Get Realized for current FY
    const realisedSummary = await getCapitalGainsSummary(pan, fy);

    const today = new Date().toISOString().split('T')[0];
    const isNewRegime = today >= CONFIG.TAX.EQUITY_RATE_CHANGE_DATE;
    const applicableExemption = isNewRegime
      ? CONFIG.TAX.EQUITY_LTCG_EXEMPTION_NEW
      : CONFIG.TAX.EQUITY_LTCG_EXEMPTION_OLD;
    const applicableStcgRate = isNewRegime
      ? CONFIG.TAX.EQUITY_STCG_RATE_NEW
      : CONFIG.TAX.EQUITY_STCG_RATE_OLD;

    const remainingLtcgExemption = Math.max(0, applicableExemption - realisedSummary.totalLTCG);

    const gainHarvesting = unrealizedRes.folios
      .filter(f => f.totalLTCG > 0 && f.totalLTCG <= remainingLtcgExemption)
      .map(f => ({
        folioId: f.folioId,
        folioNumber: f.folioNumber,
        fundName: f.fundName,
        unrealisedLTCG: f.totalLTCG,
        suggestedAction: 'Book gains — within exemption limit'
      }))
      .sort((a, b) => b.unrealisedLTCG - a.unrealisedLTCG);

    const lossHarvesting = unrealizedRes.folios
      .filter(f => f.totalSTCG < 0)
      .map(f => ({
        folioId: f.folioId,
        folioNumber: f.folioNumber,
        fundName: f.fundName,
        unrealisedSTCGLoss: Math.abs(f.totalSTCG),
        estimatedTaxSaving: Math.abs(f.totalSTCG) * applicableStcgRate,
        suggestedAction: 'Harvest loss — can offset STCG/LTCG. Re-buy immediately is legal in India.'
      }))
      .sort((a, b) => b.estimatedTaxSaving - a.estimatedTaxSaving);

    res.json({
      fy: realisedSummary.fy,
      pan,
      remainingLtcgExemption,
      realisedLTCG: realisedSummary.totalLTCG,
      gainHarvesting,
      lossHarvesting
    });
  } catch (error: any) {
    log('app', 'ERROR', MODULE, `Error in harvesting: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/tax/simulate
 */
router.get('/simulate', async (req, res) => {
  const { folioId, units, amount } = req.query as { folioId: string, units?: string, amount?: string };
  if (!folioId || (!units && !amount)) {
    return res.status(400).json({ error: 'FolioId and either units or amount are required' });
  }

  try {
    const folio = db.prepare(`
      SELECT f.id, f.folio_number, f.fund_id, f.stated_balance, fu.name as fund_name, fu.isin, fu.category, fu.asset_class, f.pan 
      FROM folios f 
      JOIN funds fu ON f.fund_id = fu.id 
      WHERE f.id = ?
    `).get(folioId) as any;
    
    if (!folio) return res.status(404).json({ error: 'Folio not found' });

    const latestNavRow = db.prepare('SELECT nav FROM nav_history WHERE isin = ? ORDER BY nav_date DESC LIMIT 1').get(folio.isin) as { nav: number } | undefined;
    if (!latestNavRow) return res.status(400).json({ error: 'Latest NAV not available for this fund' });
    const latestNav = latestNavRow.nav;

    let simUnits = units ? parseFloat(units) : (parseFloat(amount!) / latestNav);
    
    if (simUnits > folio.stated_balance + 0.0001) {
      return res.status(400).json({ error: `Simulation units (${simUnits.toFixed(4)}) exceed stated balance (${folio.stated_balance.toFixed(4)})` });
    }

    const txns = db.prepare('SELECT date, transaction_type, units, amount, nav FROM transactions WHERE folio_id = ? ORDER BY date ASC').all(folioId) as any[];
    const today = new Date().toISOString().split('T')[0];
    
    txns.push({
      date: today,
      transaction_type: 'sell',
      units: -simUnits,
      amount: -(simUnits * latestNav),
      nav: latestNav
    });

    const result = computeCapitalGains(folio.id, folio.folio_number, folio.fund_name, folio.isin, folio.category, folio.asset_class || '', txns, navOnDate, '1900-01-01', today);
    
    // Summary just for this folio for LTCG tax calculation
    const summary = aggregatePanGains(folio.pan, 'Simulation', [result]);

    res.json({
      folioId: folio.id,
      folioNumber: folio.folio_number,
      fundName: folio.fund_name,
      isin: folio.isin,
      simulatedUnits: simUnits,
      simulatedAmount: simUnits * latestNav,
      latestNav,
      matchedLots: result.matchedLots,
      totalSTCG: result.totalSTCG,
      totalLTCG: result.totalLTCG,
      totalDebtGain: result.totalDebtGain,
      estimatedSTCGTax: result.estimatedSTCGTax,
      estimatedLTCGTax: summary.estimatedLTCGTax,
      warnings: result.warnings
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
