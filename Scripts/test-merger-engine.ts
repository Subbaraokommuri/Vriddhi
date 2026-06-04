import { computeCapitalGains } from '../lib/capital-gains.ts';

// Fund A buy transactions (source lots for look-through)
const fundATxns = [
  { date: '2017-01-02', transaction_type: 'buy', units: 811.260, amount: 100000.00, nav: 123.265 },
  { date: '2018-03-15', transaction_type: 'buy', units: 645.603, amount: 100000.00, nav: 154.894 },
  { date: '2018-05-15', transaction_type: 'buy', units: 637.954, amount: 100000.00, nav: 156.751 },
];

// Fund B transactions (surviving fund — what computeCapitalGains sees)
const fundBTxns = [
  {
    date: '2018-06-01', transaction_type: 'buy',
    units: 6113.545, amount: 323492.12, nav: 52.914,
    transaction_subtype: 'merger_in',
    merger_ratio: 154.425 / 52.914,
    source_fund_id: 'INF179K01UZ7'
  },
  { date: '2018-09-14', transaction_type: 'sell', units: -500.000, amount: 27258.50, nav: 54.517 },
  { date: '2019-01-01', transaction_type: 'sell', units: -2200.000, amount: 118014.60, nav: 53.643 },
  { date: '2019-04-01', transaction_type: 'sell', units: -2000.000, amount: 113578.00, nav: 56.789 },
  { date: '2020-01-15', transaction_type: 'buy', units: 1706.426, amount: 100000.00, nav: 58.602 },
  { date: '2021-03-01', transaction_type: 'sell', units: -2800.000, amount: 201868.80, nav: 72.096 },
];

// mergerSourceMap: Fund A transactions keyed by Fund A's fund_id
const mergerSourceMap = new Map([
  ['INF179K01UZ7', { isin: 'INF179K01UZ7', transactions: fundATxns }]
]);

// navOnDate mock — returns Jan-2018 FMV for Fund A only when SQL insert has been done
// Run once WITH null (simulating missing FMV), once WITH 160.41 (simulating SQL insert)
const navOnDate_withFMV = (isin: string, date: string) => {
  if (isin === 'INF179K01UZ7' && date === '2018-01-31') return 160.41;
  return null;
};
const navOnDate_noFMV = (_isin: string, _date: string) => null;

// --- Test FY2018-19 WITH grandfathering FMV ---
const result_1819_withFMV = computeCapitalGains(
  'folio-b', '1234567/01', 'HDFC Hybrid Equity Fund - Direct Plan - Growth Option',
  'INF179K01XZ1', 'Hybrid Equity', 'equity',
  fundBTxns, navOnDate_withFMV, '2018-04-01', '2019-03-31',
  mergerSourceMap
);
console.log('=== FY2018-19 WITH FMV ===');
console.log('STCG:', result_1819_withFMV.totalSTCG.toFixed(2));
console.log('LTCG:', result_1819_withFMV.totalLTCG.toFixed(2));
console.log('Lots:', result_1819_withFMV.matchedLots.length);
result_1819_withFMV.matchedLots.forEach(l =>
  console.log(` buyDate:${l.buyDate} type:${l.gainType} gain:${l.gain.toFixed(2)} grandFathered:${l.grandfatheringApplied} fmvMissing:${l.fmvMissing}`)
);

// --- Test FY2018-19 WITHOUT grandfathering FMV (no SQL insert) ---
const result_1819_noFMV = computeCapitalGains(
  'folio-b', '1234567/01', 'HDFC Hybrid Equity Fund - Direct Plan - Growth Option',
  'INF179K01XZ1', 'Hybrid Equity', 'equity',
  fundBTxns, navOnDate_noFMV, '2018-04-01', '2019-03-31',
  mergerSourceMap
);
console.log('\n=== FY2018-19 WITHOUT FMV (fallback) ===');
console.log('STCG:', result_1819_noFMV.totalSTCG.toFixed(2));
console.log('LTCG:', result_1819_noFMV.totalLTCG.toFixed(2));

// --- Test FY2019-20 ---
const result_1920 = computeCapitalGains(
  'folio-b', '1234567/01', 'HDFC Hybrid Equity Fund - Direct Plan - Growth Option',
  'INF179K01XZ1', 'Hybrid Equity', 'equity',
  fundBTxns, navOnDate_withFMV, '2019-04-01', '2020-03-31',
  mergerSourceMap
);
console.log('\n=== FY2019-20 ===');
console.log('STCG:', result_1920.totalSTCG.toFixed(2));
console.log('LTCG:', result_1920.totalLTCG.toFixed(2));

// --- Test FY2020-21 ---
const result_2021 = computeCapitalGains(
  'folio-b', '1234567/01', 'HDFC Hybrid Equity Fund - Direct Plan - Growth Option',
  'INF179K01XZ1', 'Hybrid Equity', 'equity',
  fundBTxns, navOnDate_withFMV, '2020-04-01', '2021-03-31',
  mergerSourceMap
);
console.log('\n=== FY2020-21 ===');
console.log('STCG:', result_2021.totalSTCG.toFixed(2));
console.log('LTCG:', result_2021.totalLTCG.toFixed(2));

// --- CRITICAL: check merger_out did NOT generate a MatchedLot ---
const allFY1819Lots = result_1819_withFMV.matchedLots;
const mergerOutLot = allFY1819Lots.find(l => l.buyDate === '2018-06-01' && l.sellDate === '2018-06-01');
console.log('\n=== Merger-out guard ===');
console.log('merger_out generated MatchedLot:', mergerOutLot ? 'FAIL' : 'PASS');