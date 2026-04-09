import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// --- Types ---

export interface CasTransaction {
  date: string;           // ISO: "2019-11-28"
  description: string;
  type: "buy" | "sell";
  amount: number | null;
  units: number | null;
  nav: number | null;
  balance: number | null;
}

export interface CasScheme {
  fund_name: string;
  isin: string;
  isin_valid: boolean;
  plan: "Direct" | "Regular" | "Unknown";
  option: "Growth" | "IDCW" | "Unknown";
  advisor_code: string;
  is_direct: boolean;
  balance_mismatch: boolean;
  computed_balance: number | null;
  stated_balance: number | null;
  stated_cost: number | null;
  stated_market_value: number | null;
  net_cost: number;
  transactions: CasTransaction[];
}

export interface CasFolio {
  folio: string;
  folio_full: string;
  pan: string;
  kyc_ok: boolean;
  investor_name: string;
  registrar: string;
  schemes: CasScheme[];
}

export interface CasParseResult {
  parsed_date: string;
  cas_period: { from: string | null; to: string | null };
  investor: { name: string | null; email: string | null; mobile: string | null };
  portfolio_summary: Array<{ amc: string; cost: number; market_value: number }>;
  folios: CasFolio[];
  warnings: Array<{ folio: string; isin: string; type: string; detail: string }>;
  stats: {
    total_folios: number;
    total_schemes: number;
    total_transactions: number;
    direct_schemes: number;
    regular_schemes: number;
    active_schemes: number;
    redeemed_schemes: number;
    warnings_count: number;
  };
}

// --- Regex Definitions ---

const RE_DATE = /^\s*(\d{2}-[A-Z][a-z]{2}-\d{4})\s+(.*)/i;
const RE_FOLIO = /Folio No:\s*([\d\s./eE+]+)\s+PAN:\s*(\S+)/i;
const RE_KYC = /KYC:\s*(\w+)/i;
const RE_ISIN_TAG = /ISIN:\s*(INF[A-Z0-9]*)/i;
const RE_ISIN_BARE = /^(INF[A-Z0-9]+)/i;
const RE_ISIN_VALID = /^INF[A-Z0-9]{9}$/;
const RE_NUM = /\([\d,]+\.[\d]+\)|[\d,]+\.[\d]+/g;
const RE_CLOSING = /Closing Unit Balance:\s*([\d,.]+).*?Total Cost Value:\s*([\d,.]+).*?Market Value on.*?INR\s*([\d,.]+)/i;
const RE_REGISTRAR = /Registrar\s*:\s*(CAMS|KFINTECH)?/i;
const RE_ADVISOR = /\(Advisor:\s*([^)]+)\)/i;
const RE_PERIOD = /(\d{2}-[A-Z][a-z]{2}-\d{4})\s+To\s+(\d{2}-[A-Z][a-z]{2}-\d{4})/i;
const RE_EMAIL = /Email\s+Id:\s*(\S+@\S+)/i;
const RE_MOBILE = /Mobile:\s*\+?([\d.]+(?:[eE][+\-]?\d+)?)/;
const RE_SUMMARY_ROW = /^\s{3,}(.+?)\s{3,}([\d,]+\.[\d]+)\s+([\d,]+\.[\d]+)\s*$/;

const SKIP_PATTERNS = [
  /\*\*\*/,
  /STT Paid/i,
  /Stamp Duty/i,
  /TDS Deducted/i,
  /CAMSCASWS/,
  /Page\s+\d+\s+of\s+\d+/i,
  /^Date\s+Transaction/i,
  /Nominee\s+\d:/i,
  /Opening Unit Balance/i,
  /Closing Unit Balance/i,
  /Consolidated Account Statement/,
  /KYC:\s*OK/i,
  /^WEF\s/i,
  /ENTRY LOAD|EXIT LOAD/i,
  /NAV on \d/i,
  /Total Cost Value/i,
  /Market Value on/i,
  /^\s*\(INR\)/i,
  /PORTFOLIO SUMMARY/i,
  /Cost Value.*Market Value/i,
  /^\s+Mutual Fund\s+/i,
];

