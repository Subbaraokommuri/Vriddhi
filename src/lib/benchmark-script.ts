/**
 * Builds the console script users run in their OWN browser on niftyindices.com to download
 * Total Returns Index CSVs (same format as the site's manual export, so the bulk importer
 * accepts them). The app itself never contacts niftyindices.com.
 */

export interface TriScriptTarget {
  indexName: string;          // benchmark symbol, e.g. 'Nifty 50'
  latestDate: string | null;  // latest stored date 'YYYY-MM-DD', null if no data yet
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Date -> 'DD-Mon-YYYY' (the API's format). */
export function toSiteDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

/** Start of the range to request: latest stored date minus an overlap, or full history. */
export function topUpStartDate(latestDate: string | null, overlapDays = 10): string {
  if (!latestDate) return '01-Jan-1990';
  const d = new Date(`${latestDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return '01-Jan-1990';
  d.setUTCDate(d.getUTCDate() - overlapDays);
  return toSiteDate(d);
}

export function buildTriDownloadScript(targets: TriScriptTarget[], today: Date = new Date()): string {
  const list = (targets ?? []).map(t => ({
    name: String(t.indexName ?? '').toUpperCase().trim(),
    start: topUpStartDate(t.latestDate)
  })).filter(t => t.name.length > 0);

  return `// Vriddhi: download latest Nifty TRI data. Run on https://www.niftyindices.com/reports/historical-data
(async () => {
  console.log('Vriddhi TRI download script started');
  const targets = ${JSON.stringify(list)};
  const end = ${JSON.stringify(toSiteDate(today))};
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const results = [];
  for (const t of targets) {
    try {
      const body = JSON.stringify({ cinfo: JSON.stringify({ name: t.name, startDate: t.start, endDate: end, indexName: t.name }) });
      const res = await fetch('/BackPage/getTotalReturnIndexString', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let data = await res.json();
      if (data && data.d !== undefined) data = typeof data.d === 'string' ? JSON.parse(data.d) : data.d;
      if (!Array.isArray(data) || data.length === 0) { results.push({ index: t.name, status: 'no data', rows: 0 }); continue; }
      const lines = ['"IndexName","Date","Total Returns Index","Net Total Return Index"'];
      for (const r of data) lines.push([t.name, r.Date, r.TotalReturnsIndex, r.NTR_Value || '-'].map(q).join(','));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([lines.join('\\n')], { type: 'text/csv' }));
      a.download = t.name.replace(/[^A-Za-z0-9]+/g, '_') + '_TRI.csv';
      document.body.appendChild(a); a.click(); a.remove();
      results.push({ index: t.name, status: 'downloaded', rows: data.length, from: data[data.length - 1].Date, to: data[0].Date });
    } catch (e) {
      results.push({ index: t.name, status: 'error: ' + e.message, rows: 0 });
    }
    await new Promise(r => setTimeout(r, 600));
  }
  console.table(results);
})();
`;
}
