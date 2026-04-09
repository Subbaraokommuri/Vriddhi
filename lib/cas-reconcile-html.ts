import { CasParseResult } from './cas-parser';
import { runChecks, summarise, inr, CheckResult, CostNote, PortfolioSummary } from './cas-reconcile';

const CSS = `
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Segoe UI,Arial,sans-serif;background:#f0f4f8;color:#222;font-size:14px}
.hdr{background:linear-gradient(135deg,#01696f,#014f53);color:#fff;padding:24px 36px}
.hdr h1{font-size:20px;font-weight:700;margin-bottom:4px}
.hdr p{font-size:13px;opacity:.8}
.wrap{max-width:1120px;margin:24px auto;padding:0 20px}
.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:22px}
.card{background:#fff;border-radius:10px;padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
.card .val{font-size:26px;font-weight:700;color:#01696f}
.card .lbl{font-size:11px;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:.04em}
.sec{background:#fff;border-radius:10px;padding:20px 24px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
.sec h2{font-size:15px;font-weight:700;color:#01696f;margin-bottom:14px;padding-bottom:9px;border-bottom:2px solid #e8f5f5}
.chk{display:flex;align-items:flex-start;padding:11px 0;border-bottom:1px solid #f0f0f0}
.chk:last-child{border-bottom:none}
.ci{font-size:18px;width:28px;flex-shrink:0;margin-top:1px}
.cb{flex:1}.cn{font-weight:600;font-size:14px;margin-bottom:2px}
.cd{font-size:12px;color:#666;margin-bottom:1px}.cw{font-size:11px;color:#aaa}
.cr{font-size:13px;font-weight:600;white-space:nowrap;margin-left:12px;margin-top:1px}
.pass{color:#27ae60}.warn{color:#e67e22}
.bnr{padding:11px 15px;border-radius:6px;font-size:13px;margin-bottom:14px}
.ok{background:#d5f5e3;border-left:4px solid #27ae60;color:#1a6b3a}
.nok{background:#fef9e7;border-left:4px solid #f39c12;color:#7d6608}
.ig{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ic{border:1px solid #e8f0f0;border-radius:8px;padding:13px 15px}
.ic h3{font-size:13px;font-weight:700;color:#01696f;margin-bottom:9px}
.ir{display:flex;justify-content:space-between;padding:4px 0;font-size:12.5px;border-bottom:1px solid #f5f5f5}
.ir:last-child{border-bottom:none}.il{color:#888}.iv{font-weight:600}
.tw{overflow-x:auto;max-height:460px;overflow-y:auto}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{background:#f0f9f9;color:#01696f;text-align:left;padding:9px 11px;font-weight:600;position:sticky;top:0;z-index:1}
td{padding:7px 11px;border-bottom:1px solid #f4f4f4}
tr:hover td{background:#f8fdfd}
.mono{font-family:monospace;font-size:11px}
.b{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
.ba{background:#d5f5e3;color:#27ae60}.br{background:#fdebd0;color:#e67e22}
.bd{background:#d6eaf8;color:#2980b9}.brg{background:#f9ebea;color:#c0392b}
.bx{background:#d5f5e3;color:#27ae60}.bs{background:#ebf5fb;color:#2980b9}
.brd{background:#f9f9f9;color:#888}.bf{background:#fef9e7;color:#b7950b}
.leg{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
.li{font-size:11px;display:flex;align-items:center;gap:5px}
details summary{cursor:pointer;color:#01696f;font-size:13px;font-weight:600;padding-top:10px}
@media print{.hdr{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.tw{max-height:none;overflow:visible}}
</style>
`;

