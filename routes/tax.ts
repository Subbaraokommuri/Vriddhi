import { Router, Request, Response } from 'express';
import { 
  computeCapitalGains, 
  aggregatePanGains, 
  FolioCapitalGains, 
  PanCapitalGainsSummary,
  MatchedLot
} from '../lib/capital-gains.ts';
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
 * Helper: getCurrentFy()
 * Returns the current active Financial Year as a YYYY-YY string.
 */
function getCurrentFy(): string {
  const today = new Date();
  const year  = today.getFullYear();
  const month = today.getMonth() + 1; // 1-indexed
  if (month >= 4) {
    return `${year}-${String(year + 1).slice(-2)}`;
  }
  return `${year - 1}-${String(year).slice(-2)}`;
}

interface AdvanceTaxInstallment {
  installmentNumber: number;   // 1–4
  dueDate: string;             // YYYY-MM-DD
  cumulativePercent: number;   // 15, 45, 75, 100
  cumulativeAmount: number;    // cumulativePercent/100 * estimatedAnnualTax
  dueAmount: number;           // this installment only (delta from previous)
  isPastDue: boolean;          // dueDate < today
  isCurrentInstallment: boolean; // true on the first upcoming (not-yet-past-due) installment
}

/**
 * Helper: buildInstallments()
 * Generates the 4 advance tax installment slots.
 */
