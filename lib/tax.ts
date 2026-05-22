import { CONFIG } from './config.ts';

export interface TaxLot {
  folioId: string;
  buyDate: string;            // YYYY-MM-DD
  buyNav: number;
  buyUnits: number;
  remainingUnits: number;     // decrements as sells consume this lot
  costPerUnit: number;        // grandfathered CoA if pre-2018, else buyNav
  isGrandfathered: boolean;
  fmvJan2018: number | null;  // null = NAV not in DB
}

export interface MatchedLot {
  buyDate: string;
  sellDate: string;
  units: number;                          // units consumed from this lot by this sell
  costPerUnit: number;
  saleNav: number;
  gain: number;                           // (saleNav - costPerUnit) × units
  holdingDays: number;                    // sellDate - buyDate in calendar days
  gainType: 'STCG' | 'LTCG' | 'DEBT_SLAB';
  acquiredFlag: 'BE' | 'AE';             // BE = bought on/before 2018-01-31, AE = after
  transferredFlag: 'BE' | 'AE';          // BE = sold before 2024-07-23, AE = on/after
  buyNav: number;
  fmvJan2018: number | null;
  taxRate: number | null;                 // null for DEBT_SLAB (slab rate unknown)
  estimatedTax: number | null;            // null for DEBT_SLAB
  grandfatheringApplied: boolean;
  fmvMissing: boolean;                    // true = pre-2018 lot but Jan-31-2018 NAV not available
}

export interface FolioCapitalGains {
  folioId: string;
  folioNumber: string;
  fundName: string;
  isin: string;
  matchedLots: MatchedLot[];
  totalSTCG: number;
  totalLTCG: number;
  totalDebtGain: number;
  estimatedSTCGTax: number;
  estimatedLTCGTax: number;               // populated by the route after PAN-level exemption applied — engine sets to 0
  hasGrandfatheringFlags: boolean;        // true if any matchedLot has fmvMissing=true
  warnings: string[];
}

export interface PanCapitalGainsSummary {
  pan: string;
  investorName: string;
  totalSTCG: number;
  totalLTCG: number;
  ltcgExemptionUsed: number;              // Math.min(totalLTCG, CONFIG.TAX.EQUITY_LTCG_EXEMPTION)
  ltcgTaxable: number;                    // Math.max(0, totalLTCG - CONFIG.TAX.EQUITY_LTCG_EXEMPTION)
  totalDebtGain: number;
  estimatedSTCGTax: number;
  estimatedLTCGTax: number;               // computed here after exemption
  folios: FolioCapitalGains[];
  hasGrandfatheringFlags: boolean;
}

/**
 * Computes FIFO capital gains for a single folio.
 */
