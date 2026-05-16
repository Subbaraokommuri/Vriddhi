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

  NIFTY_TRI_CATALOGUE: [
    // Broad Based
    { symbol: 'Nifty 50', name: 'Nifty 50 TRI', category: 'Broad Based', description: 'Tracks the performance of the 50 largest and most liquid Indian companies.' },
    { symbol: 'Nifty Next 50', name: 'Nifty Next 50 TRI', category: 'Broad Based', description: 'Represents the next 50 companies from Nifty 100 after Nifty 50.' },
    { symbol: 'Nifty 100', name: 'Nifty 100 TRI', category: 'Broad Based', description: 'Captures the top 100 blue-chip companies listed in India.' },
    { symbol: 'Nifty 200', name: 'Nifty 200 TRI', category: 'Broad Based', description: 'Includes 200 companies covering about 87% of market capitalization.' },
    { symbol: 'Nifty 500', name: 'Nifty 500 TRI', category: 'Broad Based', description: 'India\'s first broad-based benchmark tracking the top 500 companies.' },
    { symbol: 'Nifty Midcap 50', name: 'Nifty Midcap 50 TRI', category: 'Broad Based', description: 'Focuses on the top 50 mid-sized companies.' },
    { symbol: 'Nifty Midcap 100', name: 'Nifty Midcap 100 TRI', category: 'Broad Based', description: 'Captures the performance of the mid-market segment.' },
    { symbol: 'Nifty Midcap 150', name: 'Nifty Midcap 150 TRI', category: 'Broad Based', description: 'Tracks the performance of companies ranked 101 to 250 by market cap.' },
    { symbol: 'Nifty Smallcap 50', name: 'Nifty Smallcap 50 TRI', category: 'Broad Based', description: 'Most liquid stocks in the small-cap segment.' },
    { symbol: 'Nifty Smallcap 100', name: 'Nifty Smallcap 100 TRI', category: 'Broad Based', description: 'Captures the performance of the small-market segment.' },
    { symbol: 'Nifty Smallcap 250', name: 'Nifty Smallcap 250 TRI', category: 'Broad Based', description: 'Tracks the performance of companies ranked 251 to 500 by market cap.' },
    { symbol: 'Nifty LargeMidcap 250', name: 'Nifty LargeMidcap 250 TRI', category: 'Broad Based', description: 'Combines the Nifty 100 and Nifty Midcap 150 indices.' },
    { symbol: 'Nifty MidSmallcap 400', name: 'Nifty MidSmallcap 400 TRI', category: 'Broad Based', description: 'Combines the Nifty Midcap 150 and Nifty Smallcap 250 indices.' },
    { symbol: 'Nifty Microcap 250', name: 'Nifty Microcap 250 TRI', category: 'Broad Based', description: 'Tracks the performance of micro-cap companies ranked 501 to 750.' },
    { symbol: 'Nifty Total Market', name: 'Nifty Total Market TRI', category: 'Broad Based', description: 'The most comprehensive index tracking about 750 Indian companies.' },

    // Sectoral
    { symbol: 'Nifty Bank', name: 'Nifty Bank TRI', category: 'Sectoral', description: 'Tracks the performance of the most liquid and large Indian banking stocks.' },
    { symbol: 'Nifty IT', name: 'Nifty IT TRI', category: 'Sectoral', description: 'Reflects the performance of the Indian IT services and software companies.' },
    { symbol: 'Nifty FMCG', name: 'Nifty FMCG TRI', category: 'Sectoral', description: 'Tracks the performance of companies in the Fast Moving Consumer Goods sector.' },
    { symbol: 'Nifty Auto', name: 'Nifty Auto TRI', category: 'Sectoral', description: 'Captures the performance of the Indian automobile industry.' },
    { symbol: 'Nifty Financial Services', name: 'Nifty Financial Services TRI', category: 'Sectoral', description: 'Broad gauge of financial services sector including banks, NBFCs, etc.' },
    { symbol: 'Nifty Pharma', name: 'Nifty Pharma TRI', category: 'Sectoral', description: 'Reflects the performance of the Indian pharmaceutical sector.' },
    { symbol: 'Nifty Metal', name: 'Nifty Metal TRI', category: 'Sectoral', description: 'Includes companies representing the metals and mining sector.' },
    { symbol: 'Nifty Realty', name: 'Nifty Realty TRI', category: 'Sectoral', description: 'Tracks the performance of real estate developers and companies.' },
    { symbol: 'Nifty Media', name: 'Nifty Media TRI', category: 'Sectoral', description: 'Captures the performance of media and entertainment companies.' },
    { symbol: 'Nifty Energy', name: 'Nifty Energy TRI', category: 'Sectoral', description: 'Reflects the performance of companies in the energy sector like oil, gas, power.' },
    { symbol: 'Nifty Infra', name: 'Nifty Infra TRI', category: 'Sectoral', description: 'Focuses on companies in the infrastructure and related space.' },
    { symbol: 'Nifty PSU Bank', name: 'Nifty PSU Bank TRI', category: 'Sectoral', description: 'Exclusively tracks public sector banks listed in India.' },
    { symbol: 'Nifty Private Bank', name: 'Nifty Private Bank TRI', category: 'Sectoral', description: 'Exclusively tracks private sector banks listed in India.' },
    { symbol: 'Nifty Healthcare', name: 'Nifty Healthcare TRI', category: 'Sectoral', description: 'Broadest gauge of the Indian healthcare and hospital services segment.' },
    { symbol: 'Nifty Consumer Durables', name: 'Nifty Consumer Durables TRI', category: 'Sectoral', description: 'Captures the performance of the consumer durables electronic goods sector.' },
    { symbol: 'Nifty Oil & Gas', name: 'Nifty Oil & Gas TRI', category: 'Sectoral', description: 'Tracks the performance of companies in the oil & gas and related industries.' },

    // Thematic
    { symbol: 'Nifty India Consumption', name: 'Nifty India Consumption TRI', category: 'Thematic', description: 'Tracks companies benefitting from the Indian domestic consumption story.' },
    { symbol: 'Nifty Commodities', name: 'Nifty Commodities TRI', category: 'Thematic', description: 'Reflects the performance of diversified commodity-focused companies.' },
    { symbol: 'Nifty India Digital', name: 'Nifty India Digital TRI', category: 'Thematic', description: 'Focuses on companies leading India\'s digital transformation.' },
    { symbol: 'Nifty MNC', name: 'Nifty MNC TRI', category: 'Thematic', description: 'Includes listed multinational corporations operating in India.' },
    { symbol: 'Nifty PSE', name: 'Nifty PSE TRI', category: 'Thematic', description: 'Tracks the performance of Public Sector Enterprises where GOI is a majority shareholder.' },
    { symbol: 'Nifty CPSE', name: 'Nifty CPSE TRI', category: 'Thematic', description: 'Central Public Sector Enterprises index formulated by the Ministry of Finance.' },
    { symbol: 'Nifty India Manufacturing', name: 'Nifty India Manufacturing TRI', category: 'Thematic', description: 'Captures the performance of manufacturing-intensive Indian companies.' },
    { symbol: 'Nifty Mobility', name: 'Nifty Mobility TRI', category: 'Thematic', description: 'Reflects companies that move people and goods efficiently.' },
    { symbol: 'Nifty Non-Cyclical Consumer', name: 'Nifty Non-Cyclical Consumer TRI', category: 'Thematic', description: 'Focuses on stable, non-cyclical consumer-oriented companies.' },
    { symbol: 'Nifty India Defence', name: 'Nifty India Defence TRI', category: 'Thematic', description: 'Tracks the performance of companies involved in the Indian defence sector.' },
    { symbol: 'Nifty Housing', name: 'Nifty Housing TRI', category: 'Thematic', description: 'Reflects companies involved in the housing and construction ecosystem.' },
    { symbol: 'Nifty India Corporate Group Index - Tata', name: 'Nifty India Corporate Group Index - Tata TRI', category: 'Thematic', description: 'Captures the aggregate performance of Tata Group companies listed in India.' },
    { symbol: 'Nifty Shariah 25', name: 'Nifty Shariah 25 TRI', category: 'Thematic', description: 'Tracks Shariah-compliant companies from the Nifty 50 universe.' },
    { symbol: 'Nifty500 Shariah', name: 'Nifty500 Shariah TRI', category: 'Thematic', description: 'Tracks Shariah-compliant companies from the Nifty 500 universe.' },

    // Strategy
    { symbol: 'Nifty50 Value 20', name: 'Nifty50 Value 20 TRI', category: 'Strategy', description: '20 value-oriented companies selected from the Nifty 50 index.' },
    { symbol: 'Nifty50 Equal Weight', name: 'Nifty50 Equal Weight TRI', category: 'Strategy', description: 'Assigns equal weighting to all 50 constituents of the Nifty 50 index.' },
    { symbol: 'Nifty100 Equal Weight', name: 'Nifty100 Equal Weight TRI', category: 'Strategy', description: 'Assigns equal weighting to all 100 constituents of the Nifty 100 index.' },
    { symbol: 'Nifty100 Low Volatility 30', name: 'Nifty100 Low Volatility 30 TRI', category: 'Strategy', description: '30 least volatile stocks within the Nifty 100 index.' },
    { symbol: 'Nifty Alpha 50', name: 'Nifty Alpha 50 TRI', category: 'Strategy', description: '50 stocks with the highest "alpha" or price outperformance.' },
    { symbol: 'Nifty200 Momentum 30', name: 'Nifty200 Momentum 30 TRI', category: 'Strategy', description: '30 stocks with the highest price momentum from Nifty 200.' },
    { symbol: 'Nifty Midcap150 Momentum 50', name: 'Nifty Midcap150 Momentum 50 TRI', category: 'Strategy', description: '50 stocks with the highest price momentum from Nifty Midcap 150.' },
    { symbol: 'Nifty500 Momentum 50', name: 'Nifty500 Momentum 50 TRI', category: 'Strategy', description: '50 stocks with the highest price momentum from Nifty 500.' },
    { symbol: 'Nifty Quality Low-Volatility 30', name: 'Nifty Quality Low-Volatility 30 TRI', category: 'Strategy', description: 'Combines quality and low-volatility factors for 30 stocks.' },
    { symbol: 'Nifty Alpha Low-Volatility 30', name: 'Nifty Alpha Low-Volatility 30 TRI', category: 'Strategy', description: 'Combines alpha and low-volatility factors for 30 stocks.' },
    { symbol: 'Nifty200 Quality 30', name: 'Nifty200 Quality 30 TRI', category: 'Strategy', description: '30 companies with high quality scores listed in Nifty 200.' },
    { symbol: 'Nifty Dividend Opportunities 50', name: 'Nifty Dividend Opportunities 50 TRI', category: 'Strategy', description: '50 companies with high dividend yields and payout histories.' },
    { symbol: 'Nifty Growth Sectors 15', name: 'Nifty Growth Sectors 15 TRI', category: 'Strategy', description: '15 companies from high-growth sectors with low P/E multiples.' },
    { symbol: 'Nifty100 Alpha 30', name: 'Nifty100 Alpha 30 TRI', category: 'Strategy', description: '30 stocks with highest alpha from the Nifty 100 universe.' },
  ],
  
  // Date Mapping
  MONTH_MAP: {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  } as Record<string, string>,
  
  // Investment Trend Analysis
  INVESTMENT_TREND: {
    MIN_MEANINGFUL_BASE_INR: 100000, // suppress YoY% when prior year netInvested < ₹1L
    YOY_AXIS_MIN: -100,              // right Y-axis domain floor (%)
    YOY_AXIS_MAX: 300,               // right Y-axis domain ceiling (%)
    LEFT_AXIS_MAX: 10000000,         // left Y-axis ceiling (₹1 Cr)
  }
};

export const ACTIVE_AMC_LIST: string[] = [
  'Aditya Birla Sun Life',
  'Axis',
  'Bajaj Finserv',
  'Bandhan',
  'Bank of India',
  'Baroda BNP Paribas',
  'Canara Robeco',
  'DSP',
  'Edelweiss',
  'Franklin Templeton',
  'HDFC',
  'HSBC',
  'ICICI Prudential',
  'IDBI',
  'Invesco',
  'ITI',
  'JM Financial',
  'Kotak',
  'LIC',
  'Mahindra Manulife',
  'Mirae Asset',
  'Motilal Oswal',
  'Navi',
  'Nippon India',
  'NJ',
  'Old Bridge',
  'PGIM India',
  'PPFAS',
  'Parag Parikh',
  'Quant',
  'Quantum',
  'Samco',
  'SBI',
  'Shriram',
  'Sundaram',
  'Tata',
  'Taurus',
  'Trust',
  'Union',
  'UTI',
  'WhiteOak Capital',
  'Zerodha',
  '360 ONE',
];
