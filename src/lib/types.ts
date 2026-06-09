export interface Fund {
  id: string;
  name: string;
  isin: string;
  scheme_code: string;
  amfi_code: string;
  category: string;
}

export interface Folio {
  id: string;
  folio_number: string;
  fund_id: string;
  fund_name: string;
  clean_name?: string;
  simple_name?: string;
  category: string;
  currentUnits: number;
  investedAmount: number;
  grossInvested: number;
  totalRedeemed: number;
  currentValue: number;
  nav: number;
  navDate: string | null;
  xirr: number | null;
}

export interface Portfolio {
  id: string;
  name: string;
  description: string;
  color: string;
  folios: Folio[];
  xirr: number | null;
  currentValue: number;
  investedAmount: number;
}

export interface Transaction {
  id: string;
  folio_id: string;
  folio_number: string;
  fund_name: string;
  clean_name?: string;
  simple_name?: string;
  date: string;
  transaction_type: 'buy' | 'sell' | 'dividend';
  amount: number;
  units: number;
  nav: number;
  balance_units: number;
}

export interface Summary {
  totalInvested: number;
  currentValue: number;
  gain: number;
  xirr: number | null;
  yearlyInvested: number;
}

export interface TagTheme {
  id: string;
  name: string;
  sort_order: number;
  tags: string[];
}

export interface FolioTag {
  folio_id: string;
  tag: string;
  theme_id: string | null;
}

export interface FolioTagDetail {
  tag: string;
  theme_id: string | null;
  theme_name: string | null;
}

export interface RelativePerformanceFolio {
  id: string;
  folio_number: string;
  fund_name: string;
  invested: number;
  currentValue: number;
}

export interface RelativePerformanceTimePoint {
  date: string;
  portfolioValue: number;
  benchmarkValue: number;
  investedValue: number;
}

export interface RelativePerformanceResult {
  tag: string;
  theme: string;
  benchmarkName: string;
  folioCount: number;
  fundCount: number;
  portfolioXirr: number | null;
  benchmarkXirr: number | null;
  alpha: number | null;
  investedAmount: number;
  currentValue: number;
  unrealisedPnl: number;
  xirrWarning: boolean;
  timeSeries: RelativePerformanceTimePoint[];
  folios: RelativePerformanceFolio[];
}

export interface NiftyTRIEntry {
  symbol: string;
  name: string;
  category: string;
  description: string;
}

export interface UserBenchmark {
  id: string;
  symbol: string;
  name: string;
  source: string;
  category: string;
  color: string;
  is_active: number;        // SQLite stores as 0/1
  benchmark_type: string;   // 'yahoo' | 'nifty_tri' | 'mf_nav'
  amfi_code: string | null;
  data_count: number;       // count from the data-summary query
}

export interface InvestmentTrendPoint {
  year: string;
  netInvested: number;
  yoyGrowth: number | null;
  rollingAvgGrowth: number | null;
  isPartialYear: boolean;
}

export interface TransactionFilters {
  dateFrom?: string;
  dateTo?: string;
  type?: 'buy' | 'sell';
  fundId?: string;
  folio?: string;
  amountMin?: number;
  amountMax?: number;
}

export interface FolioXirr {
  folioId: string;
  folioNumber: string;
  pan: string;
  investorName?: string;
  amfiCode?: string;
  fundId: string;
  fundName: string;
  clean_name: string;
  simple_name: string;
  fundHouse: string;
  schemeSubCat: string;
  assetClass: string;
  isin: string | null;
  category: string | null;
  plan: string | null;
  fundOption: string | null;
  units: number;
  nav: number | null;
  navDate: string | null;
  currentValue: number;
  investedAmount: number;
  gainAmount: number;
  gainPercent: number | null;
  xirr: number | null;
  xirrWarning: boolean;
  tags: string[];
  isActive: boolean;
}

export interface FundGroupXirr {
  fundId: string;
  fundName: string;
  clean_name: string;
  simple_name: string;
  fundHouse: string;
  isin: string;
  category: string;
  plan: string;
  fundOption: string;
  assetClass: string;
  schemeSubCat: string;
  totalUnits: number;
  totalInvested: number;
  totalCurrentValue: number;
  gainAmount: number;
  gainPercent: number;
  groupXirr: number | null;
  groupXirrWarning: boolean;
  folioCount: number;
  folios: FolioXirr[];
}

export interface FolioBenchmarkXirrResult {
  folioId: string;
  portfolioXirr: number | null;
  portfolioXirrWarning: boolean;
  benchmarkXirr: number | null;
  benchmarkXirrWarning: boolean;
  alpha: number | null;   // portfolioXirr - benchmarkXirr; null if either is null
}