export function computeCapitalGains(
  folioId: string,
  folioNumber: string,
  fundName: string,
  isin: string,
  fundCategory: string,
  fundAssetClass: string,
  transactions: Array<{
    date: string,
    transaction_type: string,
    units: number,
    amount: number,
    nav: number
  }>,
  navOnDate: (isin: string, date: string) => number | null,
  fyStart: string,
  fyEnd: string
): FolioCapitalGains {
  const warnings: string[] = [];
  const taxLots: TaxLot[] = [];
  
  // Sort all transactions by date asc
  const sortedTxns = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  // Build TaxLot array
  for (const txn of sortedTxns) {
    if (txn.transaction_type.toLowerCase() === 'buy' && txn.units > 0 && txn.amount > 0) {
      const buyDate = txn.date;
      const isGrandfathered = buyDate <= CONFIG.TAX.GRANDFATHERING_DATE;
      let fmvJan2018: number | null = null;
      
      if (isGrandfathered) {
        fmvJan2018 = navOnDate(isin, CONFIG.TAX.GRANDFATHERING_DATE);
      }
      
      taxLots.push({
        folioId,
        buyDate,
        buyNav: txn.nav,
        buyUnits: txn.units,
        remainingUnits: txn.units,
        costPerUnit: txn.nav, // Initial, might be updated during match for grandfathering
        isGrandfathered,
        fmvJan2018
      });
    }
  }

  const matchedLots: MatchedLot[] = [];
  
  // Debt fund detection
  const debtKeywords = [
    'debt', 'liquid', 'overnight', 'money market', 'gilt', 'credit risk', 
    'banking and psu', 'floater', 'dynamic bond', 'medium duration', 
    'short duration', 'low duration', 'ultra short', 'long duration', 
    'conservative hybrid'
  ];
  // Use stored asset_class if available (populated by NAV backfill).
  // Fall back to keyword matching on category if asset_class not yet set.
  const isDebtFund = fundAssetClass
    ? fundAssetClass.toLowerCase() === 'debt'
    : debtKeywords.some(key => fundCategory.toLowerCase().includes(key));

  // Process Sell transactions within FY
  for (const txn of sortedTxns) {
    if (txn.transaction_type.toLowerCase() === 'sell' && txn.units < 0) {
      const sellDate = txn.date;
      
      // Only process if within FY
      if (sellDate >= fyStart && sellDate <= fyEnd) {
        let unitsToSell = Math.abs(txn.units);
        const saleNav = txn.nav;

        // FIFO consumption
        for (const lot of taxLots) {
          if (unitsToSell <= 0) break;
          if (lot.remainingUnits <= 0) continue;

          const consumedFromLot = Math.min(unitsToSell, lot.remainingUnits);
          
          // Calculate holding days
          const diffTime = new Date(sellDate).getTime() - new Date(lot.buyDate).getTime();
          const holdingDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
          
          // Gain Type
          let gainType: 'STCG' | 'LTCG' | 'DEBT_SLAB';
          if (isDebtFund) {
            gainType = 'DEBT_SLAB';
          } else {
            gainType = holdingDays > CONFIG.TAX.LTCG_HOLDING_DAYS ? 'LTCG' : 'STCG';
          }

          // Flags
          const acquiredFlag = lot.buyDate <= CONFIG.TAX.GRANDFATHERING_DATE ? 'BE' : 'AE';
          const transferredFlag = sellDate < CONFIG.TAX.EQUITY_RATE_CHANGE_DATE ? 'BE' : 'AE';

          // Grandfathering Logic
          let costPerUnit = lot.buyNav;
          let grandfatheringApplied = false;
          let fmvMissing = false;

          if (gainType === 'LTCG' && lot.isGrandfathered) {
            if (lot.fmvJan2018 !== null) {
              // Formula: MAX(buyNav, MIN(fmvJan2018, saleNav))
              costPerUnit = Math.max(lot.buyNav, Math.min(lot.fmvJan2018, saleNav));
              grandfatheringApplied = true;
            } else {
              fmvMissing = true;
            }
          }

          const gain = (saleNav - costPerUnit) * consumedFromLot;
          
          // Tax Rate
          const sellDateObj   = new Date(sellDate);
          const rateChangeDate  = new Date(CONFIG.TAX.EQUITY_RATE_CHANGE_DATE);
          const ltcgTaxableFrom = new Date(CONFIG.TAX.EQUITY_LTCG_TAXABLE_FROM);

          let taxRate: number | null = null;

          if (gainType === 'STCG') {
            taxRate = sellDateObj >= rateChangeDate
              ? CONFIG.TAX.EQUITY_STCG_RATE_NEW    // 20%
              : CONFIG.TAX.EQUITY_STCG_RATE_OLD;   // 15%

          } else if (gainType === 'LTCG') {
            if (sellDateObj < ltcgTaxableFrom) {
              taxRate = 0;  // EXEMPT — Section 10(38), sell before Apr 1 2018
            } else {
              taxRate = sellDateObj >= rateChangeDate
                ? CONFIG.TAX.EQUITY_LTCG_RATE_NEW  // 12.5%
                : CONFIG.TAX.EQUITY_LTCG_RATE_OLD; // 10%
            }
          }
          // DEBT_SLAB: taxRate stays null (slab rate — unknown to the engine)

          let estimatedTax: number | null = null;
          if (taxRate !== null) {
            estimatedTax = gain > 0 ? gain * taxRate : 0;
            // taxRate = 0 (exempt lots): estimatedTax = 0. Correct.
          }

          matchedLots.push({
            buyDate: lot.buyDate,
            sellDate,
            units: consumedFromLot,
            costPerUnit,
            saleNav,
            gain,
            holdingDays,
            gainType,
            acquiredFlag,
            transferredFlag,
            buyNav: lot.buyNav,
            fmvJan2018: lot.fmvJan2018,
            taxRate,
            estimatedTax,
            grandfatheringApplied,
            fmvMissing
          });

          lot.remainingUnits -= consumedFromLot;
          unitsToSell -= consumedFromLot;
        }

        if (unitsToSell > 0.000001) { // Floating point tolerance
          warnings.push(`Over-redemption for ${fundName} on ${sellDate}: ${unitsToSell.toFixed(4)} units untracked.`);
        }
      } else if (sellDate < fyStart) {
        // Just consume the lots if sold before FY to keep FIFO accurate
        let unitsToSell = Math.abs(txn.units);
        for (const lot of taxLots) {
          if (unitsToSell <= 0) break;
          if (lot.remainingUnits <= 0) continue;
          const consumed = Math.min(unitsToSell, lot.remainingUnits);
          lot.remainingUnits -= consumed;
          unitsToSell -= consumed;
        }
      }
    }
  }

  // Aggregate totals
  let totalSTCG = 0;
  let totalLTCG = 0;
  let totalDebtGain = 0;
  let estimatedSTCGTax = 0;

  for (const lot of matchedLots) {
    if (lot.gainType === 'STCG') {
      totalSTCG += lot.gain;
      estimatedSTCGTax += lot.estimatedTax || 0;
    } else if (lot.gainType === 'LTCG') {
      totalLTCG += lot.gain;
    } else if (lot.gainType === 'DEBT_SLAB') {
      totalDebtGain += lot.gain;
    }
  }

  return {
    folioId,
    folioNumber,
    fundName,
    isin,
    matchedLots,
    totalSTCG,
    totalLTCG,
    totalDebtGain,
    estimatedSTCGTax,
    estimatedLTCGTax: 0,
    hasGrandfatheringFlags: matchedLots.some(l => l.fmvMissing),
    warnings
  };
}