function buildInstallments(
  estimatedAnnualTax: number,
  fyStartYear: number,
  today: Date
): AdvanceTaxInstallment[] {
  const schedule = [
    { n: 1, percent: 15,  dueDate: `${fyStartYear}-06-15` },
    { n: 2, percent: 45,  dueDate: `${fyStartYear}-09-15` },
    { n: 3, percent: 75,  dueDate: `${fyStartYear}-12-15` },
    { n: 4, percent: 100, dueDate: `${fyStartYear + 1}-03-15` },
  ];

  let foundCurrent = false;
  return schedule.map((slot, idx) => {
    const cumulativeAmount = (slot.percent / 100) * estimatedAnnualTax;
    const prevCumulative   = idx === 0
      ? 0
      : (schedule[idx - 1].percent / 100) * estimatedAnnualTax;
    const dueAmount        = cumulativeAmount - prevCumulative;
    const isPastDue        = slot.dueDate < today.toISOString().slice(0, 10);
    const isCurrentInstallment = !isPastDue && !foundCurrent;
    if (isCurrentInstallment) foundCurrent = true;
    return {
      installmentNumber: slot.n,
      dueDate: slot.dueDate,
      cumulativePercent: slot.percent,
      cumulativeAmount: Math.round(cumulativeAmount * 100) / 100,
      dueAmount: Math.round(dueAmount * 100) / 100,
      isPastDue,
      isCurrentInstallment,
    };
  });
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
      hasGrandfatheringFlags: false,
      ltcgBE: 0,
      ltcgAE: 0,
      ltcgExemptionUsedBE: 0,
      ltcgExemptionUsedAE: 0
    };
  }

  // Bulk fetch all transactions
  const allTxns = db.prepare(`
    SELECT t.date, t.transaction_type, t.units, t.amount, t.nav, t.folio_id,
           t.transaction_subtype, t.merger_ratio, t.source_fund_id
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

  // Map from fund_id → { isin, transactions[] }
  const allTxnsByFundId = new Map<string, { isin: string; transactions: any[] }>();

  // Populate by iterating the folio+transaction data already fetched.
  // Use the folio's fund_id as the key and fund's isin as the isin value.
  // Accumulate — a fund can have multiple folios.
  for (const f of folios) {
    const txns = txnMap.get(f.id) || [];
    const existing = allTxnsByFundId.get(f.fund_id);
    if (existing) {
      existing.transactions.push(...txns);
    } else {
      allTxnsByFundId.set(f.fund_id, {
        isin: f.isin,  // the funds.isin column
        transactions: [...txns]
      });
    }
  }

  const folioGains: FolioCapitalGains[] = [];
  for (const f of folios) {
    const txns = txnMap.get(f.id) || [];

    const hasMergerIn = txns.some(
      t => (t.transaction_subtype ?? '') === 'merger_in'
    );

    let mergerSourceMap: Parameters<typeof computeCapitalGains>[10] = undefined;

    if (hasMergerIn) {
      const sourceIds = [...new Set(
        txns
          .filter(t => t.transaction_subtype === 'merger_in' && t.source_fund_id)
          .map(t => t.source_fund_id as string)
      )];
      mergerSourceMap = new Map(
        sourceIds
          .filter(id => allTxnsByFundId.has(id))
          .map(id => [id, allTxnsByFundId.get(id)!])
      );
    }

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
      fyEnd,
      mergerSourceMap
    );
    
    // Skip if no sells in FY
    if (result.matchedLots.length > 0) {
      folioGains.push(result);
    }
  }

  const summary = aggregatePanGains(pan, investor.name, folioGains);

  // Compute BE/AE LTCG split for exemption bar display (BUG-TAX-02 + BUG-TAX-05)
  let _ltcgBE = 0;
  let _ltcgAE = 0;
  for (const f of folioGains) {
    for (const lot of f.matchedLots) {
      if (lot.units < 0.00005) continue;
      if (lot.gainType === 'LTCG' && (lot.taxRate ?? 0) > 0) {
        if (lot.transferredFlag === 'BE') _ltcgBE += lot.gain;
        else if (lot.transferredFlag === 'AE') _ltcgAE += lot.gain;
      }
    }
  }
  const _stcgLoss = summary.totalSTCG < 0 ? Math.abs(summary.totalSTCG) : 0;
  const _aeAfterSetoff = Math.max(0, _ltcgAE - _stcgLoss);
  const _remainingLoss = Math.max(0, _stcgLoss - Math.max(0, _ltcgAE));
  const _beAfterSetoff = Math.max(0, _ltcgBE - _remainingLoss);
  const ltcgExemptionUsedBE = _beAfterSetoff > 0
    ? Math.min(_beAfterSetoff, CONFIG.TAX.EQUITY_LTCG_EXEMPTION_OLD) : 0;
  const ltcgExemptionUsedAE = _aeAfterSetoff > 0
    ? Math.min(_aeAfterSetoff, CONFIG.TAX.EQUITY_LTCG_EXEMPTION_NEW) : 0;

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

  return { fy, ...summary, ltcgBE: _ltcgBE, ltcgAE: _ltcgAE, ltcgExemptionUsedBE, ltcgExemptionUsedAE };
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
        const col7 = (lot.costPerUnit * lot.units).toFixed(2);
        
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
 * GET /api/tax/capital-gains-audit-csv
 */
router.get('/capital-gains-audit-csv', async (req, res) => {
  try {
    // STEP 1 — Validate params and call the existing internal helper:
    const { pan, fy } = req.query as { pan: string; fy?: string };
    if (!pan) return res.status(400).json({ error: 'PAN is required' });
    const summary = await getCapitalGainsSummary(pan, fy);

    // STEP 2 — Build investor name lookup map (one DB query):
    const foliosList = db.prepare('SELECT id, investor_name FROM folios WHERE pan = ?').all(pan) as Array<{ id: string; investor_name: string | null }>;
    const investorNameMap = new Map<string, string>();
    for (const f of foliosList) {
      investorNameMap.set(f.id, f.investor_name?.trim() || '');
    }

    // STEP 3 — Build sell description lookup map (one DB query):
    const sellTxns = db.prepare(`
      SELECT folio_id, date, description
      FROM transactions
      WHERE transaction_type = 'sell'
        AND folio_id IN (SELECT id FROM folios WHERE pan = ?)
      ORDER BY date ASC
    `).all(pan) as Array<{ folio_id: string; date: string; description: string | null }>;

    const sellDescMap = new Map<string, string>();
    for (const tx of sellTxns) {
      const key = `${tx.folio_id}|${tx.date}`;
      if (!sellDescMap.has(key)) {
        sellDescMap.set(key, tx.description || '');
      }
    }

    // STEP 4 — Build Section 1 CSV rows (one row per matched lot):
    const section1Rows: string[][] = [];
    for (const folio of summary.folios) {
      for (const lot of folio.matchedLots) {
        if (lot.units < 0.00005) continue;

        const investorName = investorNameMap.get(folio.folioId) ?? '';

        // Gain Type
        let derivedGainType: string = lot.gainType;
        if (lot.gainType === 'LTCG' && lot.taxRate === 0) {
          derivedGainType = 'LTCG_EXEMPT';
        }

        const row = [
          folio.fundName,
          folio.isin,
          folio.folioNumber,
          investorName,
          summary.pan,
          lot.buyDate,
          lot.buyNav.toFixed(4),
          lot.units.toFixed(4),
          lot.sellDate,
          lot.saleNav.toFixed(4),
          lot.units.toFixed(4),
          lot.holdingDays.toString(),
          derivedGainType,
          lot.acquiredFlag,
          lot.transferredFlag,
          lot.fmvJan2018 != null ? lot.fmvJan2018.toFixed(4) : '',
          lot.buyNav.toFixed(4),
          lot.costPerUnit.toFixed(4),
          lot.grandfatheringApplied ? 'Y' : 'N',
          lot.fmvMissing ? 'Y' : 'N',
          (lot.costPerUnit * lot.units).toFixed(2),
          (lot.saleNav * lot.units).toFixed(2),
          lot.gain.toFixed(2),
          lot.taxRate != null ? (lot.taxRate * 100).toFixed(1) : 'SLAB',
          lot.estimatedTax != null ? lot.estimatedTax.toFixed(2) : 'SLAB',
          sellDescMap.get(`${folio.folioId}|${lot.sellDate}`) ?? ''
        ];

        section1Rows.push(row);
      }
    }

    // STEP 5 — Compute Section 2 PAN Summary values from matchedLots.
    const qualifyingLots: MatchedLot[] = [];
    for (const folio of summary.folios) {
      for (const lot of folio.matchedLots) {
        if (lot.units < 0.00005) continue;
        qualifyingLots.push(lot);
      }
    }

    let totalSTCG = 0;
    let totalSTCG_BE = 0;
    let totalSTCG_AE = 0;
    let totalLTCG_exempt = 0;
    let taxableLtcg_BE = 0;
    let taxableLtcg_AE = 0;

    for (const lot of qualifyingLots) {
      if (lot.gainType === 'STCG') {
        totalSTCG += lot.gain;
        if (lot.transferredFlag === 'BE') {
          totalSTCG_BE += lot.gain;
        } else if (lot.transferredFlag === 'AE') {
          totalSTCG_AE += lot.gain;
        }
      } else if (lot.gainType === 'LTCG') {
        if ((lot.taxRate ?? 0) === 0) {
          totalLTCG_exempt += lot.gain;
        } else if ((lot.taxRate ?? 0) > 0) {
          if (lot.transferredFlag === 'BE') {
            taxableLtcg_BE += lot.gain;
          } else if (lot.transferredFlag === 'AE') {
            taxableLtcg_AE += lot.gain;
          }
        }
      }
    }

    // STCG loss set-off (apply to AE first, then BE — same as aggregatePanGains)
    const stcgLoss         = totalSTCG < 0 ? Math.abs(totalSTCG) : 0;
    const ae_after_setoff  = Math.max(0, taxableLtcg_AE - stcgLoss);
    const remaining_loss   = Math.max(0, stcgLoss - Math.max(0, taxableLtcg_AE));
    const be_after_setoff  = Math.max(0, taxableLtcg_BE - remaining_loss);
    const stcgLossApplied  = Math.min(stcgLoss, Math.max(0, taxableLtcg_AE + taxableLtcg_BE));

    // Exemptions (two separate pots — never combined)
    const exemption_BE = be_after_setoff > 0
      ? Math.min(be_after_setoff, CONFIG.TAX.EQUITY_LTCG_EXEMPTION_OLD) : 0;
    const exemption_AE = ae_after_setoff > 0
      ? Math.min(ae_after_setoff, CONFIG.TAX.EQUITY_LTCG_EXEMPTION_NEW) : 0;

    const finalTaxable_BE  = Math.max(0, be_after_setoff - exemption_BE);
    const finalTaxable_AE  = Math.max(0, ae_after_setoff - exemption_AE);

    const finalLTCGTax =
      finalTaxable_BE * CONFIG.TAX.EQUITY_LTCG_RATE_OLD +
      finalTaxable_AE * CONFIG.TAX.EQUITY_LTCG_RATE_NEW;

    // Compute STCG tax from net gain per rate bucket — consistent with
    // aggregatePanGains() fix for BUG-TAX-03
    const _csv_taxableBE = totalSTCG_BE >= 0
      ? Math.max(0, totalSTCG_BE + Math.min(0, totalSTCG_AE))
      : 0;
    const _csv_taxableAE = totalSTCG_AE >= 0
      ? Math.max(0, totalSTCG_AE + Math.min(0, totalSTCG_BE))
      : 0;
    const finalSTCGTax =
      _csv_taxableBE * CONFIG.TAX.EQUITY_STCG_RATE_OLD +
      _csv_taxableAE * CONFIG.TAX.EQUITY_STCG_RATE_NEW;
    const totalEstimatedTax = finalSTCGTax + finalLTCGTax;

    // STEP 6 — Assemble the full CSV string.
    const section1Header = [
      "Fund Name", "ISIN", "Folio Number", "Investor Name", "PAN", "Buy Date", "Buy NAV", "Buy Units",
      "Sell Date", "Sale NAV", "Units Sold", "Holding Days", "Gain Type", "Acquired Flag", "Transferred Flag",
      "FMV Jan 31 2018", "Actual Cost Per Unit", "Effective Cost Per Unit", "Grandfathering Applied",
      "FMV Missing", "Total Cost", "Total Sale Value", "Gain / Loss", "Tax Rate %", "Estimated Tax (pre-exemption)",
      "Sell Description"
    ];

    const section2RowsRaw = [
      ["Total STCG",             totalSTCG.toFixed(2)],
      ["Total STCG BE (15%)",    totalSTCG_BE.toFixed(2)],
      ["Total STCG AE (20%)",    totalSTCG_AE.toFixed(2)],
      ["Total LTCG Exempt",      totalLTCG_exempt.toFixed(2)],
      ["Total LTCG BE (taxable)",taxableLtcg_BE.toFixed(2)],
      ["Total LTCG AE (taxable)",taxableLtcg_AE.toFixed(2)],
      ["STCG Loss Set-off Applied", stcgLossApplied.toFixed(2)],
      ["LTCG BE After Set-off",  be_after_setoff.toFixed(2)],
      ["LTCG AE After Set-off",  ae_after_setoff.toFixed(2)],
      ["LTCG BE Exemption Used (Rs 1,00,000 pot)", exemption_BE.toFixed(2)],
      ["LTCG AE Exemption Used (Rs 1,25,000 pot)", exemption_AE.toFixed(2)],
      ["Final Taxable LTCG BE",  finalTaxable_BE.toFixed(2)],
      ["Final Taxable LTCG AE",  finalTaxable_AE.toFixed(2)],
      ["Final LTCG Tax",         finalLTCGTax.toFixed(2)],
      ["Final STCG Tax",         finalSTCGTax.toFixed(2)],
      ["Total Estimated Tax",    totalEstimatedTax.toFixed(2)]
    ];

    const allCsvRows: string[][] = [];
    allCsvRows.push(section1Header);
    for (const r of section1Rows) {
      allCsvRows.push(r);
    }
    allCsvRows.push(Array(26).fill(''));
    allCsvRows.push(['SECTION 2 — PAN SUMMARY', ...Array(25).fill('')]);
    allCsvRows.push(['Field', 'Value', ...Array(24).fill('')]);
    for (const s2 of section2RowsRaw) {
      allCsvRows.push([s2[0], s2[1], ...Array(24).fill('')]);
    }

    function escapeCsvCell(val: string | number | null | undefined): string {
      if (val === null || val === undefined) {
        return '';
      }
      let str = String(val);
      const needsQuotes = str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r');
      if (str.includes('"')) {
        str = str.replace(/"/g, '""');
      }
      if (needsQuotes) {
        return `"${str}"`;
      }
      return str;
    }

    const csvContent = allCsvRows.map(row => row.map(escapeCsvCell).join(',')).join('\n');

    // STEP 7 — Set response headers and send:
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="vriddhi-capital-gains-audit-${pan}-FY${summary.fy}.csv"`
    );
    res.send(csvContent);

  } catch (error: any) {
    // STEP 8 — Wrap in try/catch. On error:
    log('app', 'ERROR', MODULE, `Error in capital-gains-audit-csv: ${error.message}`);
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

/**
 * GET /api/tax/advance-tax
 */
router.get('/advance-tax', async (req, res) => {
  const pan = req.query.pan as string;
  if (!pan) {
    return res.status(400).json({ error: 'PAN is required' });
  }

  const MODULE_ADV = 'TAX_ADVANCE';
  try {
    log('app', 'INFO', MODULE_ADV, `Advance tax estimate for PAN: ${pan}`);

    // STEP 1 — Determine the current FY:
    const fyQuery = req.query.fy as string | undefined;
    const currentFy = fyQuery && fyQuery.trim() !== '' ? fyQuery : getCurrentFy();
    const { fyStart, fyEnd } = getFyBounds(currentFy);
    const fyStartYear = parseInt(currentFy.split('-')[0]);

    // Fetch investor name
    const investor = db.prepare('SELECT name FROM investors WHERE pan = ?').get(pan) as { name: string } | undefined;
    if (!investor) {
      return res.status(404).json({ error: `Investor with PAN ${pan} not found` });
    }

    // STEP 2 — Fetch all folios for this PAN:
    const folios = db.prepare(`
      SELECT f.id, f.folio_number, f.fund_id, fu.name as fund_name, fu.isin, fu.category, fu.asset_class 
      FROM folios f 
      JOIN funds fu ON f.fund_id = fu.id 
      WHERE f.pan = ?
    `).all(pan) as Array<{ id: string, folio_number: string, fund_id: string, fund_name: string, isin: string, category: string, asset_class: string }>;

    if (folios.length === 0) {
      const today = new Date();
      const installments = buildInstallments(0, fyStartYear, today);
      const paidSoFarVal = parseFloat(req.query.paidSoFar as string) || 0;
      return res.json({
        currentFy,
        estimatedAnnualTax: 0,
        realisedTax: {
          netSTCG: 0,
          netLTCG: 0,
          estimatedSTCGTax: 0,
          estimatedLTCGTax: 0,
          totalTax: 0,
        },
        paidSoFar: paidSoFarVal,
        totalStillDue: 0,
        installments,
      });
    }

    // STEP 3 — Bulk-fetch all transactions for those folioIds in one query:
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

    // STEP 4 — Call computeCapitalGains() per folio, then aggregatePanGains(),
    // passing fyStart and fyEnd exactly as GET /api/tax/capital-gains does.
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

    // STEP 5 — Extract estimated tax from the summary:
    const estimatedAnnualTax = (summary.estimatedSTCGTax ?? 0) + (summary.estimatedLTCGTax ?? 0);

    // STEP 6 — Parse paidSoFar:
    const paidSoFar = parseFloat(req.query.paidSoFar as string) || 0;
    const totalStillDue = Math.max(0, estimatedAnnualTax - paidSoFar);

    // STEP 7 — Build installments:
    const today = new Date();
    const installments = buildInstallments(estimatedAnnualTax, fyStartYear, today);

    // STEP 8 — Build and return response:
    return res.json({
      currentFy,
      estimatedAnnualTax,
      realisedTax: {
        netSTCG:          summary.totalSTCG,
        netLTCG:          summary.totalLTCG,
        estimatedSTCGTax: summary.estimatedSTCGTax,
        estimatedLTCGTax: summary.estimatedLTCGTax,
        totalTax:         estimatedAnnualTax,
      },
      paidSoFar,
      totalStillDue,
      installments,
    });
  } catch (err: any) {
    log('app', 'ERROR', MODULE_ADV, `Failed: ${err}`);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
