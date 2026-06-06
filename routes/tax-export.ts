import { Router } from 'express';
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
const MODULE = 'TAX_EXPORT';

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

/**
 * buildInstallmentsFromSummaries
 */
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
 * Internal computation helper
 */
async function computeCgData(pan: string, fy: string) {
  const { fyStart, fyEnd } = getFyBounds(fy);
  
  // Fetch investor name
  const investor = db.prepare('SELECT name FROM investors WHERE pan = ?').get(pan) as { name: string } | undefined;
  if (!investor) {
    throw new Error(`Investor with PAN ${pan} not found`);
  }
  
  // Fetch all folios for this PAN with richer query
  const folios = db.prepare(`
    SELECT f.id, f.folio_number, f.fund_id, fu.name as fund_name, fu.isin,
           fu.category, fu.asset_class, f.investor_name,
           fu.simple_name, fu.clean_name
    FROM folios f
    JOIN funds fu ON f.fund_id = fu.id
    WHERE f.pan = ?
  `).all(pan) as Array<{
    id: string;
    folio_number: string;
    fund_id: string;
    fund_name: string;
    isin: string;
    category: string;
    asset_class: string;
    investor_name: string;
    simple_name: string | null;
    clean_name: string | null;
  }>;
  
  if (folios.length === 0) {
    return {
      fy,
      fyStart,
      fyEnd,
      pan,
      investorName: investor.name,
      folioGains: [],
      summary: {
        totalSTCG: 0,
        totalLTCG: 0,
        estimatedSTCGTax: 0,
        estimatedLTCGTax: 0,
        ltcgTaxable: 0,
        folios: []
      } as unknown as PanCapitalGainsSummary,
      _ltcgBE: 0,
      _ltcgAE: 0,
      ltcgExemptionUsedBE: 0,
      ltcgExemptionUsedAE: 0,
      folios: [],
      txnMap: new Map<string, any[]>(),
      allTxnsByFundId: new Map<string, { isin: string; transactions: any[] }>(),
      folioMergerSourceMaps: new Map<string, Map<string, { isin: string; transactions: any[] }>>(),
      folioInvestorMap: new Map<string, string>()
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

  const folioMergerSourceMaps = new Map<string, Map<string, { isin: string; transactions: any[] }>>();
  const folioGains: FolioCapitalGains[] = [];
  const folioInvestorMap = new Map<string, string>();

  for (const f of folios) {
    folioInvestorMap.set(f.id, f.investor_name || investor.name);
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
      
      folioMergerSourceMaps.set(f.id, mergerSourceMap);
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
    
    if (result.matchedLots.length > 0) {
      folioGains.push(result);
    }
  }

  const summary = aggregatePanGains(pan, investor.name, folioGains);

  // Compute BE/AE LTCG split
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

  return {
    fy,
    fyStart,
    fyEnd,
    pan,
    investorName: investor.name,
    folioGains,
    summary,
    _ltcgBE,
    _ltcgAE,
    ltcgExemptionUsedBE,
    ltcgExemptionUsedAE,
    folios,
    txnMap,
    allTxnsByFundId,
    folioMergerSourceMaps,
    folioInvestorMap
  };
}

/**
 * computeAdvanceTaxQ
 */
async function computeAdvanceTaxQ(
  pan: string,
  folios: any[],
  txnMap: Map<string, any[]>,
  allTxnsByFundId: Map<string, { isin: string; transactions: any[] }>,
  folioMergerSourceMaps: Map<string, Map<string, { isin: string; transactions: any[] }>>,
  investorName: string,
  fyStart: string,
  fyEnd: string
): Promise<AdvanceTaxInstallment[]> {
  const startYear = parseInt(fyStart.slice(0, 4), 10);
  const cutoffDates = [
    `${startYear}-06-15`,
    `${startYear}-09-15`,
    `${startYear}-12-15`,
    fyEnd
  ];
  const dueDates = [
    `${startYear}-06-15`,
    `${startYear}-09-15`,
    `${startYear}-12-15`,
    `${startYear + 1}-03-15`
  ];

  const summaries: PanCapitalGainsSummary[] = [];

  for (const cutoffDate of cutoffDates) {
    const folioGains: FolioCapitalGains[] = [];
    for (const f of folios) {
      const txns = txnMap.get(f.id) || [];
      const txnsFiltered = txns.filter(t => t.date <= cutoffDate);
      
      const hasMergerIn = txnsFiltered.some(
        t => (t.transaction_subtype ?? '') === 'merger_in'
      );
      
      let mergerSourceMap: Map<string, { isin: string; transactions: any[] }> | undefined = undefined;
      if (hasMergerIn) {
        const sourceIds = [...new Set(
          txnsFiltered
            .filter(t => t.transaction_subtype === 'merger_in' && t.source_fund_id)
            .map(t => t.source_fund_id as string)
        )];
        mergerSourceMap = new Map();
        for (const id of sourceIds) {
          const srcData = allTxnsByFundId.get(id);
          if (srcData) {
            mergerSourceMap.set(id, {
              isin: srcData.isin,
              transactions: srcData.transactions.filter(t => t.date <= cutoffDate)
            });
          }
        }
      }

      const result = computeCapitalGains(
        f.id,
        f.folio_number,
        f.fund_name,
        f.isin,
        f.category,
        f.asset_class || '',
        txnsFiltered,
        navOnDate,
        fyStart,
        cutoffDate,
        mergerSourceMap
      );

      if (result.matchedLots.length > 0) {
        folioGains.push(result);
      }
    }

    const summary = aggregatePanGains(pan, investorName, folioGains);
    summaries.push(summary);
  }

  return buildInstallmentsFromSummaries(summaries, cutoffDates, dueDates, [[], [], [], []], new Date());
}

/**
 * GET /api/tax/capital-gains/excel
 */
router.get('/capital-gains/excel', async (req, res) => {
  const { pan, fy: fyParam } = req.query as { pan: string; fy?: string };
  if (!pan) {
    return res.status(400).json({ error: 'PAN is required' });
  }
  const fy = fyParam || getDefaultFy();

  try {
    log('app', 'INFO', MODULE, `CG Excel export: pan=${pan} fy=${fy}`);
    const cgData = await computeCgData(pan, fy);
    const installments = await computeAdvanceTaxQ(
      pan,
      cgData.folios,
      cgData.txnMap,
      cgData.allTxnsByFundId,
      cgData.folioMergerSourceMaps,
      cgData.investorName,
      cgData.fyStart,
      cgData.fyEnd
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Vriddhi';
    workbook.created = new Date();

    // ─────────────────────────────────────────────────────
    // SHEET 1: Summary
    // ─────────────────────────────────────────────────────
    const sheet1 = workbook.addWorksheet('Summary');
    sheet1.views = [{ showGridLines: true }];

    sheet1.addRow(['Report', 'Vriddhi Capital Gains Report']);
    sheet1.addRow(['PAN', pan]);
    sheet1.addRow(['Investor', cgData.investorName]);
    sheet1.addRow(['Financial Year', fy]);
    sheet1.addRow(['Generated On', new Date().toISOString().slice(0, 10)]);
    sheet1.addRow([]);

    for (let r = 1; r <= 5; r++) {
      sheet1.getRow(r).getCell(1).font = { bold: true };
    }

    // STCG
    const rSTCGHead = sheet1.addRow(['STCG Summary', '']);
    sheet1.mergeCells(`A${rSTCGHead.number}:B${rSTCGHead.number}`);
    rSTCGHead.getCell(1).font = { bold: true };
    rSTCGHead.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD6E4F0' }
    };

    const rSTCGNet = sheet1.addRow(['Net STCG (₹)', cgData.summary.totalSTCG]);
    rSTCGNet.getCell(2).numFmt = '#,##0.00';
    const rSTCGTax = sheet1.addRow(['Estimated STCG Tax (₹)', cgData.summary.estimatedSTCGTax]);
    rSTCGTax.getCell(2).numFmt = '#,##0.00';
    sheet1.addRow([]);

    // LTCG
    const rLTCGHead = sheet1.addRow(['LTCG Summary', '']);
    sheet1.mergeCells(`A${rLTCGHead.number}:B${rLTCGHead.number}`);
    rLTCGHead.getCell(1).font = { bold: true };
    rLTCGHead.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD6E4F0' }
    };

    const rLTCGGross = sheet1.addRow(['Gross LTCG (₹)', cgData.summary.totalLTCG]);
    rLTCGGross.getCell(2).numFmt = '#,##0.00';

    if (cgData.ltcgExemptionUsedBE > 0) {
      const rExBE = sheet1.addRow(['BE Pot Exemption Used (₹)', cgData.ltcgExemptionUsedBE]);
      rExBE.getCell(2).numFmt = '#,##0.00';
    }
    if (cgData.ltcgExemptionUsedAE > 0) {
      const rExAE = sheet1.addRow(['AE Pot Exemption Used (₹)', cgData.ltcgExemptionUsedAE]);
      rExAE.getCell(2).numFmt = '#,##0.00';
    }

    const rLTCGTaxable = sheet1.addRow(['Taxable LTCG (₹)', cgData.summary.ltcgTaxable]);
    rLTCGTaxable.getCell(2).numFmt = '#,##0.00';
    const rLTCGTax = sheet1.addRow(['Estimated LTCG Tax (₹)', cgData.summary.estimatedLTCGTax]);
    rLTCGTax.getCell(2).numFmt = '#,##0.00';
    sheet1.addRow([]);

    // Grand Total
    const rTotTax = sheet1.addRow([
      'Total Estimated Capital Gains Tax (₹)',
      cgData.summary.estimatedSTCGTax + cgData.summary.estimatedLTCGTax
    ]);
    rTotTax.font = { bold: true };
    rTotTax.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFF2CC' }
    };
    rTotTax.getCell(2).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFF2CC' }
    };
    rTotTax.getCell(2).numFmt = '#,##0.00';
    sheet1.addRow([]);

    // Advance Tax Quick Reference
    const rAdvHead = sheet1.addRow(['Advance Tax Quick Reference (Mode A)', '', '', '', '', '']);
    sheet1.mergeCells(`A${rAdvHead.number}:F${rAdvHead.number}`);
    rAdvHead.getCell(1).font = { bold: true };

    const refHeaders = [
      'Installment',
      'Due Date',
      'Cutoff Date',
      'Cumul. %',
      'Cumulative Obligation (₹)',
      'This Installment Due (₹)'
    ];
    const rRefHeadersRow = sheet1.addRow(refHeaders);
    rRefHeadersRow.font = { bold: true };
    for (let col = 1; col <= 6; col++) {
      rRefHeadersRow.getCell(col).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFEFEF' }
      };
    }

    for (const inst of installments) {
      const rInst = sheet1.addRow([
        `Installment ${inst.installmentNumber}`,
        inst.dueDate,
        inst.cutoffDate,
        inst.cumulativePercent,
        inst.cumulativeObligation,
        inst.dueAmount
      ]);
      rInst.getCell(4).numFmt = '0';
      rInst.getCell(5).numFmt = '#,##0.00';
      rInst.getCell(6).numFmt = '#,##0.00';
      if (inst.isCurrentInstallment) {
        rInst.font = { bold: true };
      }
    }

    const rRefNote = sheet1.addRow(['Note: For paid amounts and interest — use the Advance Tax tab in Vriddhi.']);
    rRefNote.getCell(1).font = { italic: true };
    sheet1.addRow([]);

    // Loss carry-forward
    if (cgData.summary.totalLTCG < 0 || cgData.summary.totalSTCG < 0) {
      const rLossHead = sheet1.addRow(['Loss Carry-Forward / Set-off Status', '']);
      sheet1.mergeCells(`A${rLossHead.number}:B${rLossHead.number}`);
      rLossHead.getCell(1).font = { bold: true };

      const startYearNum = parseInt(fy.split('-')[0], 10);
      const ayStart = startYearNum + 9;
      const ayEndShort = String(ayStart + 1).slice(-2);
      const ayStr = `AY ${ayStart}-${ayEndShort}`;

      if (cgData.summary.totalLTCG < 0) {
        const rLtcgLoss = sheet1.addRow([
          'LTCG Loss (₹)',
          Math.abs(cgData.summary.totalLTCG),
          `May offset future LTCG until ${ayStr} (8-year carry forward)`
        ]);
        rLtcgLoss.getCell(2).numFmt = '#,##0.00';
      }
      if (cgData.summary.totalSTCG < 0) {
        const rStcgLoss = sheet1.addRow([
          'STCG Loss (₹)',
          Math.abs(cgData.summary.totalSTCG),
          `May offset future STCG and LTCG until ${ayStr} (8-year carry forward)`
        ]);
        rStcgLoss.getCell(2).numFmt = '#,##0.00';
      }
      sheet1.addRow([]);
    }

    const rDataNote = sheet1.addRow(['Data computed from imported CAS transactions. Verify against your CAS statement before filing. NAV data from mfapi.in.']);
    rDataNote.getCell(1).font = { italic: true, color: { argb: 'FF888888' } };

    sheet1.getColumn(1).width = 38;
    sheet1.getColumn(2).width = 20;

    // Cache folio mappings for fast lookups
    const folioMap = new Map<string, typeof cgData.folios[0]>();
    for (const f of cgData.folios) {
      folioMap.set(f.id, f);
    }

    // ─────────────────────────────────────────────────────
    // SHEET 2: LTCG Lots
    // ─────────────────────────────────────────────────────
    const sheet2 = workbook.addWorksheet('LTCG Lots');
    sheet2.views = [{ showGridLines: true }];

    const ltcgHeaders = [
      'Fund Name', 'ISIN', 'Folio', 'Investor', 'Buy Date', 'Sell Date', 'Units',
      'Buy NAV', 'Effective Cost/Unit', 'FMV Jan 31 2018', 'Grandfathering',
      'Sale NAV', 'Sale Value (₹)', 'Cost Value (₹)', 'FMV Value (₹)',
      'Gain/Loss (₹)', 'Holding Days', 'Tax Rate (%)', 'Est. Tax (₹)'
    ];

    const rLtcgHeaders = sheet2.addRow(ltcgHeaders);
    rLtcgHeaders.font = { bold: true };
    for (let col = 1; col <= ltcgHeaders.length; col++) {
      rLtcgHeaders.getCell(col).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFEFEF' }
      };
    }

    const ltcgLots: any[] = [];
    for (const f of cgData.folioGains) {
      for (const lot of f.matchedLots) {
        if (lot.units < 0.00005) continue;
        if (lot.gainType === 'LTCG') {
          const folio = folioMap.get(f.folioId);
          const fundName = folio ? (folio.simple_name || folio.clean_name || folio.fund_name) : f.fundName;
          ltcgLots.push({
            ...lot,
            fundName,
            isin: folio?.isin || '',
            folioNumber: folio?.folio_number || '',
            investor: cgData.folioInvestorMap.get(f.folioId) || ''
          });
        }
      }
    }

    // Sort by fundName, then buyDate ascending
    ltcgLots.sort((a, b) => {
      const cmp = a.fundName.localeCompare(b.fundName);
      if (cmp !== 0) return cmp;
      return a.buyDate.localeCompare(b.buyDate);
    });

    const ltcgByFund = new Map<string, any[]>();
    for (const lot of ltcgLots) {
      if (!ltcgByFund.has(lot.fundName)) {
        ltcgByFund.set(lot.fundName, []);
      }
      ltcgByFund.get(lot.fundName)!.push(lot);
    }

    for (const [fundName, lots] of ltcgByFund) {
      let subTotalSaleValue = 0;
      let subTotalCostValue = 0;
      let subTotalFmvValue = 0;
      let subTotalGain = 0;
      let subTotalEstTax = 0;

      for (const lot of lots) {
        const saleValue = lot.saleNav * lot.units;
        const costValue = lot.costPerUnit * lot.units;
        const fmvValue = lot.fmvJan2018 ? lot.fmvJan2018 * lot.units : 0;
        
        subTotalSaleValue += saleValue;
        subTotalCostValue += costValue;
        subTotalFmvValue += fmvValue;
        subTotalGain += lot.gain;
        subTotalEstTax += (typeof lot.estimatedTax === 'number' ? lot.estimatedTax : 0);

        const r = sheet2.addRow([
          lot.fundName,
          lot.isin,
          lot.folioNumber,
          lot.investor,
          lot.buyDate,
          lot.sellDate,
          lot.units,
          lot.buyNav,
          lot.costPerUnit,
          lot.fmvJan2018 ?? '',
          lot.grandfatheringApplied ? 'Yes' : 'No',
          lot.saleNav,
          saleValue,
          costValue,
          lot.fmvJan2018 ? fmvValue : '',
          lot.gain,
          lot.holdingDays,
          lot.taxRate != null ? lot.taxRate * 100 : 'SLAB',
          lot.estimatedTax != null ? lot.estimatedTax : 'SLAB'
        ]);

        r.getCell(7).numFmt = '#,##0.0000';
        r.getCell(8).numFmt = '#,##0.0000';
        r.getCell(9).numFmt = '#,##0.0000';
        if (lot.fmvJan2018 !== null) r.getCell(10).numFmt = '#,##0.0000';
        r.getCell(12).numFmt = '#,##0.0000';
        r.getCell(13).numFmt = '#,##0.00';
        r.getCell(14).numFmt = '#,##0.00';
        if (lot.fmvJan2018 !== null) r.getCell(15).numFmt = '#,##0.00';
        r.getCell(16).numFmt = '#,##0.00';
        r.getCell(17).numFmt = '0';
        if (lot.taxRate != null) r.getCell(18).numFmt = '0.0';
        if (typeof lot.estimatedTax === 'number') r.getCell(19).numFmt = '#,##0.00';

        if (lot.grandfatheringApplied) {
          r.eachCell({ includeEmpty: true }, (cell) => {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE2EFDA' }
            };
          });
        }
      }

      const subTotalRow = sheet2.addRow([
        `Subtotal — ${fundName}`,
        null, null, null, null, null, null, null, null, null, null, null,
        subTotalSaleValue,
        subTotalCostValue,
        subTotalFmvValue > 0 ? subTotalFmvValue : '',
        subTotalGain,
        null, null,
        subTotalEstTax
      ]);
      subTotalRow.font = { bold: true };
      subTotalRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF2CC' }
        };
      });
      subTotalRow.getCell(13).numFmt = '#,##0.00';
      subTotalRow.getCell(14).numFmt = '#,##0.00';
      if (subTotalFmvValue > 0) subTotalRow.getCell(15).numFmt = '#,##0.00';
      subTotalRow.getCell(16).numFmt = '#,##0.00';
      subTotalRow.getCell(19).numFmt = '#,##0.00';
    }

    const ltcgGrandSale = ltcgLots.reduce((sum, l) => sum + (l.saleNav * l.units), 0);
    const ltcgGrandCost = ltcgLots.reduce((sum, l) => sum + (l.costPerUnit * l.units), 0);
    const ltcgGrandFmv = ltcgLots.reduce((sum, l) => sum + (l.fmvJan2018 ? l.fmvJan2018 * l.units : 0), 0);
    const ltcgGrandGain = ltcgLots.reduce((sum, l) => sum + l.gain, 0);
    const ltcgGrandTax = ltcgLots.reduce((sum, l) => sum + (typeof l.estimatedTax === 'number' ? l.estimatedTax : 0), 0);

    const ltcgGrandRow = sheet2.addRow([
      'GRAND TOTAL',
      null, null, null, null, null, null, null, null, null, null, null,
      ltcgGrandSale,
      ltcgGrandCost,
      ltcgGrandFmv > 0 ? ltcgGrandFmv : '',
      ltcgGrandGain,
      null, null,
      ltcgGrandTax
    ]);
    ltcgGrandRow.font = { bold: true };
    ltcgGrandRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFE699' }
      };
    });
    ltcgGrandRow.getCell(13).numFmt = '#,##0.00';
    ltcgGrandRow.getCell(14).numFmt = '#,##0.00';
    if (ltcgGrandFmv > 0) ltcgGrandRow.getCell(15).numFmt = '#,##0.00';
    ltcgGrandRow.getCell(16).numFmt = '#,##0.00';
    ltcgGrandRow.getCell(19).numFmt = '#,##0.00';

    const ltcgColWidths = [42, 16, 20, 20, 12, 12, 12, 14, 16, 14, 14, 12, 16, 16, 14, 16, 12, 10, 16];
    for (let i = 0; i < ltcgColWidths.length; i++) {
      sheet2.getColumn(i + 1).width = ltcgColWidths[i];
    }

    // ─────────────────────────────────────────────────────
    // SHEET 3: STCG Lots
    // ─────────────────────────────────────────────────────
    const sheet3 = workbook.addWorksheet('STCG Lots');
    sheet3.views = [{ showGridLines: true }];

    const stcgHeaders = [
      'Fund Name', 'ISIN', 'Folio', 'Investor', 'Buy Date', 'Sell Date', 'Units',
      'Effective Cost/Unit', 'Sale NAV', 'Sale Value (₹)', 'Cost Value (₹)',
      'Gain/Loss (₹)', 'Holding Days', 'Tax Rate (%)', 'Est. Tax (₹)'
    ];

    const rStcgHeaders = sheet3.addRow(stcgHeaders);
    rStcgHeaders.font = { bold: true };
    for (let col = 1; col <= stcgHeaders.length; col++) {
      rStcgHeaders.getCell(col).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFEFEF' }
      };
    }

    const stcgLots: any[] = [];
    for (const f of cgData.folioGains) {
      for (const lot of f.matchedLots) {
        if (lot.units < 0.00005) continue;
        if (lot.gainType === 'STCG') {
          const folio = folioMap.get(f.folioId);
          const fundName = folio ? (folio.simple_name || folio.clean_name || folio.fund_name) : f.fundName;
          stcgLots.push({
            ...lot,
            fundName,
            isin: folio?.isin || '',
            folioNumber: folio?.folio_number || '',
            investor: cgData.folioInvestorMap.get(f.folioId) || ''
          });
        }
      }
    }

    stcgLots.sort((a, b) => {
      const cmp = a.fundName.localeCompare(b.fundName);
      if (cmp !== 0) return cmp;
      return a.buyDate.localeCompare(b.buyDate);
    });

    const stcgByFund = new Map<string, any[]>();
    for (const lot of stcgLots) {
      if (!stcgByFund.has(lot.fundName)) {
        stcgByFund.set(lot.fundName, []);
      }
      stcgByFund.get(lot.fundName)!.push(lot);
    }

    for (const [fundName, lots] of stcgByFund) {
      let subTotalSaleValue = 0;
      let subTotalCostValue = 0;
      let subTotalGain = 0;
      let subTotalEstTax = 0;

      for (const lot of lots) {
        const saleValue = lot.saleNav * lot.units;
        const costValue = lot.costPerUnit * lot.units;

        subTotalSaleValue += saleValue;
        subTotalCostValue += costValue;
        subTotalGain += lot.gain;
        subTotalEstTax += (typeof lot.estimatedTax === 'number' ? lot.estimatedTax : 0);

        const r = sheet3.addRow([
          lot.fundName,
          lot.isin,
          lot.folioNumber,
          lot.investor,
          lot.buyDate,
          lot.sellDate,
          lot.units,
          lot.costPerUnit,
          lot.saleNav,
          saleValue,
          costValue,
          lot.gain,
          lot.holdingDays,
          lot.taxRate != null ? lot.taxRate * 100 : 'SLAB',
          lot.estimatedTax != null ? lot.estimatedTax : 'SLAB'
        ]);

        r.getCell(7).numFmt = '#,##0.0000';
        r.getCell(8).numFmt = '#,##0.0000';
        r.getCell(9).numFmt = '#,##0.0000';
        r.getCell(10).numFmt = '#,##0.00';
        r.getCell(11).numFmt = '#,##0.00';
        r.getCell(12).numFmt = '#,##0.00';
        r.getCell(13).numFmt = '0';
        if (lot.taxRate != null) r.getCell(14).numFmt = '0.0';
        if (typeof lot.estimatedTax === 'number') r.getCell(15).numFmt = '#,##0.00';
      }

      const subTotalRow = sheet3.addRow([
        `Subtotal — ${fundName}`,
        null, null, null, null, null, null, null, null,
        subTotalSaleValue,
        subTotalCostValue,
        subTotalGain,
        null, null,
        subTotalEstTax
      ]);
      subTotalRow.font = { bold: true };
      subTotalRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF2CC' }
        };
      });
      subTotalRow.getCell(10).numFmt = '#,##0.00';
      subTotalRow.getCell(11).numFmt = '#,##0.00';
      subTotalRow.getCell(12).numFmt = '#,##0.00';
      subTotalRow.getCell(15).numFmt = '#,##0.00';
    }

    const stcgGrandSale = stcgLots.reduce((sum, l) => sum + (l.saleNav * l.units), 0);
    const stcgGrandCost = stcgLots.reduce((sum, l) => sum + (l.costPerUnit * l.units), 0);
    const stcgGrandGain = stcgLots.reduce((sum, l) => sum + l.gain, 0);
    const stcgGrandTax = stcgLots.reduce((sum, l) => sum + (typeof l.estimatedTax === 'number' ? l.estimatedTax : 0), 0);

    const stcgGrandRow = sheet3.addRow([
      'GRAND TOTAL',
      null, null, null, null, null, null, null, null,
      stcgGrandSale,
      stcgGrandCost,
      stcgGrandGain,
      null, null,
      stcgGrandTax
    ]);
    stcgGrandRow.font = { bold: true };
    stcgGrandRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFE699' }
      };
    });
    stcgGrandRow.getCell(10).numFmt = '#,##0.00';
    stcgGrandRow.getCell(11).numFmt = '#,##0.00';
    stcgGrandRow.getCell(12).numFmt = '#,##0.00';
    stcgGrandRow.getCell(15).numFmt = '#,##0.00';

    const stcgColWidths = [42, 16, 20, 20, 12, 12, 12, 16, 12, 16, 16, 16, 12, 10, 16];
    for (let i = 0; i < stcgColWidths.length; i++) {
      sheet3.getColumn(i + 1).width = stcgColWidths[i];
    }

    // ─────────────────────────────────────────────────────
    // SHEET 4: Advance Tax
    // ─────────────────────────────────────────────────────
    const sheet4 = workbook.addWorksheet('Advance Tax');
    sheet4.views = [{ showGridLines: true }];

    sheet4.addRow(['PAN', pan]);
    sheet4.addRow(['Investor', cgData.investorName]);
    sheet4.addRow(['Financial Year', fy]);
    sheet4.addRow(['Generated On', new Date().toISOString().slice(0, 10)]);
    sheet4.addRow([]);

    for (let r = 1; r <= 4; r++) {
      sheet4.getRow(r).getCell(1).font = { bold: true };
    }

    const rAdvNote = sheet4.addRow(['Read-only snapshot. For paid amounts, shortfall, and 234C interest — use the Advance Tax tab in Vriddhi.']);
    sheet4.mergeCells(`A${rAdvNote.number}:I${rAdvNote.number}`);
    rAdvNote.getCell(1).font = { italic: true };
    sheet4.addRow([]);

    const advHeaders = [
      'Installment', 'Due Date', 'Cutoff Date', 'Cumulative %', 'Q STCG (₹)',
      'Q LTCG (₹)', 'Cumulative Tax (₹)', 'Cumulative Obligation (₹)',
      'This Installment Due (₹)'
    ];

    const rAdvHeaders = sheet4.addRow(advHeaders);
    rAdvHeaders.font = { bold: true };
    for (let col = 1; col <= advHeaders.length; col++) {
      rAdvHeaders.getCell(col).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEFEFEF' }
      };
    }

    for (const inst of installments) {
      const r = sheet4.addRow([
        `Installment ${inst.installmentNumber}`,
        inst.dueDate,
        inst.cutoffDate,
        inst.cumulativePercent,
        inst.quarterSTCG,
        inst.quarterLTCG,
        inst.cumulativeTaxUpToCutoff,
        inst.cumulativeObligation,
        inst.dueAmount
      ]);

      r.getCell(4).numFmt = '0';
      r.getCell(5).numFmt = '#,##0.00';
      r.getCell(6).numFmt = '#,##0.00';
      r.getCell(7).numFmt = '#,##0.00';
      r.getCell(8).numFmt = '#,##0.00';
      r.getCell(9).numFmt = '#,##0.00';

      if (inst.isCurrentInstallment) {
        r.font = { bold: true };
      }
    }

    const advColWidths = [16, 14, 14, 14, 18, 18, 22, 24, 22];
    for (let i = 0; i < advColWidths.length; i++) {
      sheet4.getColumn(i + 1).width = advColWidths[i];
    }

    // ─────────────────────────────────────────────────────
    // Stream response
    // ─────────────────────────────────────────────────────
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="vriddhi-capital-gains-${pan}-FY${fy}.xlsx"`);
    
    await workbook.xlsx.write(res);
    res.end();

  } catch (err: any) {
    log('app', 'ERROR', MODULE, `CG Excel export failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * generateItrHtml() — pure function to construct print-friendly HTML report
 */