/**
 * Aggregates results across all folios for a PAN.
 */
export function aggregatePanGains(
  pan: string,
  investorName: string,
  folioGains: FolioCapitalGains[]
): PanCapitalGainsSummary {
  let totalSTCG = 0;
  let totalLTCG = 0;
  let totalDebtGain = 0;
  let estimatedSTCGTax = 0;

  for (const f of folioGains) {
    totalSTCG += f.totalSTCG;
    totalLTCG += f.totalLTCG;
    totalDebtGain += f.totalDebtGain;
    estimatedSTCGTax += f.estimatedSTCGTax;
  }

  // Only accumulate TAXABLE LTCG (taxRate > 0 excludes pre-2018 exempt lots)
  let taxableLtcg_BE = 0;  // post-Apr-2018, pre-Jul-23-2024
  let taxableLtcg_AE = 0;  // Jul-23-2024 onwards

  for (const f of folioGains) {
    for (const lot of f.matchedLots) {
      if (lot.gainType === 'LTCG' && (lot.taxRate ?? 0) > 0) {
        if (lot.transferredFlag === 'BE') {
          taxableLtcg_BE += lot.gain;
        } else {
          taxableLtcg_AE += lot.gain;
        }
      }
    }
  }

  // STCG set-off (Sections 70-71 ITA):
  // Net STCG loss reduces LTCG before exemption is applied.
  // Apply to AE first (12.5% rate → more tax saved per rupee).
  // If totalSTCG >= 0, no set-off available.
  const stcgLoss = totalSTCG < 0 ? Math.abs(totalSTCG) : 0;

  const ae_after_setoff = Math.max(0, taxableLtcg_AE - stcgLoss);
  const remaining_loss  = Math.max(0, stcgLoss - Math.max(0, taxableLtcg_AE));
  const be_after_setoff = Math.max(0, taxableLtcg_BE - remaining_loss);

  // Two separate Schedule 112A pots — exemptions never combined
  const exemption_BE = be_after_setoff > 0
    ? Math.min(be_after_setoff, CONFIG.TAX.EQUITY_LTCG_EXEMPTION_OLD) : 0;
  const exemption_AE = ae_after_setoff > 0
    ? Math.min(ae_after_setoff, CONFIG.TAX.EQUITY_LTCG_EXEMPTION_NEW) : 0;

  const finalTaxable_BE = Math.max(0, be_after_setoff - exemption_BE);
  const finalTaxable_AE = Math.max(0, ae_after_setoff - exemption_AE);

  const estimatedLTCGTax =
    finalTaxable_BE * CONFIG.TAX.EQUITY_LTCG_RATE_OLD +
    finalTaxable_AE * CONFIG.TAX.EQUITY_LTCG_RATE_NEW;

  const ltcgExemptionUsed = exemption_BE + exemption_AE;
  const ltcgTaxable       = finalTaxable_BE + finalTaxable_AE;

  // When net STCG is a loss, all STCG is set off — no STCG tax due
  const finalEstimatedSTCGTax = totalSTCG >= 0 ? estimatedSTCGTax : 0;

  return {
    pan,
    investorName,
    totalSTCG,
    totalLTCG,
    ltcgExemptionUsed,
    ltcgTaxable,
    totalDebtGain,
    estimatedSTCGTax: finalEstimatedSTCGTax,
    estimatedLTCGTax,
    folios: folioGains,
    hasGrandfatheringFlags: folioGains.some(f => f.hasGrandfatheringFlags)
  };
}