// --- Helpers ---

function shouldSkip(line: string): boolean {
  const s = line.trim();
  return !s || SKIP_PATTERNS.some(p => p.test(s));
}

function parseNumber(s: string | null): number | null {
  if (!s) return null;
  s = s.trim();
  const neg = s.startsWith("(") && s.endsWith(")");
  try {
    const v = parseFloat(s.replace(/[()]/g, "").replace(/,/g, ""));
    return neg ? -v : v;
  } catch {
    return null;
  }
}

function toIso(s: string): string {
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
  };
  const m = s.trim().match(/^(\d{2})-([A-Z][a-z]{2})-(\d{4})$/);
  if (m) {
    const [, day, month, year] = m;
    return `${year}-${months[month]}-${day}`;
  }
  return s.trim();
}

function extractNums(text: string): (number | null)[] {
  const matches = text.match(RE_NUM);
  if (!matches) return [];
  return matches.map(m => parseNumber(m));
}

function fixFolio(raw: string): string {
  raw = raw.replace(/\s+/g, "");
  const parts = raw.split("/");
  const fixed = parts.map(p => {
    try {
      if (p.toLowerCase().includes("e")) {
        return Math.round(parseFloat(p)).toString();
      }
    } catch { }
    return p;
  });
  return fixed.join("/");
}

function detectPlan(name: string): "Direct" | "Regular" | "Unknown" {
  const n = name.toLowerCase();
  if (n.includes("direct")) return "Direct";
  if (n.includes("regular")) return "Regular";
  return "Unknown";
}

function detectOption(name: string): "Growth" | "IDCW" | "Unknown" {
  const n = name.toLowerCase();
  if (n.includes("idcw") || n.includes("dividend")) return "IDCW";
  if (n.includes("growth")) return "Growth";
  return "Unknown";
}

function classifyTxn(desc: string): "buy" | "sell" | null {
  const d = desc.toLowerCase();
  if (["redemption", "switch-out", "switch out", "swp"].some(k => d.includes(k))) return "sell";
  if (["purchase", "sip", "switch-in", "switch in", "reinvest", "allotment"].some(k => d.includes(k))) return "buy";
  return null;
}

function extractIsin(line: string, nextLine: string = ""): [string | null, string, string, boolean] {
  let registrar = "";
  const rm = line.match(RE_REGISTRAR);
  if (rm && rm[1]) registrar = rm[1].toUpperCase();

  let fundName = line.split(/\s*-\s*ISIN:/i)[0];
  fundName = fundName.replace(RE_REGISTRAR, "").trim().replace(/-$/, "").trim();

  const m = line.match(RE_ISIN_TAG);
  if (m) {
    const isinRaw = m[1].trim();
    if (RE_ISIN_VALID.test(isinRaw)) return [isinRaw, fundName, registrar, false];
    const c = nextLine.trim().match(/^([A-Z0-9]+)/i);
    if (c) return [(isinRaw + c[1]).slice(0, 12), fundName, registrar, true];
    return [isinRaw, fundName, registrar, false];
  }

  if (RE_REGISTRAR.test(line) && nextLine) {
    const ns = nextLine.trim();
    const m2 = ns.match(RE_ISIN_TAG);
    if (m2) return [m2[1].slice(0, 12), fundName, registrar, true];
    const m3 = ns.match(RE_ISIN_BARE);
    if (m3) return [m3[1].slice(0, 12), fundName, registrar, true];
  }

  return [null, fundName, registrar, false];
}

// --- Main Parsing Logic ---