function generateItrHtml(data: {
  pan: string;
  fy: string;
  ay: string;
  cfExpiryAY: string;
  investorName: string;
  totalSTCG: number;
  totalLTCG: number;
  estimatedSTCGTax: number;
  estimatedLTCGTax: number;
  ltcgExemptionUsedBE: number;
  ltcgExemptionUsedAE: number;
  ltcgTaxable: number;
  totalTax: number;
  ltcgLotCount: number;
  ltcgAggregateCost: number;
  ltcgAggregateSale: number;
  stcgAggregateCost: number;
  stcgAggregateSale: number;
  installments: AdvanceTaxInstallment[];
  today: string;
}): string {
  function formatINR(val: number): string {
    const absolute = Math.abs(val);
    const formatted = absolute.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return val < 0 ? `-${formatted}` : formatted;
  }

  function renderAmount(val: number): string {
    const isNeg = val < 0;
    const formatted = formatINR(val);
    if (isNeg) {
      return `<span class="negative">${formatted}</span>`;
    }
    return formatted;
  }

  const totSTCG = data.installments.reduce((sum, inst) => sum + inst.quarterSTCG, 0);
  const totLTCG = data.installments.reduce((sum, inst) => sum + inst.quarterLTCG, 0);
  const totTaxContribution = data.installments.reduce((sum, inst) => sum + inst.quarterTaxContribution, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Vriddhi — ITR Filing Summary</title>
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      max-width: 860px;
      margin: 30px auto;
      padding: 0 20px;
      color: #333;
      line-height: 1.5;
    }
    .section-heading {
      font-size: 14px;
      font-weight: bold;
      background-color: #E8F4FD;
      padding: 6px 10px;
      border-left: 4px solid #1565C0;
      margin-top: 24px;
      margin-bottom: 12px;
      color: #1565C0;
    }
    .grid-2col {
      display: grid;
      grid-template-columns: 280px auto;
      gap: 8px 16px;
      margin-bottom: 16px;
    }
    .grid-label {
      font-weight: bold;
      color: #555;
    }
    .grid-value {
      color: #111;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    th {
      background-color: #EFEFEF;
      font-weight: bold;
      padding: 8px;
      text-align: left;
      border: 1px solid #DDD;
    }
    td {
      padding: 8px;
      border: 1px solid #DDD;
    }
    .text-right {
      text-align: right;
    }
    .negative {
      color: #C62828;
    }
    .info-box {
      background-color: #E8F4FD;
      border: 1px solid #B3E5FC;
      padding: 10px;
      margin: 12px 0;
      border-radius: 4px;
      font-size: 13.5px;
    }
    .warn-box {
      background-color: #FFF3E0;
      border: 1px solid #FFE0B2;
      padding: 10px;
      margin: 12px 0;
      border-radius: 4px;
      font-size: 13.5px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 12px;
      border-top: 1px solid #DDD;
      font-size: 11px;
      color: #777;
    }
    @media print {
      body {
        margin: 0;
      }
      .no-print {
        display: none !important;
      }
    }
  </style>
</head>
<body>

  <div class="no-print" style="margin-bottom: 20px; text-align: right;">
    <button onclick="window.print()" style="background-color: #1565C0; color: white; border: none; padding: 10px 20px; font-weight: bold; border-radius: 4px; cursor: pointer; font-size: 14px; box-shadow: 0 2px 4px rgba(0,0,0,0.15);">
      🖨️ Print ITR Summary
    </button>
  </div>

  <div style="background-color: #1565C0; color: white; padding: 20px; margin-bottom: 20px; border-radius: 4px;">
    <h1 style="margin: 0; font-size: 24px; font-weight: bold;">Vriddhi — ITR Filing Summary</h1>
    <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">FY ${data.fy} | AY ${data.ay} | Generated ${data.today}</p>
  </div>

  <div class="info-box" style="font-style: italic;">
    ITR-2 for salaried individuals with capital gains. 
    ITR-3 if you have business income. Schedule CG is identical in both.
  </div>

  <div class="section-heading">Your Details</div>
  <div class="grid-2col">
    <div class="grid-label">PAN</div>
    <div class="grid-value" style="font-family: monospace;">${data.pan}</div>
    <div class="grid-label">Investor Name</div>
    <div class="grid-value">${data.investorName}</div>
    <div class="grid-label">Financial Year (FY)</div>
    <div class="grid-value">${data.fy}</div>
    <div class="grid-label">Assessment Year (AY)</div>
    <div class="grid-value">${data.ay}</div>
  </div>

  <div class="section-heading">Short-Term Capital Gains — Section 111A</div>
  <div class="grid-2col">
    <div class="grid-label">Total Sale Consideration</div>
    <div class="grid-value">₹${formatINR(data.stcgAggregateSale)}</div>
    <div class="grid-label">Total Cost of Acquisition</div>
    <div class="grid-value">₹${formatINR(data.stcgAggregateCost)}</div>
    <div class="grid-label">Net STCG</div>
    <div class="grid-value" style="font-weight: bold;">₹${renderAmount(data.totalSTCG)}${data.totalSTCG < 0 ? ' <span class="negative">(loss)</span>' : ''}</div>
    <div class="grid-label">Estimated Tax (20%)</div>
    <div class="grid-value">₹${formatINR(data.estimatedSTCGTax)}</div>
  </div>

  <div class="info-box">
    In Schedule CG: select 'From sale of units of equity-oriented MF where STT 
    is paid (Section 111A)'. Enter: Sale Consideration = ₹${formatINR(data.stcgAggregateSale)}, Cost = ₹${formatINR(data.stcgAggregateCost)}. 
    The portal computes the gain. No scrip-wise entry needed for STCG.
  </div>

  ${data.totalSTCG < 0 ? `
  <div class="warn-box">
    This is a net STCG loss of ₹${formatINR(Math.abs(data.totalSTCG))}. Report it in Schedule CG — it will be 
    carried forward automatically and can offset STCG and LTCG for up to 
    8 years until AY ${data.cfExpiryAY}.
  </div>
  ` : ''}

  <div class="section-heading">Long-Term Capital Gains — Section 112A (Schedule 112A)</div>
  <div class="grid-2col">
    <div class="grid-label">Gross LTCG</div>
    <div class="grid-value" style="font-weight: bold;">₹${renderAmount(data.totalLTCG)}${data.totalLTCG < 0 ? ' <span class="negative">(loss)</span>' : ''}</div>
    ${data.ltcgExemptionUsedBE > 0 ? `
    <div class="grid-label">BE Pot Exemption Used (₹1,00,000 limit)</div>
    <div class="grid-value">₹${formatINR(data.ltcgExemptionUsedBE)}</div>
    ` : ''}
    ${data.ltcgExemptionUsedAE > 0 ? `
    <div class="grid-label">AE Pot Exemption Used (₹1,25,000 limit)</div>
    <div class="grid-value">₹${formatINR(data.ltcgExemptionUsedAE)}</div>
    ` : ''}
    <div class="grid-label">Taxable LTCG</div>
    <div class="grid-value" style="font-weight: bold;">₹${formatINR(data.ltcgTaxable)}</div>
    <div class="grid-label">Estimated Tax (12.5%)</div>
    <div class="grid-value">₹${formatINR(data.estimatedLTCGTax)}</div>
  </div>

  <div class="info-box">
    Schedule 112A requires lot-by-lot entry. Import the ClearTax CSV from 
    Vriddhi into ClearTax or Quicko, OR enter manually using the LTCG Lots 
    sheet from the Capital Gains Excel export.<br/>
    <strong>Summary figures:</strong> ${data.ltcgLotCount} lots | Aggregate cost ₹${formatINR(data.ltcgAggregateCost)} | 
    Aggregate sale ₹${formatINR(data.ltcgAggregateSale)} | Net LTCG ₹${renderAmount(data.totalLTCG)}
  </div>

  ${data.totalLTCG < 0 ? `
  <div class="warn-box">
    This is a net LTCG loss of ₹${formatINR(Math.abs(data.totalLTCG))}. Report it in Schedule CFL under 
    'Long-term Capital Loss from listed equity shares/equity MF'. Can offset 
    future LTCG until AY ${data.cfExpiryAY}.
  </div>
  ` : ''}

  <div class="section-heading">Total Estimated Capital Gains Tax</div>
  <div style="font-weight: bold; font-size: 15px; margin: 15px 0;">
    Total Estimated Capital Gains Tax: ₹${formatINR(data.totalTax)}
  </div>
  <p style="font-size: 12px; color: #555;">
    This is an estimate. The IT portal computes the final liability 
    based on your total income, deductions, and tax regime.
  </p>

  <div class="section-heading">Quarterly Breakup — Table F in Schedule CG</div>
  <div class="warn-box">
    This quarterly breakup is mandatory in Schedule CG Table F. 
    Missing it causes validation errors on submission.
  </div>

  <table>
    <thead>
      <tr>
        <th>Quarter</th>
        <th>Period</th>
        <th class="text-right">STCG (₹)</th>
        <th class="text-right">LTCG (₹)</th>
        <th class="text-right">Combined Tax (₹)</th>
      </tr>
    </thead>
    <tbody>
      ${data.installments.map((inst, i) => {
        const periods = [
          'Apr 1 – Jun 15',
          'Jun 16 – Sep 15',
          'Sep 16 – Dec 15',
          'Dec 16 – Mar 31'
        ];
        return `
        <tr>
          <td>Q${inst.installmentNumber}</td>
          <td>${periods[i]}</td>
          <td class="text-right">${renderAmount(inst.quarterSTCG)}</td>
          <td class="text-right">${renderAmount(inst.quarterLTCG)}</td>
          <td class="text-right">${formatINR(inst.quarterTaxContribution)}</td>
        </tr>
        `;
      }).join('')}
      <tr style="font-weight: bold; background-color: #F5F5F5;">
        <td colspan="2">Total</td>
        <td class="text-right">${renderAmount(totSTCG)}</td>
        <td class="text-right">${renderAmount(totLTCG)}</td>
        <td class="text-right">${formatINR(totTaxContribution)}</td>
      </tr>
    </tbody>
  </table>

  <div class="section-heading">Advance Tax Reference</div>
  <table>
    <thead>
      <tr>
        <th>Installment</th>
        <th>Due Date</th>
        <th class="text-right">Cumul. %</th>
        <th class="text-right">Cumulative Obligation (₹)</th>
        <th class="text-right">This Installment Due (₹)</th>
      </tr>
    </thead>
    <tbody>
      ${data.installments.map(inst => `
      <tr ${inst.isCurrentInstallment ? 'style="font-weight: bold; background-color: #E8F4FD;"' : ''}>
        <td>Installment ${inst.installmentNumber}</td>
        <td>${inst.dueDate}</td>
        <td class="text-right">${inst.cumulativePercent}%</td>
        <td class="text-right">₹${formatINR(inst.cumulativeObligation)}</td>
        <td class="text-right">₹${formatINR(inst.dueAmount)}</td>
      </tr>
      `).join('')}
    </tbody>
  </table>
  <p style="font-size: 12px; font-style: italic; color: #555;">
    For paid amounts, shortfall, and 234C interest details — 
    use the Advance Tax tab in Vriddhi.
  </p>

  <div class="footer">
    Generated by Vriddhi on ${data.today}. Data computed from imported CAS 
    transactions. Verify against your CAS statement and AIS/TIS before filing. 
    This document is for reference only and does not constitute tax advice.
  </div>

</body>
</html>`;
}

/**
 * GET /api/tax/capital-gains/itr-summary
 */
router.get('/capital-gains/itr-summary', async (req, res) => {
  const { pan, fy: fyParam } = req.query as { pan: string, fy?: string };
  if (!pan) return res.status(400).json({ error: 'PAN is required' });
  const fy = fyParam || getDefaultFy();

  try {
    log('app', 'INFO', MODULE, `ITR Summary: pan=${pan} fy=${fy}`);
    const cgData = await computeCgData(pan, fy);
    const installments = await computeAdvanceTaxQ(
      pan,
      cgData.folios,
      cgData.txnMap,
      cgData.allTxnsByFundId,
      cgData.folioMergerSourceMaps,
      cgData.investorName, // signature uses investorName
      cgData.fyStart,
      cgData.fyEnd
    );

    // Derive AY (Assessment Year) from fy
    // fy='2024-25' → AY='2025-26'
    const [fyStartStr] = fy.split('-');
    const fyStartYear = parseInt(fyStartStr);
    const ay = `${fyStartYear + 1}-${String(fyStartYear + 2).slice(-2)}`;

    // Carry-forward expiry: 8 years from AY
    const cfExpiryAY = `${fyStartYear + 9}-${String(fyStartYear + 10).slice(-2)}`;

    // LTCG lot count and aggregate figures (for Schedule 112A reference)
    let ltcgLotCount = 0;
    let ltcgAggregateCost = 0;
    let ltcgAggregateSale = 0;
    for (const f of cgData.folioGains) {
      for (const lot of f.matchedLots) {
        if (lot.units < 0.00005 || lot.gainType !== 'LTCG') continue;
        ltcgLotCount++;
        ltcgAggregateCost += lot.costPerUnit * lot.units;
        ltcgAggregateSale += lot.saleNav * lot.units;
      }
    }

    // STCG aggregate figures (for Schedule CG Section 111A)
    let stcgAggregateCost = 0;
    let stcgAggregateSale = 0;
    for (const f of cgData.folioGains) {
      for (const lot of f.matchedLots) {
        if (lot.units < 0.00005 || lot.gainType !== 'STCG') continue;
        stcgAggregateCost += lot.costPerUnit * lot.units;
        stcgAggregateSale += lot.saleNav * lot.units;
      }
    }

    const totalTax = cgData.summary.estimatedSTCGTax + 
                     cgData.summary.estimatedLTCGTax;

    const html = generateItrHtml({
      pan, fy, ay, cfExpiryAY,
      investorName: cgData.investorName,
      totalSTCG: cgData.summary.totalSTCG,
      totalLTCG: cgData.summary.totalLTCG,
      estimatedSTCGTax: cgData.summary.estimatedSTCGTax,
      estimatedLTCGTax: cgData.summary.estimatedLTCGTax,
      ltcgExemptionUsedBE: cgData.ltcgExemptionUsedBE,
      ltcgExemptionUsedAE: cgData.ltcgExemptionUsedAE,
      ltcgTaxable: cgData.summary.ltcgTaxable,
      totalTax,
      ltcgLotCount, ltcgAggregateCost, ltcgAggregateSale,
      stcgAggregateCost, stcgAggregateSale,
      installments,
      today: new Date().toISOString().slice(0, 10)
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="vriddhi-itr-summary-${pan}-FY${fy}.html"`);
    res.send(html);
  } catch (err: any) {
    log('app', 'ERROR', MODULE, `ITR Summary failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