export function generateHtml(data: CasParseResult): string {
  const { results: checks, costNotes } = runChecks(data);
  const summ = summarise(data);
  
  const now = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/,/g, '');
  const inv = data.investor;
  const stats = data.stats;
  const period = data.cas_period;
  const ok = checks.every(c => c.failures.length === 0);
  const nOk = checks.filter(c => c.failures.length === 0).length;
  const nTot = checks.length;
  
  const catCt: Record<string, number> = {};
  costNotes.forEach(n => { catCt[n.category] = (catCt[n.category] || 0) + 1; });
  
  const per = `${period?.from || '?'} to ${period?.to || '?'}`;

  let chkHtml = "";
  for (const c of checks) {
    const nf = c.failures.length;
    const icon = nf === 0 ? "&#10004;&#65039;" : "&#9888;&#65039;";
    const cls = nf === 0 ? "pass" : "warn";
    const res = nf === 0 
      ? `${c.total}/${c.total} PASS` 
      : `${c.passed}/${c.total} — ${nf} issues`;
    
    let failItems = "";
    for (const x of c.failures.slice(0, 5)) {
      failItems += `
        <div style="margin-top:5px;padding:5px 9px;background:#fff8f0;border-left:3px solid #f39c12;border-radius:3px;font-size:11.5px;color:#555">
          <code>${x.isin}</code> &middot; ${x.fund.slice(0, 45)} &middot; ${x.detail}
        </div>`;
    }
    
    chkHtml += `
      <div class="chk">
        <div class="ci">${icon}</div>
        <div class="cb">
          <div class="cn">${c.name}</div>
          <div class="cd">${c.what}</div>
          <div class="cw">${c.why}</div>
          ${failItems}
        </div>
        <div class="cr ${cls}">${res}</div>
      </div>`;
  }

  let invHtml = "";
  for (const [pan, d] of Object.entries(summ.investors)) {
    const profit = d.buy - d.sell;
    invHtml += `
      <div class="ic">
        <h3>&#128100; ${d.name} <span style="font-weight:400;color:#888;font-size:11px">${pan}</span></h3>
        <div class="ir"><span class="il">Folios</span><span class="iv">${d.folios}</span></div>
        <div class="ir"><span class="il">Schemes</span><span class="iv">${d.schemes}</span></div>
        <div class="ir"><span class="il">Active</span><span class="iv">${d.active}</span></div>
        <div class="ir"><span class="il">Total Invested</span><span class="iv">${inr(d.buy, true)}</span></div>
        <div class="ir"><span class="il">Total Redeemed</span><span class="iv">${inr(d.sell, true)}</span></div>
        <div class="ir"><span class="il">Net Deployed</span><span class="iv">${inr(profit, true)}</span></div>
      </div>`;
  }

  let planHtml = "";
  for (const [k, v] of Object.entries(summ.planCt)) {
    const badgeCls = k === "Direct" ? "bd" : k === "Regular" ? "brg" : "brd";
    planHtml += `<tr><td><span class="b ${badgeCls}">${k}</span></td><td style="text-align:center;font-weight:600">${v}</td></tr>`;
  }

  let tbl = "";
  for (const fo of data.folios) {
    for (const s of fo.schemes) {
      const t = s.transactions;
      const ba = t.filter(x => x.type === 'buy').reduce((acc, x) => acc + (x.amount || 0), 0);
      const sa = Math.abs(t.filter(x => x.type === 'sell').reduce((acc, x) => acc + (x.amount || 0), 0));
      const act = (s.stated_balance || 0) > 0;
      const cost = s.stated_cost || 0;
      const mval = s.stated_market_value || 0;
      
      let gain = "";
      if (act && cost > 0) {
        const g = ((mval - cost) / cost) * 100;
        const gc = g >= 0 ? "#27ae60" : "#e74c3c";
        gain = `<span style="color:${gc};font-weight:600">${g >= 0 ? '+' : ''}${g.toFixed(1)}%</span>`;
      }
      
      const ab = act ? '<span class="b ba">Active</span>' : '<span class="b br">Redeemed</span>';
      const plan = s.plan || "?";
      const pb = `<span class="b ${plan === "Direct" ? "bd" : "brg"}">${plan}</span>`;
      const okIcon = !s.balance_mismatch ? "&#10004;" : "&#9888;";
      const sells = t.filter(x => x.type === "sell").length;
      const fundDisplay = s.fund_name.length > 55 ? s.fund_name.slice(5, 60) : s.fund_name;
      
      tbl += `
        <tr>
          <td class="mono">${s.isin}</td>
          <td style="font-size:11.5px">${fundDisplay}</td>
          <td>${ab}</td>
          <td>${pb}</td>
          <td style="text-align:center">${t.length}</td>
          <td style="text-align:right">${inr(ba)}</td>
          <td style="text-align:right">${!sells ? "—" : inr(sa)}</td>
          <td style="text-align:right">${!act ? "—" : inr(cost)}</td>
          <td style="text-align:right">${!act ? "—" : inr(mval)}</td>
          <td style="text-align:center">${gain}</td>
          <td style="text-align:center">${okIcon}</td>
        </tr>`;
    }
  }

  const bnrCls = ok ? "ok" : "nok";
  const bnrMsg = ok 
    ? `All ${nTot} checks pass. Data is verified and safe to import.` 
    : `${nOk}/${nTot} checks pass. Review failures before importing.`;

  const schmCount = data.folios.reduce((acc, fo) => acc + fo.schemes.length, 0);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CAS Reconciliation</title>
  ${CSS}