export function parseCasText(lines: string[]): CasParseResult {
  const warnings: CasParseResult['warnings'] = [];
  const folios: CasFolio[] = [];
  const portfolioSummary: CasParseResult['portfolio_summary'] = [];
  const investor: CasParseResult['investor'] = { name: null, email: null, mobile: null };
  const casPeriod: CasParseResult['cas_period'] = { from: null, to: null };

  const raw = lines.map(l => l.replace(/\n$/, "").replace(/\r$/, ""));
  const n = raw.length;

  // Pass 1: investor header
  let nameFound = false;
  for (let i = 0; i < Math.min(30, n); i++) {
    const line = raw[i];
    const mPeriod = line.match(RE_PERIOD);
    if (mPeriod && !casPeriod.from) {
      casPeriod.from = mPeriod[1];
      casPeriod.to = mPeriod[2];
    }
    const mEmail = line.match(RE_EMAIL);
    if (mEmail && !investor.email) investor.email = mEmail[1].trim();
    const mMobile = line.match(RE_MOBILE);
    if (mMobile && !investor.mobile) {
      try {
        investor.mobile = "+" + parseFloat(mMobile[1]).toFixed(0);
      } catch {
        investor.mobile = "+" + mMobile[1];
      }
    }
    if (investor.email && !nameFound) {
      const left = line.slice(0, 72).trim();
      if (left && /^[A-Za-z][A-Za-z0-9 .]+$/.test(left) && left.length > 4 && left.length < 50 && !RE_EMAIL.test(left)) {
        investor.name = left;
        nameFound = true;
      }
    }
  }

  // Pass 2: portfolio summary
  let inSummary = false;
  for (const line of raw) {
    if (line.includes("PORTFOLIO SUMMARY")) {
      inSummary = true;
      continue;
    }
    if (inSummary) {
      if (RE_FOLIO.test(line)) break;
      if (line.trim().startsWith("Total")) {
        inSummary = false;
        continue;
      }
      const m = line.match(RE_SUMMARY_ROW);
      if (m && !m[1].includes("Cost Value")) {
        portfolioSummary.push({
          amc: m[1].trim(),
          cost: parseNumber(m[2]) || 0,
          market_value: parseNumber(m[3]) || 0
        });
      }
    }
  }

  // Pass 3: state machine
  let curFolio: CasFolio | null = null;
  let curScheme: CasScheme | null = null;

  const finishScheme = () => {
    if (!curScheme || !curFolio) return;
    const t = curScheme.transactions;
    if (t.length > 0) {
      const cb = parseFloat((t[t.length - 1].balance || 0).toFixed(4));
      const sb = parseFloat((curScheme.stated_balance || 0).toFixed(4));
      curScheme.computed_balance = cb;
      const diff = Math.abs(cb - sb);
      curScheme.balance_mismatch = diff > 0.002;
      if (diff > 0.002) {
        warnings.push({
          folio: curFolio.folio,
          isin: curScheme.isin,
          type: "balance_mismatch",
          detail: `computed=${cb.toFixed(4)} stated=${sb.toFixed(4)} diff=${diff.toFixed(4)}`
        });
      }
    }
    const net = t.reduce((acc, x) => acc + (x.amount || 0), 0);
    curScheme.net_cost = parseFloat(net.toFixed(2));
    curFolio.schemes.push(curScheme);
    curScheme = null;
  };

  const finishFolio = () => {
    finishScheme();
    if (curFolio) {
      folios.push(curFolio);
      curFolio = null;
    }
  };

  let i = 0;
  while (i < n) {
    const line = raw[i];
    const nxt = i + 1 < n ? raw[i + 1] : "";

    // Folio header
    const mf = line.match(RE_FOLIO);
    if (mf) {
      finishFolio();
      const folioFull = fixFolio(mf[1]);
      const pan = mf[2];
      const kycM = line.match(RE_KYC);
      const kycOk = !!(kycM && kycM[1].toUpperCase() === "OK");
      let invName = "";
      if (i + 1 < n) {
        const nl = raw[i + 1].trim();
        if (nl && /^[A-Za-z][A-Za-z0-9 .]+$/.test(nl) && nl.length < 60) {
          invName = nl;
        }
      }
      curFolio = {
        folio: folioFull.split("/")[0],
        folio_full: folioFull,
        pan: pan,
        kyc_ok: kycOk,
        investor_name: invName,
        registrar: "CAMS",
        schemes: []
      };
      i++;
      continue;
    }

    // Scheme header
    if (curFolio && RE_REGISTRAR.test(line) && !line.includes("Folio No")) {
      finishScheme();
      const [isin, fundName, registrar, usedNxt] = extractIsin(line, nxt);
      if (registrar) curFolio.registrar = registrar;
      const advM = line.match(RE_ADVISOR);
      const advisor = advM ? advM[1].trim() : "";
      const isinValid = !!(isin && RE_ISIN_VALID.test(isin));
      if (!isinValid && isin) {
        warnings.push({
          folio: curFolio.folio,
          isin: isin,
          type: "invalid_isin",
          detail: `line ${i + 1}`
        });
      }
      const plan = detectPlan(fundName);
      curScheme = {
        fund_name: fundName,
        isin: isin || "",
        isin_valid: isinValid,
        plan: plan,
        option: detectOption(fundName),
        advisor_code: advisor,
        is_direct: plan === "Direct" || advisor.toUpperCase() === "DIRECT",
        balance_mismatch: false,
        computed_balance: null,
        stated_balance: null,
        stated_cost: null,
        stated_market_value: null,
        net_cost: 0,
        transactions: []
      };
      i += usedNxt ? 2 : 1;
      continue;
    }

    // Closing balance line
    const mc = line.match(RE_CLOSING);
    if (mc && curScheme) {
      try { curScheme.stated_balance = parseFloat(mc[1].replace(/,/g, "")); } catch { }
      try { curScheme.stated_cost = parseFloat(mc[2].replace(/,/g, "")); } catch { }
      try { curScheme.stated_market_value = parseFloat(mc[3].replace(/,/g, "")); } catch { }
      i++;
      continue;
    }

    if (shouldSkip(line)) {
      i++;
      continue;
    }

    // Transaction row
    const md = line.trim().match(RE_DATE);
    if (md && curScheme) {
      const dateStr = md[1];
      let rest = md[2];
      RE_NUM.lastIndex = 0;
      if (!RE_NUM.test(rest) && !rest.trim().startsWith("***")) {
        const nl = nxt.trim();
        if (nl && !RE_DATE.test(nl)) {
          rest = rest + " " + nl;
          i++;
        }
      }
      const nums = extractNums(rest);
      if (nums.length >= 4) {
        const amount = nums[nums.length - 4];
        const units = nums[nums.length - 3];
        const price = nums[nums.length - 2];
        const balance = nums[nums.length - 1];
        const desc = rest.replace(RE_NUM, "").replace(/\s+/g, " ").trim().replace(/,$/, "");
        let t = classifyTxn(desc);
        if (t === null) t = (units || 0) > 0 ? "buy" : "sell";
        curScheme.transactions.push({
          date: toIso(dateStr),
          description: desc,
          type: t,
          amount,
          units,
          nav: price,
          balance
        });
      }
    }
    i++;
  }

  finishFolio();

  const allSchemes = folios.flatMap(f => f.schemes);
  const totalTransactions = allSchemes.reduce((acc, s) => acc + s.transactions.length, 0);

  return {
    parsed_date: new Date().toISOString().split('T')[0],
    cas_period: casPeriod,
    investor,
    portfolio_summary: portfolioSummary,
    folios,
    warnings,
    stats: {
      total_folios: folios.length,
      total_schemes: allSchemes.length,
      total_transactions: totalTransactions,
      direct_schemes: allSchemes.filter(s => s.is_direct).length,
      regular_schemes: allSchemes.filter(s => !s.is_direct).length,
      active_schemes: allSchemes.filter(s => (s.stated_balance || 0) > 0).length,
      redeemed_schemes: allSchemes.filter(s => (s.stated_balance || 0) === 0 && s.transactions.length > 0).length,
      warnings_count: warnings.length
    }
  };
}

export function parseCasPdf(pdfPath: string, password?: string): CasParseResult {
  const tmp = path.join(os.tmpdir(), `cas-${Date.now()}.txt`);
  const pwArgs = password ? `-upw "${password}" -opw "${password}"` : '';
  try {
    execSync(`pdftotext -layout ${pwArgs} "${pdfPath}" "${tmp}"`);
    const text = fs.readFileSync(tmp, 'utf-8');
    const lines = text.split('\n');
    return parseCasText(lines);
  } finally {
    if (fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }
  }
}
