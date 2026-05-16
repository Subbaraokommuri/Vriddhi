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
