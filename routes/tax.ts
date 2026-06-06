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
import ExcelJS from 'exceljs';

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

function getFyType(fy: string): 'current' | 'previous' | 'historical' {
  const currentFy = getCurrentFy();
  if (fy === currentFy) {
    return 'current';
  }
  const startYear = parseInt(currentFy.split('-')[0], 10);
  const previousFy = `${startYear - 1}-${String(startYear).slice(-2)}`;
  if (fy === previousFy) {
    return 'previous';
  }
  return 'historical';
}

interface QuarterRedemption {
  date: string;
  fundName: string;
  folioNumber: string;
  units: number;     // absolute value, positive
  amount: number;    // absolute value, positive
}

interface AdvanceTaxInstallment {
  installmentNumber: number;       // 1–4
  dueDate: string;                 // payment due date: Jun15/Sep15/Dec15/Mar15
  cutoffDate: string;              // gains computed up to this date
                                   // Q1-Q3: same as dueDate; Q4: fyEnd (Mar31)
  cumulativePercent: number;       // 15 | 45 | 75 | 100
  cumulativeTaxUpToCutoff: number; // total estimated tax on gains fyStart–cutoffDate
  cumulativeObligation: number;    // cumulativePercent/100 × cumulativeTaxUpToCutoff
  dueAmount: number;               // cumulativeObligation minus previous installment's
                                   // cumulativeObligation (0 for installment 1 if
                                   // cumulativeObligation is the full obligation)
  quarterSTCG: number;             // STCG from sells in THIS quarter only
  quarterLTCG: number;             // LTCG from sells in THIS quarter only
  quarterTaxContribution: number;  // incremental tax this quarter contributed
  quarterRedemptions: QuarterRedemption[];
  isPastDue: boolean;
  isCurrentInstallment: boolean;
}

