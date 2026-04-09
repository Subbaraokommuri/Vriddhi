import * as fs from 'fs';
import { CasParseResult, CasFolio, CasScheme } from './cas-parser';

// --- Types ---

export interface CheckFailure {
  folio: string;
  isin: string;
  fund: string;
  detail: string;
}

export interface CheckResult {
  name: string;
  what: string;
  why: string;
  failures: CheckFailure[];
  passed: number;
  total: number;
}

export interface CostNote {
  folio: string;
  isin: string;
  fund: string;
  category: 'exact' | 'stamp_duty' | 'redeemed' | 'fifo' | 'investigate';
  net: number;
  stated: number;
  diff: number;
}

export interface InvestorSummary {
  name: string;
  folios: number;
  schemes: number;
  active: number;
  buy: number;
  sell: number;
}

export interface PortfolioSummary {
  investors: Record<string, InvestorSummary>;
  planCt: Record<string, number>;
  optCt: Record<string, number>;
  totalBuy: number;
  totalSell: number;
  netDeployed: number;
  actCost: number;
  actMval: number;
}

// --- Helpers ---

const RE_ISIN = /^INF[A-Z0-9]{9}$/;

export function inr(v: number | null, cr = false): string {
  if (v === null) return '—';
  if (cr) return `₹${(v / 1e7).toFixed(2)} Cr`;
  return v < 0 
    ? `(${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` 
    : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// --- Checks ---

function chkIsin(data: CasParseResult): CheckFailure[] {
  const f: CheckFailure[] = [];
  for (const fo of data.folios) {
    for (const s of fo.schemes) {
      if (!RE_ISIN.test(s.isin || "")) {
        f.push({
          folio: fo.folio_full,
          isin: s.isin,
          fund: s.fund_name.slice(0, 60),
          detail: `Got: '${s.isin}' — expected ^INF[A-Z0-9]{9}$`
        });
      }
    }
  }
  return f;
}

function chkUnitBalance(data: CasParseResult): CheckFailure[] {
  const f: CheckFailure[] = [];
  for (const fo of data.folios) {
    for (const s of fo.schemes) {
      const t = s.transactions;
      if (t.length === 0) continue;
      const comp = parseFloat((t[t.length - 1].balance || 0).toFixed(4));
      const stat = parseFloat((s.stated_balance || 0).toFixed(4));
      const diff = Math.abs(comp - stat);
      if (diff > 0.002) {
        f.push({
          folio: fo.folio_full,
          isin: s.isin,
          fund: s.fund_name.slice(0, 60),
          detail: `computed=${comp.toFixed(4)}  stated=${stat.toFixed(4)}  diff=${diff.toFixed(4)}`
        });
      }
    }
  }
  return f;
}

function chkRunningBal(data: CasParseResult): CheckFailure[] {
  const f: CheckFailure[] = [];
  for (const fo of data.folios) {
    for (const s of fo.schemes) {
      const t = s.transactions;
      for (let i = 1; i < t.length; i++) {
        const prev = t[i - 1].balance || 0;
        const units = t[i].units || 0;
        const curr = t[i].balance || 0;
        if (Math.abs(parseFloat((prev + units).toFixed(4)) - curr) > 0.002) {
          f.push({
            folio: fo.folio_full,
            isin: s.isin,
            fund: s.fund_name.slice(0, 60),
            detail: `Row ${i + 1} (${t[i].date}): ${prev.toFixed(4)}+${units.toFixed(4)}!=${curr.toFixed(4)}`
          });
        }
      }
    }
  }
  return f;
}

function chkDates(data: CasParseResult): CheckFailure[] {
  const f: CheckFailure[] = [];
  for (const fo of data.folios) {
    for (const s of fo.schemes) {
      const t = s.transactions;
      for (let i = 1; i < t.length; i++) {
        if (t[i].date < t[i - 1].date) {
          f.push({
            folio: fo.folio_full,
            isin: s.isin,
            fund: s.fund_name.slice(0, 60),
            detail: `Row ${i + 1}: ${t[i].date} before row ${i}: ${t[i - 1].date}`
          });
        }
      }
    }
  }
  return f;
}

function chkNoNeg(data: CasParseResult): CheckFailure[] {
  const f: CheckFailure[] = [];
  for (const fo of data.folios) {
    for (const s of fo.schemes) {
      s.transactions.forEach((t, i) => {
        if ((t.balance || 0) < -0.001) {
          f.push({
            folio: fo.folio_full,
            isin: s.isin,
            fund: s.fund_name.slice(0, 60),
            detail: `Row ${i + 1} (${t.date}): balance=${(t.balance || 0).toFixed(4)}`
          });
        }
      });
    }
  }
  return f;
}

function chkMissing(data: CasParseResult): CheckFailure[] {
  const f: CheckFailure[] = [];
  for (const fo of data.folios) {
    for (const s of fo.schemes) {
      s.transactions.forEach((t, i) => {
        const miss = (['date', 'amount', 'units', 'nav', 'balance'] as const).filter(k => t[k] === null);
        if (miss.length > 0) {
          f.push({
            folio: fo.folio_full,
            isin: s.isin,
            fund: s.fund_name.slice(0, 60),
            detail: `Row ${i + 1} (${t.date || '?'}): missing ${miss.join(', ')}`
          });
        }
      });
    }
  }
  return f;
}

function chkZeroNav(data: CasParseResult): CheckFailure[] {
  const f: CheckFailure[] = [];
  for (const fo of data.folios) {
    for (const s of fo.schemes) {
      s.transactions.forEach((t, i) => {
        if ((t.nav || 0) === 0 && (t.units || 0) !== 0) {
          f.push({
            folio: fo.folio_full,
            isin: s.isin,
            fund: s.fund_name.slice(0, 60),
            detail: `Row ${i + 1} (${t.date}): nav=0 units=${t.units}`
          });
        }
      });
    }
  }
  return f;
}

function chkCost(data: CasParseResult): { failures: CheckFailure[], notes: CostNote[] } {
  const failures: CheckFailure[] = [];
  const notes: CostNote[] = [];
  for (const fo of data.folios) {
    for (const s of fo.schemes) {
      const t = s.transactions;
      const net = parseFloat(t.reduce((acc, x) => acc + (x.amount || 0), 0).toFixed(2));
      const stated = s.stated_cost || 0;
      const diff = parseFloat(Math.abs(net - stated).toFixed(2));
      const hasSell = t.some(x => x.type === 'sell');
      const stBal = s.stated_balance || 0;

      let cat: CostNote['category'];
      if (diff < 0.02) cat = 'exact';
      else if (stBal === 0 && hasSell && stated === 0) cat = 'redeemed';
      else if (diff <= 350 && !hasSell) cat = 'stamp_duty';
      else if (hasSell) cat = 'fifo';
      else cat = 'investigate';

      const entry: CostNote = {
        folio: fo.folio_full,
        isin: s.isin,
        fund: s.fund_name.slice(0, 60),
        category: cat,
        net,
        stated,
        diff
      };

      if (cat === 'investigate') {
        failures.push({
          ...entry,
          detail: `net=${net.toLocaleString('en-IN', { minimumFractionDigits: 2 })} stated=${stated.toLocaleString('en-IN', { minimumFractionDigits: 2 })} diff=${diff.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
        });
      }
      notes.push(entry);
    }
  }
  return { failures, notes };
}

export function runChecks(data: CasParseResult): { results: CheckResult[], costNotes: CostNote[] } {
  const total = data.folios.reduce((acc, fo) => acc + fo.schemes.length, 0);
  const { failures: costFail, notes: costNotes } = chkCost(data);

  const defs: [string, string, string, CheckFailure[]][] = [
    ["ISIN Format Validation", "Every ISIN matches ^INF[A-Z0-9]{9}$", "No truncation or column bleed in PDF.", chkIsin(data)],
    ["Unit Balance Match", "Last row running balance = PDF Closing Unit Balance", "Tolerance 0.002 units. Gold-standard check.", chkUnitBalance(data)],
    ["Running Balance Continuity", "For every row: prev_balance + units = current_balance", "Catches skipped or duplicated transactions.", chkRunningBal(data)],
    ["Transaction Date Ordering", "Transactions within each scheme are chronological", "Out-of-order rows indicate PDF column bleed.", chkDates(data)],
    ["No Negative Mid-Series Balance", "Running unit balance never goes below zero", "Negative = sell parsed without a matching buy.", chkNoNeg(data)],
    ["No Missing Fields", "Every transaction has date, amount, units, NAV, balance", "Missing fields break XIRR and capital gains calculations.", chkMissing(data)],
    ["No Zero NAV", "No unit-moving transaction has NAV = 0", "Zero NAV means a row-alignment failure.", chkZeroNav(data)],
    ["Cost Value Cross-check", "Net cashflow vs PDF Total Cost Value", "Only flags unexplained diffs — stamp duty, FIFO, redeemed are expected.", costFail],
  ];

  const results = defs.map(([name, what, why, failures]) => ({
    name, what, why, failures,
    passed: total - failures.length,
    total
  }));

  return { results, costNotes };
}

export function summarise(data: CasParseResult): PortfolioSummary {
  const investors: Record<string, InvestorSummary> = {};
  const planCt: Record<string, number> = {};
  const optCt: Record<string, number> = {};
  let totalBuy = 0;
  let totalSell = 0;
  let actCost = 0;
  let actMval = 0;

  for (const fo of data.folios) {
    const p = fo.pan;
    if (!investors[p]) {
      investors[p] = { name: fo.investor_name || p, folios: 0, schemes: 0, active: 0, buy: 0, sell: 0 };
    }
    const d = investors[p];
    d.folios += 1;

    for (const s of fo.schemes) {
      const t = s.transactions;
      const ba = t.filter(x => x.type === 'buy').reduce((acc, x) => acc + (x.amount || 0), 0);
      const sa = Math.abs(t.filter(x => x.type === 'sell').reduce((acc, x) => acc + (x.amount || 0), 0));
      
      d.schemes += 1;
      d.buy += ba;
      d.sell += sa;

      if ((s.stated_balance || 0) > 0) {
        d.active += 1;
        actCost += s.stated_cost || 0;
        actMval += s.stated_market_value || 0;
      }

      totalBuy += ba;
      totalSell += sa;

      const plan = s.plan || "Unknown";
      planCt[plan] = (planCt[plan] || 0) + 1;
      const opt = s.option || "Unknown";
      optCt[opt] = (optCt[opt] || 0) + 1;
    }
  }

  return {
    investors,
    planCt,
    optCt,
    totalBuy: parseFloat(totalBuy.toFixed(2)),
    totalSell: parseFloat(totalSell.toFixed(2)),
    netDeployed: parseFloat((totalBuy - totalSell).toFixed(2)),
    actCost: parseFloat(actCost.toFixed(2)),
    actMval: parseFloat(actMval.toFixed(2))
  };
}

import { generateHtml } from './cas-reconcile-html';
export { generateHtml };

export function reconcileCas(data: CasParseResult, outPath: string): void {
  const html = generateHtml(data);
  fs.writeFileSync(outPath, html, 'utf-8');
}