export interface GroupBenchmarkXirrResult {
  fundId: string;
  portfolioXirr: number | null;
  portfolioXirrWarning: boolean;
  benchmarkXirr: number | null;
  benchmarkXirrWarning: boolean;
  alpha: number | null;
}

export interface OverallBenchmarkXirrResult {
  portfolioXirr: number | null;
  portfolioXirrWarning: boolean;
  benchmarkXirr: number | null;
  benchmarkXirrWarning: boolean;
  alpha: number | null;
}

export interface BenchmarkXirrResponse {
  folioResults: FolioBenchmarkXirrResult[];
  groupResults: GroupBenchmarkXirrResult[];
  overallResult: OverallBenchmarkXirrResult;
}

export interface DashboardStats {
  totalFolios: number;
  activeFolios: number;
  activeFunds: number;
  directCount: number;
  regularCount: number;
  bestReturnFund: {
    name: string;
    clean_name?: string;
    simple_name?: string;
    gainPercent: number;
  } | null;
  highestLossFund: {
    name: string;
    clean_name?: string;
    simple_name?: string;
    absoluteLoss: number;
  } | null;
  avgHoldingAgeYears: number;
}

export interface MatchedLot {
  buyDate: string;
  sellDate: string;
  units: number;
  costPerUnit: number;
  saleNav: number;
  buyNav: number;
  fmvJan2018: number | null;
  gain: number;
  holdingDays: number;
  gainType: 'STCG' | 'LTCG' | 'DEBT_SLAB';
  acquiredFlag: 'BE' | 'AE';
  transferredFlag: 'BE' | 'AE';
  taxRate: number | null;
  estimatedTax: number | null;
  grandfatheringApplied: boolean;
  fmvMissing: boolean;
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
  estimatedLTCGTax: number;
  hasGrandfatheringFlags: boolean;
  warnings: string[];
}

export interface PanCapitalGainsSummary {
  fy: string;
  pan: string;
  investorName: string;
  totalSTCG: number;
  totalLTCG: number;
  ltcgExemptionUsed: number;
  ltcgTaxable: number;
  totalDebtGain: number;
  estimatedSTCGTax: number;
  estimatedLTCGTax: number;
  folios: FolioCapitalGains[];
  hasGrandfatheringFlags: boolean;
  ltcgBE: number;
  ltcgAE: number;
  ltcgExemptionUsedBE: number;
  ltcgExemptionUsedAE: number;
  lossCarryForwardNote?: string | null;
}

export interface UnrealizedGainsSummary extends PanCapitalGainsSummary {
  asOfDate: string;
}

export interface HarvestingOpportunity {
  folioId: string;
  folioNumber: string;
  fundName: string;
  unrealisedLTCG?: number;
  unrealisedSTCGLoss?: number;
  estimatedTaxSaving?: number;
  suggestedAction: string;
}

export interface HarvestingReport {
  fy: string;
  pan: string;
  remainingLtcgExemption: number;
  realisedLTCG: number;
  gainHarvesting: HarvestingOpportunity[];
  lossHarvesting: HarvestingOpportunity[];
}

export interface SimulationResult {
  folioId: string;
  folioNumber: string;
  fundName: string;
  isin: string;
  simulatedUnits: number;
  simulatedAmount: number;
  latestNav: number;
  matchedLots: MatchedLot[];
  totalSTCG: number;
  totalLTCG: number;
  totalDebtGain: number;
  estimatedSTCGTax: number;
  estimatedLTCGTax: number;
  warnings: string[];
}

export interface TaxPan {
  pan: string;
  name: string;
}

export interface QuarterRedemption {
  date: string;
  fundName: string;
  folioNumber: string;
  units: number;
  amount: number;
}

export interface AdvanceTaxInstallment {
  installmentNumber: number;
  dueDate: string;
  cutoffDate: string;
  cumulativePercent: number;
  cumulativeTaxUpToCutoff: number;
  cumulativeObligation: number;
  dueAmount: number;
  quarterSTCG: number;
  quarterLTCG: number;
  quarterTaxContribution: number;
  quarterRedemptions: QuarterRedemption[];
  isPastDue: boolean;
  isCurrentInstallment: boolean;
}

export interface AdvanceTaxEstimate {
  currentFy: string;
  fyType: 'current' | 'previous' | 'historical';
  fullYearTax: number;
  installments: AdvanceTaxInstallment[];
}

export interface OverallXirrResult {
  xirr: number | null;
  xirrWarning: boolean;
  totalCurrentValue: number;
  folioCount: number;
}