function buildInstallmentsFromSummaries(
  summaries: PanCapitalGainsSummary[],  // array of 4, index 0=Q1 ... 3=Q4
  cutoffDates: string[],                // ['YYYY-06-15','YYYY-09-15','YYYY-12-15','YYYY-03-31']
  dueDates: string[],                   // ['YYYY-06-15','YYYY-09-15','YYYY-12-15','YYYY+1-03-15']
  quarterRedemptionsList: QuarterRedemption[][],  // array of 4, one per quarter
  today: Date
): AdvanceTaxInstallment[] {
  const percents = [15, 45, 75, 100];
  const installments: AdvanceTaxInstallment[] = [];
  let foundCurrent = false;

  const todayStr = today.toISOString().slice(0, 10);

  for (let i = 0; i < 4; i++) {
    const summary = summaries[i];
    const prevSummary = i > 0 ? summaries[i - 1] : null;

    const cumulativeTax = (summary.estimatedSTCGTax ?? 0) + (summary.estimatedLTCGTax ?? 0);
    const cumulativeObligation = (percents[i] / 100) * cumulativeTax;
    
    const prevCumulativeTax = prevSummary 
      ? (prevSummary.estimatedSTCGTax ?? 0) + (prevSummary.estimatedLTCGTax ?? 0)
      : 0;
    const prevCumulativeObligation = prevSummary
      ? (percents[i - 1] / 100) * prevCumulativeTax
      : 0;

    const dueAmount = cumulativeObligation - prevCumulativeObligation;

    const quarterSTCG = summary.totalSTCG - (prevSummary ? prevSummary.totalSTCG : 0);
    const quarterLTCG = summary.totalLTCG - (prevSummary ? prevSummary.totalLTCG : 0);
    const quarterTaxContribution = cumulativeTax - (prevSummary ? prevCumulativeTax : 0);

    const isPastDue = dueDates[i] < todayStr;
    const isCurrentInstallment = !isPastDue && !foundCurrent;
    if (isCurrentInstallment) {
      foundCurrent = true;
    }

    installments.push({
      installmentNumber: i + 1,
      dueDate: dueDates[i],
      cutoffDate: cutoffDates[i],
      cumulativePercent: percents[i],
      cumulativeTaxUpToCutoff: Math.round(cumulativeTax * 100) / 100,
      cumulativeObligation: Math.round(cumulativeObligation * 100) / 100,
      dueAmount: Math.round(dueAmount * 100) / 100,
      quarterSTCG: Math.round(quarterSTCG * 100) / 100,
      quarterLTCG: Math.round(quarterLTCG * 100) / 100,
      quarterTaxContribution: Math.round(quarterTaxContribution * 100) / 100,
      quarterRedemptions: quarterRedemptionsList[i] || [],
      isPastDue,
      isCurrentInstallment,
    });
  }

  return installments;
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
           t.transaction_subtype, t.merger_ratio, t.source_fund_id, t.buy_effective_cost
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
          (lot.buyNav * lot.units).toFixed(2),
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
      SELECT t.date, t.transaction_type, t.units, t.amount, t.nav, t.folio_id, t.buy_effective_cost 
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
        SELECT t.date, t.transaction_type, t.units, t.amount, t.nav, t.folio_id, t.buy_effective_cost 
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

    const txns = db.prepare('SELECT date, transaction_type, units, amount, nav, buy_effective_cost FROM transactions WHERE folio_id = ? ORDER BY date ASC').all(folioId) as any[];
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

interface InstallmentExportRow {
  installmentNumber: number;
  dueDate: string;
  cutoffDate: string;
  cumulativePercent: number;
  quarterSTCG: number;
  quarterLTCG: number;
  cumulativeTaxUpToCutoff: number;
  cumulativeObligation: number;
  dueAmount: number;
  paid: number;           // user-entered
  shortfall: number;      // max(0, cumulativeObligation - cumulativePaid)
  interest234C: number;   // shortfall * 0.01 * (installmentNumber<=3 ? 3 : 1)
}

interface RedemptionExportRow {
  quarter: string;        // 'Q1 (Apr–Jun 15)', 'Q2 (Jun 16–Sep 15)', etc.
  date: string;
  fundName: string;       // simple_name || clean_name || fund_name from funds table
  isin: string;
  folioNumber: string;
  units: number;
  nav: number;
  amount: number;
  transferredFlag: string; // BE or AE, derived from sell date vs EQUITY_RATE_CHANGE_DATE
}

/**
 * Shared logic to compute advance tax data
 */
async function computeAdvanceTaxData(
  pan: string,
  fy: string
): Promise<{
  investor: { name: string };
  installments: AdvanceTaxInstallment[];
  fullYearTax: number;
  fyType: 'current' | 'previous' | 'historical';
} | null> {
  const { fyStart, fyEnd } = getFyBounds(fy);
  const fyType = getFyType(fy);
  const fyStartYear = parseInt(fy.split('-')[0], 10);
  const fyEndYear = fyStartYear + 1;

  // STEP 4b — Define 4 cutoff/due date pairs:
  const cutoffDates = [
    `${fyStartYear}-06-15`,
    `${fyStartYear}-09-15`,
    `${fyStartYear}-12-15`,
    fyEnd,                        // Mar 31 — full FY
  ];
  const dueDates = [
    `${fyStartYear}-06-15`,
    `${fyStartYear}-09-15`,
    `${fyStartYear}-12-15`,
    `${fyEndYear}-03-15`,         // Mar 15 — due date for Q4
  ];

  // STEP 4c — Fetch investor and folios:
  const investor = db.prepare('SELECT name FROM investors WHERE pan = ?').get(pan) as { name: string } | undefined;
  if (!investor) {
    return null;
  }

  const folios = db.prepare(`
    SELECT f.id, f.folio_number, f.fund_id,
           fu.name as fund_name, fu.simple_name, fu.clean_name,
           fu.isin, fu.category, fu.asset_class 
    FROM folios f 
    JOIN funds fu ON f.fund_id = fu.id 
    WHERE f.pan = ?
  `).all(pan) as Array<{ id: string, folio_number: string, fund_id: string, fund_name: string, simple_name: string, clean_name: string, isin: string, category: string, asset_class: string }>;

  if (folios.length === 0) {
    const today = new Date();
    const emptySummary: any = {
      totalSTCG: 0,
      totalLTCG: 0,
      estimatedSTCGTax: 0,
      estimatedLTCGTax: 0,
      folios: []
    };
    const emptySummaries = [emptySummary, emptySummary, emptySummary, emptySummary];
    const emptyRedemptions: QuarterRedemption[][] = [[], [], [], []];
    const installments = buildInstallmentsFromSummaries(
      emptySummaries, cutoffDates, dueDates, emptyRedemptions, today
    );
    return {
      investor,
      installments,
      fullYearTax: 0,
      fyType
    };
  }

  // STEP 4d — Bulk-fetch ALL transactions for this PAN in ONE query:
  const allTxns = db.prepare(`
    SELECT t.date, t.transaction_type, t.units, t.amount, t.nav,
           t.folio_id, t.description,
           t.transaction_subtype, t.merger_ratio, t.source_fund_id, t.buy_effective_cost
    FROM transactions t
    WHERE t.folio_id IN (SELECT id FROM folios WHERE pan = ?)
    ORDER BY t.date ASC
  `).all(pan) as any[];

  // STEP 4e — Partition transactions into txnMap (Map<folioId, txn[]>):
  const txnMap = new Map<string, any[]>();
  for (const txn of allTxns) {
    if (!txnMap.has(txn.folio_id)) {
      txnMap.set(txn.folio_id, []);
    }
    txnMap.get(txn.folio_id)!.push(txn);
  }

  // STEP 4f — Build merger source maps per folio:
  const allTxnsByFundId = new Map<string, { isin: string; transactions: any[] }>();
  for (const f of folios) {
    const txns = txnMap.get(f.id) || [];
    const existing = allTxnsByFundId.get(f.fund_id);
    if (existing) {
      existing.transactions.push(...txns);
    } else {
      allTxnsByFundId.set(f.fund_id, {
        isin: f.isin,
        transactions: [...txns]
      });
    }
  }

  const folioMergerSourceMaps = new Map<string, Map<string, { isin: string; transactions: any[] }> | undefined>();
  for (const f of folios) {
    const txns = txnMap.get(f.id) || [];
    const hasMergerIn = txns.some(
      t => (t.transaction_subtype ?? '') === 'merger_in'
    );
    let mergerSourceMap: Map<string, { isin: string; transactions: any[] }> | undefined = undefined;
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
    folioMergerSourceMaps.set(f.id, mergerSourceMap);
  }

  // STEP 4g — Run 4 cumulative computations:
  const summaries: PanCapitalGainsSummary[] = [];
  for (let c = 0; c < 4; c++) {
    const folioGainsPerCutoff: FolioCapitalGains[] = [];
    for (const f of folios) {
      const txns = txnMap.get(f.id) || [];
      const mergerSourceMapForFolio = folioMergerSourceMaps.get(f.id);
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
        cutoffDates[c], // different per run
        mergerSourceMapForFolio // built once in STEP 4f, reused
      );
      if (result.matchedLots.length > 0) {
        folioGainsPerCutoff.push(result);
      }
    }
    summaries.push(aggregatePanGains(pan, investor.name, folioGainsPerCutoff));
  }

  // STEP 4h — Build quarterRedemptions per quarter:
  const folioLookup = new Map<string, { fundName: string, folioNumber: string }>();
  for (const f of folios) {
    folioLookup.set(f.id, { fundName: f.simple_name || f.clean_name || f.fund_name, folioNumber: f.folio_number });
  }

  const sells = allTxns.filter(t => t.transaction_type === 'sell');
  const quarterRedemptionsList: QuarterRedemption[][] = [[], [], [], []];

  for (const txn of sells) {
    const date = txn.date;
    const fInfo = folioLookup.get(txn.folio_id);
    if (!fInfo) continue;

    const qRedemption: QuarterRedemption = {
      date,
      fundName: fInfo.fundName,
      folioNumber: fInfo.folioNumber,
      units: Math.abs(txn.units),
      amount: Math.abs(txn.amount)
    };

    if (date >= fyStart && date <= cutoffDates[0]) {
      quarterRedemptionsList[0].push(qRedemption);
    } else if (date > cutoffDates[0] && date <= cutoffDates[1]) {
      quarterRedemptionsList[1].push(qRedemption);
    } else if (date > cutoffDates[1] && date <= cutoffDates[2]) {
      quarterRedemptionsList[2].push(qRedemption);
    } else if (date > cutoffDates[2] && date <= cutoffDates[3]) {
      quarterRedemptionsList[3].push(qRedemption);
    }
  }

  // STEP 4i — Build installments:
  const today = new Date();
  const installments = buildInstallmentsFromSummaries(
    summaries, cutoffDates, dueDates, quarterRedemptionsList, today
  );

  return {
    investor,
    installments,
    fullYearTax: (summaries[3].estimatedSTCGTax ?? 0) + (summaries[3].estimatedLTCGTax ?? 0),
    fyType
  };
}

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

    const fyQuery = req.query.fy as string | undefined;
    const fy = fyQuery && fyQuery.trim() !== '' ? fyQuery : getCurrentFy();

    const data = await computeAdvanceTaxData(pan, fy);
    if (!data) {
      return res.status(404).json({ error: `Investor with PAN ${pan} not found` });
    }

    return res.json({
      currentFy: fy,
      fyType: data.fyType,
      fullYearTax: data.fullYearTax,
      installments: data.installments
    });
  } catch (err: any) {
    log('app', 'ERROR', MODULE_ADV, `Failed: ${err}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tax/advance-tax/export
 * Generates and streams a two-sheet Excel (.xlsx) file using the exceljs library.
 */
router.get('/advance-tax/export', async (req, res) => {
  const pan = req.query.pan as string;
  const fy = req.query.fy as string;

  if (!pan) {
    return res.status(400).json({ error: 'PAN is required' });
  }
  if (!fy) {
    return res.status(400).json({ error: 'FY is required' });
  }

  try {
    const { fyStart, fyEnd } = getFyBounds(fy);
    const fyType = getFyType(fy);
    const fyStartYear = parseInt(fy.split('-')[0], 10);
    const fyEndYear = fyStartYear + 1;

    // Optional user inputs
    let saDate = (req.query.saDate as string) || `${fyEndYear}-07-31`;
    const showInterest = req.query.showInterest === 'true';

    let paid1 = parseFloat(req.query.paid1 as string || '0') || 0;
    let paid2 = parseFloat(req.query.paid2 as string || '0') || 0;
    let paid3 = parseFloat(req.query.paid3 as string || '0') || 0;
    let paid4 = parseFloat(req.query.paid4 as string || '0') || 0;

    if (fyType === 'historical' && showInterest) {
      paid1 = parseFloat(req.query.histPaid1 as string || '0') || 0;
      paid2 = parseFloat(req.query.histPaid2 as string || '0') || 0;
      paid3 = parseFloat(req.query.histPaid3 as string || '0') || 0;
      paid4 = parseFloat(req.query.histPaid4 as string || '0') || 0;
      if (req.query.histSaDate) {
        saDate = req.query.histSaDate as string;
      }
    }

    const paidAmounts = [paid1, paid2, paid3, paid4];

    // Compute advance tax data
    const data = await computeAdvanceTaxData(pan, fy);
    if (!data) {
      return res.status(404).json({ error: `Investor with PAN ${pan} not found` });
    }

    // Fetch fund details and ISIN lookup
    const redemptionsList = db.prepare(`
      SELECT t.date, t.nav, t.units, t.amount, t.folio_id,
             f.folio_number,
             fu.simple_name, fu.clean_name, fu.name as fund_name, fu.isin
      FROM transactions t
      JOIN folios f ON t.folio_id = f.id
      JOIN funds fu ON f.fund_id = fu.id
      WHERE t.transaction_type = 'sell'
        AND t.date >= ? AND t.date <= ?
        AND f.pan = ?
      ORDER BY t.date ASC
    `).all(fyStart, fyEnd, pan) as any[];

    const redemptionMap = new Map<string, RedemptionExportRow>();
    for (const r of redemptionsList) {
      const key = `${r.folio_id}|${r.date}`;
      const fundName = r.simple_name || r.clean_name || r.fund_name;
      const transferredFlag = r.date >= CONFIG.TAX.EQUITY_RATE_CHANGE_DATE ? 'AE' : 'BE';
      redemptionMap.set(key, {
        quarter: '',
        date: r.date,
        fundName,
        isin: r.isin || '',
        folioNumber: r.folio_number,
        units: Math.abs(r.units),
        nav: r.nav,
        amount: Math.abs(r.amount),
        transferredFlag
      });
    }

    const foliosInfo = db.prepare('SELECT id, folio_number FROM folios WHERE pan = ?').all(pan) as any[];
    const folioNumToId = new Map<string, string>();
    for (const f of foliosInfo) {
      folioNumToId.set(f.folio_number, f.id);
    }

    // Build installment rows
    const installmentRows: InstallmentExportRow[] = [];
    let runningPaidSum = 0;
    for (let i = 0; i < 4; i++) {
      const inst = data.installments[i];
      const paidVal = paidAmounts[i];
      runningPaidSum += paidVal;

      const shortfall = Math.max(0, inst.cumulativeObligation - runningPaidSum);
      const interest234C = showInterest
        ? shortfall * 0.01 * (inst.installmentNumber <= 3 ? 3 : 1)
        : 0;

      installmentRows.push({
        installmentNumber: inst.installmentNumber,
        dueDate: inst.dueDate,
        cutoffDate: inst.cutoffDate,
        cumulativePercent: inst.cumulativePercent,
        quarterSTCG: inst.quarterSTCG,
        quarterLTCG: inst.quarterLTCG,
        cumulativeTaxUpToCutoff: inst.cumulativeTaxUpToCutoff,
        cumulativeObligation: inst.cumulativeObligation,
        dueAmount: inst.dueAmount,
        paid: paidVal,
        shortfall,
        interest234C
      });
    }

    // 234B interest calculation
    let fullYearTax = data.fullYearTax;
    let totalPaid = runningPaidSum;
    let ninetyPct = fullYearTax * 0.9;
    let applicable234B = totalPaid < ninetyPct;
    let shortfall234B = 0;
    let months234B = 0;
    let interest234B = 0;

    if (showInterest && applicable234B) {
      shortfall234B = fullYearTax - totalPaid;
      const april1 = new Date(`${fyEndYear}-04-01`);
      const saDateObj = new Date(saDate);
      months234B = Math.max(1, Math.ceil(
        (saDateObj.getTime() - april1.getTime()) / (1000 * 60 * 60 * 24 * 30)
      ));
      interest234B = Math.round(shortfall234B * 0.01 * months234B * 100) / 100;
    }

    // Build Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Vriddhi';
    workbook.created = new Date();

    // SHEET 1: Advance Tax Schedule
    const sheet1 = workbook.addWorksheet('Advance Tax Schedule');

    sheet1.addRow(['Report', 'Vriddhi Advance Tax Report']);
    sheet1.addRow(['PAN', pan]);
    sheet1.addRow(['Investor Name', data.investor.name]);
    sheet1.addRow(['Financial Year', fy]);
    sheet1.addRow(['FY Type', data.fyType]);
    sheet1.addRow(['Generated On', new Date().toISOString().slice(0, 10)]);
    sheet1.addRow([]);
    sheet1.addRow(['Tax Rates', 'STCG: BE 15% (pre-Jul 23 2024) / AE 20% (Jul 23 2024+)']);
    sheet1.addRow(['LTCG Rates', 'BE 10% (pre-Jul 23 2024) / AE 12.5% (Jul 23 2024+)']);
    sheet1.addRow(['LTCG Exemption', 'BE pot ₹1,00,000 / AE pot ₹1,25,000 (never combined)']);
    sheet1.addRow(['Grandfathering', 'FMV as on Jan 31 2018 used as cost basis for pre-2018 lots']);
    sheet1.addRow(['234C Basis', '3% of shortfall for Q1–Q3; 1% of shortfall for Q4']);
    sheet1.addRow(['Data Note', 'Paid amounts and self-assessment date are user-entered. All other values are computed from transaction data.']);
    sheet1.addRow([]);

    for (let r = 1; r <= 13; r++) {
      const rowObj = sheet1.getRow(r);
      rowObj.getCell(1).font = { bold: true };
    }

    const headers = [
      'Installment',
      'Due Date',
      'Cutoff Date',
      'Cumulative %',
      'Quarter STCG (₹)',
      'Quarter LTCG (₹)',
      'Cumulative Tax (₹)',
      'Cumulative Obligation (₹)',
      'This Installment Due (₹)'
    ];

    if (showInterest) {
      headers.push(
        'Paid (User-entered) (₹)',
        'Shortfall (₹)',
        '234C Interest (₹)'
      );
    }

    const headerRow = sheet1.addRow(headers);
    headerRow.font = { bold: true };
    for (let colIndex = 1; colIndex <= headers.length; colIndex++) {
      const cell = headerRow.getCell(colIndex);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFEFEF' }
      };
    }

    const colWidths = [16, 14, 14, 14, 18, 18, 22, 24, 22, 22, 16, 18];
    for (let i = 0; i < headers.length; i++) {
      sheet1.getColumn(i + 1).width = colWidths[i] || 15;
    }

    for (let i = 0; i < 4; i++) {
      const inst = data.installments[i];
      const rowData = installmentRows[i];

      const values = [
        `Installment ${rowData.installmentNumber}`,
        rowData.dueDate,
        rowData.cutoffDate,
        rowData.cumulativePercent,
        rowData.quarterSTCG,
        rowData.quarterLTCG,
        rowData.cumulativeTaxUpToCutoff,
        rowData.cumulativeObligation,
        rowData.dueAmount
      ];

      if (showInterest) {
        values.push(
          rowData.paid,
          rowData.shortfall,
          rowData.interest234C
        );
      }

      const newRow = sheet1.addRow(values);

      const currencyCols = [5, 6, 7, 8, 9];
      if (showInterest) {
        currencyCols.push(10, 11, 12);
      }
      for (const col of currencyCols) {
        newRow.getCell(col).numFmt = '#,##0.00';
      }
      newRow.getCell(4).numFmt = '0';

      if (inst.isCurrentInstallment) {
        newRow.font = { bold: true };
      }
    }

    sheet1.addRow([]); // Row 20 or 21 depending on showInterest

    if (showInterest) {
      const q4Obligation = installmentRows[3].cumulativeObligation;
      const sumPaid = installmentRows.reduce((sum, r) => sum + r.paid, 0);
      const totalShortfall = Math.max(0, q4Obligation - sumPaid);
      const sumInterest234C = installmentRows.reduce((sum, r) => sum + r.interest234C, 0);

      const totalsValues = [
        'TOTAL',
        null, null, null, null, null, null,
        q4Obligation,
        null,
        sumPaid,
        totalShortfall,
        sumInterest234C
      ];

      const totalsRow = sheet1.addRow(totalsValues);
      totalsRow.font = { bold: true };

      totalsRow.getCell(8).numFmt = '#,##0.00';
      totalsRow.getCell(10).numFmt = '#,##0.00';
      totalsRow.getCell(11).numFmt = '#,##0.00';
      totalsRow.getCell(12).numFmt = '#,##0.00';

      sheet1.addRow([]); // Blank row

      const s234BTitleRow = sheet1.addRow(['── Section 234B: Default in Advance Tax ──']);
      s234BTitleRow.font = { bold: true };
      const rowNum = s234BTitleRow.number;
      sheet1.mergeCells(`A${rowNum}:L${rowNum}`);

      const r23 = sheet1.addRow(['Full Year Tax', fullYearTax]);
      r23.getCell(1).font = { bold: true };
      r23.getCell(2).numFmt = '#,##0.00';

      const r24 = sheet1.addRow(['Total Advance Tax Paid', totalPaid]);
      r24.getCell(1).font = { bold: true };
      r24.getCell(2).numFmt = '#,##0.00';

      const r25 = sheet1.addRow(['90% Threshold', ninetyPct]);
      r25.getCell(1).font = { bold: true };
      r25.getCell(2).numFmt = '#,##0.00';

      const r26 = sheet1.addRow(['234B Applicable?', applicable234B ? 'Yes' : 'No']);
      r26.getCell(1).font = { bold: true };

      if (applicable234B) {
        const r27 = sheet1.addRow(['Shortfall', shortfall234B]);
        r27.getCell(1).font = { bold: true };
        r27.getCell(2).numFmt = '#,##0.00';

        const r28 = sheet1.addRow(['Self-Assessment Date', saDate]);
        r28.getCell(1).font = { bold: true };

        const r29 = sheet1.addRow(['Months (Apr 1 to SA Date)', months234B]);
        r29.getCell(1).font = { bold: true };

        const r30 = sheet1.addRow(['Estimated 234B Interest', interest234B]);
        r30.getCell(1).font = { bold: true, color: { argb: 'FFFF0000' } };
        r30.getCell(2).font = { bold: true, color: { argb: 'FFFF0000' } };
        r30.getCell(2).numFmt = '#,##0.00';
      }
    }

    // SHEET 2: Redemption Detail
    const sheet2 = workbook.addWorksheet('Redemption Detail');

    sheet2.addRow(['PAN', pan]);
    sheet2.addRow(['FY', fy]);
    sheet2.addRow([]);

    const quartersInfo = [
      { label: 'Q1: Apr 01 – Jun 15', list: data.installments[0].quarterRedemptions },
      { label: 'Q2: Jun 16 – Sep 15', list: data.installments[1].quarterRedemptions },
      { label: 'Q3: Sep 16 – Dec 15', list: data.installments[2].quarterRedemptions },
      { label: 'Q4: Dec 16 – Mar 31', list: data.installments[3].quarterRedemptions }
    ];

    let anyQuarterRendered = false;

    for (let q = 0; q < 4; q++) {
      const qInfo = quartersInfo[q];
      const qrList = qInfo.list;
      if (qrList.length === 0) continue;

      anyQuarterRendered = true;

      // Quarter label row
      const qLabelRow = sheet2.addRow([qInfo.label]);
      qLabelRow.font = { bold: true };
      const qLabelRowNum = qLabelRow.number;
      sheet2.mergeCells(`A${qLabelRowNum}:H${qLabelRowNum}`);
      for (let c = 1; c <= 8; c++) {
        qLabelRow.getCell(c).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD6E4F0' }
        };
      }

      // Column header row
      const qHeader = [
        'Date',
        'Fund Name',
        'ISIN',
        'Folio Number',
        'Units',
        'NAV',
        'Amount (₹)',
        'Rate Bucket'
      ];
      const qHeaderRow = sheet2.addRow(qHeader);
      qHeaderRow.font = { bold: true };
      for (let c = 1; c <= 8; c++) {
        qHeaderRow.getCell(c).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFEFEFEF' }
        };
      }

      // Write redemption rows
      for (const qr of qrList) {
        const folioId = folioNumToId.get(qr.folioNumber);
        const key = `${folioId}|${qr.date}`;
        const rRow = redemptionMap.get(key);

        const actualFundName = rRow?.fundName || qr.fundName;
        const actualIsin = rRow?.isin || '';
        const actualNav = rRow?.nav || 0;
        const actualFlag = rRow?.transferredFlag || (qr.date >= CONFIG.TAX.EQUITY_RATE_CHANGE_DATE ? 'AE' : 'BE');

        const dataRow = sheet2.addRow([
          qr.date,
          actualFundName,
          actualIsin,
          qr.folioNumber,
          qr.units,
          actualNav,
          qr.amount,
          actualFlag
        ]);

        dataRow.getCell(5).numFmt = '#,##0.0000'; // Units
        dataRow.getCell(6).numFmt = '#,##0.0000'; // NAV
        dataRow.getCell(7).numFmt = '#,##0.00';   // Amount
      }

      sheet2.addRow([]);
    }

    if (!anyQuarterRendered) {
      sheet2.addRow(['No redemptions in this financial year.']);
    }

    const s2ColWidths = [14, 40, 16, 20, 14, 14, 18, 14];
    for (let i = 0; i < 8; i++) {
      sheet2.getColumn(i + 1).width = s2ColWidths[i] || 15;
    }

    // Stream out Excel
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="vriddhi-advance-tax-${pan}-FY${fy}.xlsx"`
    );
    await workbook.xlsx.write(res);
    res.end();

  } catch (err: any) {
    log('app', 'ERROR', 'TAX_ADVANCE_EXPORT', `Failed: ${err}`);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
