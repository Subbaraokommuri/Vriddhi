/**
 * FolioTracker Configuration
 * All constants, tax rates, and feature flags
 */

export const CONFIG = {
  // Database
  DB_NAME: 'tracker.db',
  
  // Server
  PORT: 3000,
  
  // UI Defaults
  DEFAULT_THEME_COLOR: '#01696f',
  
  // Logging
  LOG_DIR: 'logs',
  
  // XIRR Parameters
  XIRR: {
    MAX_ITERATIONS: 100,
    PRECISION: 1e-7,
    MIN_DAYS: 30,
    BENCHMARK_TOLERANCE_DAYS: 3,
  },
  
  // External APIs
  APIS: {
    MF_DATA: 'https://api.mfapi.in/mf/',
  },
  
  // Indian Tax Rules (FY 2024-25 onwards)
  TAX: {
    LTCG_THRESHOLD: 125000,
    LTCG_RATE: 0.125, // 12.5%
    STCG_RATE: 0.20,  // 20%
    FY_START_MONTH: 3, // April (0-indexed)
  },
  
  // ETF proxies track TRI (dividends reinvested in NAV). Marginal ~0.1% expense ratio drag is acceptable.
  // PRI indices (^NSEI, ^BSESN) do not include dividends — use ETF proxies for fund comparison.
  DEFAULT_BENCHMARKS: [
    { symbol: '^NSEI',         name: 'Nifty 50 (PRI)',                  source: 'manual', category: 'broad_market', color: '#01696f' },
    { symbol: '^BSESN',        name: 'Sensex (PRI)',                     source: 'manual', category: 'broad_market', color: '#01696f' },
    { symbol: 'NIFTYBEES.NS',  name: 'Nifty 50 TRI (ETF proxy)',        source: 'manual', category: 'broad_market', color: '#4f98a3' },
    { symbol: 'JUNIORBEES.NS', name: 'Nifty Next 50 TRI (ETF proxy)',   source: 'manual', category: 'mid_cap',      color: '#da7101' },
    { symbol: 'MAFANG.NS',     name: 'Nifty Midcap 150 (ETF proxy)',    source: 'manual', category: 'mid_cap',      color: '#d19900' },
  ],
  
  // Date Mapping
  MONTH_MAP: {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  } as Record<string, string>
};
