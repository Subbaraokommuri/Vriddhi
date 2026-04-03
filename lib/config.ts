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
  
  // Default Benchmarks
  DEFAULT_BENCHMARKS: [
    { symbol: '^NSEI', name: 'Nifty 50', source: 'yahoo', category: 'broad_market', color: '#01696f' },
    { symbol: 'NIFTYTR1.NS', name: 'Nifty 50 TRI', source: 'yahoo', category: 'broad_market', color: '#01696f' },
    { symbol: '^BSESN', name: 'Sensex', source: 'yahoo', category: 'broad_market', color: '#01696f' },
    { symbol: 'NIFTYNXT50.NS', name: 'Nifty Next 50', source: 'yahoo', category: 'broad_market', color: '#01696f' },
    { symbol: 'NIFTYMIDCAP150.NS', name: 'Nifty Midcap 150', source: 'yahoo', category: 'broad_market', color: '#01696f' },
    { symbol: 'NIFTYSMLCAP250.NS', name: 'Nifty Smallcap 250', source: 'yahoo', category: 'broad_market', color: '#01696f' },
    { symbol: 'NIFTY_LOW_VOL30.NS', name: 'Nifty Low Volatility 30', source: 'yahoo', category: 'broad_market', color: '#01696f' },
    { symbol: 'NIFTYALPHA50.NS', name: 'Nifty Alpha 50', source: 'yahoo', category: 'broad_market', color: '#01696f' },
  ],
  
  // Date Mapping
  MONTH_MAP: {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  } as Record<string, string>
};