</head>
<body>
  <div class="hdr">
    <h1>&#128202; FolioTracker &mdash; CAS Reconciliation Report</h1>
    <p>${inv?.name || ""} &middot; ${inv?.email || ""} &middot; Period: ${per} &middot; Generated: ${now}</p>
  </div>
  <div class="wrap">
    <div class="cards">
      <div class="card"><div class="val">${stats?.total_schemes || 0}</div><div class="lbl">Schemes</div></div>
      <div class="card"><div class="val">${(stats?.total_transactions || 0).toLocaleString()}</div><div class="lbl">Transactions</div></div>
      <div class="card"><div class="val">${stats?.active_schemes || 0}</div><div class="lbl">Active</div></div>
      <div class="card"><div class="val">${inr(summ.netDeployed, true)}</div><div class="lbl">Net Deployed</div></div>
      <div class="card"><div class="val">${inr(summ.actMval, true)}</div><div class="lbl">Mkt Value</div></div>
    </div>
    
    <div class="sec">
      <h2>&#129514; Reconciliation Checks (${nOk}/${nTot} clean)</h2>
      <div class="bnr ${bnrCls}">${bnrMsg}</div>
      ${chkHtml}
      <details>
        <summary>&#8505;&#65039; Cost Value: ${costNotes.length} scheme diffs explained &mdash; click to expand</summary>
        <div class="leg" style="margin-top:8px">
          <div class="li"><span class="b bx">exact</span> ${catCt.exact || 0} &mdash; matches to the paisa</div>
          <div class="li"><span class="b bs">stamp duty</span> ${catCt.stamp_duty || 0} &mdash; stamp duty excluded (Rs.0.25/Rs.10k)</div>
          <div class="li"><span class="b brd">redeemed</span> ${catCt.redeemed || 0} &mdash; fully redeemed; PDF shows cost=0</div>
          <div class="li"><span class="b bf">FIFO</span> ${catCt.fifo || 0} &mdash; partial redemption: FIFO cost != net cashflow</div>
        </div>
      </details>
    </div>

    <div class="sec">
      <h2>&#128101; Investor Breakdown &mdash; ${Object.keys(summ.investors).length} PAN(s)</h2>
      <div class="ig">${invHtml}</div>
    </div>

    <div class="sec">
      <h2>&#128208; Plan Split</h2>
      <table style="width:auto">
        <thead><tr><th>Plan</th><th>Schemes</th></tr></thead>
        <tbody>${planHtml}</tbody>
      </table>
    </div>

    <div class="sec">
      <h2>&#128203; All Schemes (${schmCount} total)</h2>
      <div class="tw">
        <table>
          <thead>
            <tr>
              <th>ISIN</th><th>Fund</th><th>Status</th><th>Plan</th>
              <th style="text-align:center">Txns</th>
              <th style="text-align:right">Invested</th>
              <th style="text-align:right">Redeemed</th>
              <th style="text-align:right">Cost</th>
              <th style="text-align:right">Mkt Value</th>
              <th style="text-align:center">Gain%</th>
              <th style="text-align:center">Bal&#10003;</th>
            </tr>
          </thead>
          <tbody>${tbl}</tbody>
        </table>
      </div>
    </div>
    
    <p style="text-align:center;color:#bbb;font-size:11px;padding-bottom:24px">
      FolioTracker CAS Reconciliation Engine &middot; Local-first &middot; No cloud &middot; No third-party storage
    </p>
  </div>
</body>
</html>`;
}
