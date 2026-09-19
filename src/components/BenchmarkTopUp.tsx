import React, { useState } from 'react';
import { Download, RefreshCw, Loader2, AlertCircle, Check, Copy, Plus, X, Upload } from 'lucide-react';
import { refreshMfBenchmarks } from '../lib/api';
import { MfBenchmarkRefreshResult } from '../lib/types.ts';
import { StaleBenchmark } from '../lib/benchmark-status';

const SITE_URL = 'https://www.niftyindices.com/reports/historical-data';

interface BenchmarkTopUpProps {
  script: string;            // console script covering the user's Nifty TRI benchmarks
  indexCount: number;        // number of Nifty TRI benchmarks the script covers
  staleBenchmarks: StaleBenchmark[];  // benchmarks with old or missing data
  hasMfBenchmarks: boolean;
  onUpdated: () => void;     // called after MF benchmarks were refreshed
  addOpen: boolean;          // add-benchmark panel is open
  onToggleAdd: () => void;
  importing: boolean;        // bulk CSV import in progress
  onImportClick: () => void;
}

export function BenchmarkTopUp({ script, indexCount, staleBenchmarks, hasMfBenchmarks, onUpdated, addOpen, onToggleAdd, importing, onImportClick }: BenchmarkTopUpProps) {
  const [showSteps, setShowSteps] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mfBusy, setMfBusy] = useState(false);
  const [mfResult, setMfResult] = useState<MfBenchmarkRefreshResult | null>(null);
  const [mfError, setMfError] = useState<string | null>(null);

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
    } catch {
      setCopied(false); // the script is shown below, so it can still be copied by hand
    }
  };

  // Clipboard write and window.open both run straight from the click (Safari needs this)
  const handleGetLatest = () => {
    setShowSteps(true);
    setCopied(false);
    const pending = navigator.clipboard?.writeText(script);
    window.open(SITE_URL, '_blank', 'noopener');
    pending?.then(() => setCopied(true)).catch(() => setCopied(false));
  };

  const handleUpdateMf = async () => {
    setMfBusy(true);
    setMfError(null);
    setMfResult(null);
    try {
      const result = await refreshMfBenchmarks();
      setMfResult(result);
      onUpdated();
    } catch (err) {
      setMfError(err instanceof Error ? err.message : 'Failed to update MF benchmarks');
    } finally {
      setMfBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-4" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onToggleAdd}
          style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-text-inverse)' }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors hover:brightness-110 active:brightness-90"
        >
          {addOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {addOpen ? 'Cancel' : 'Add Benchmark'}
        </button>
        <button
          onClick={handleGetLatest}
          disabled={indexCount === 0}
          style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-colors hover:bg-slate-50 disabled:opacity-50"
          title={indexCount === 0 ? 'Add a Nifty TRI benchmark first' : 'Copies a download script and opens niftyindices.com'}
        >
          <Download className="w-4 h-4" />
          Get latest TRI data
        </button>
        <button
          onClick={onImportClick}
          disabled={importing}
          style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-colors hover:bg-slate-50 disabled:opacity-50"
          title="Select CSV files for any Nifty indices — each file's index is detected automatically"
        >
          {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Import CSV files
        </button>
        {hasMfBenchmarks && (
          <button
            onClick={handleUpdateMf}
            disabled={mfBusy}
            style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-colors hover:bg-slate-50 disabled:opacity-50"
            title="Tops up NAV history for every MF benchmark, including funds you don't hold"
          >
            {mfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Update MF benchmarks
          </button>
        )}
      </div>

      {staleBenchmarks.length > 0 && (
        <p className="text-xs text-amber-700 flex items-start gap-1.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            Out of date:{' '}
            {staleBenchmarks.map((b, i) => (
              <span key={i}>
                {i > 0 && ', '}
                <span className="font-semibold">{b.name}</span>
                {b.daysOld === null ? ' (no data)' : ` (${b.daysOld} days old)`}
              </span>
            ))}
            . Use Get latest TRI data + Import CSV files for Nifty indices, or Update MF benchmarks for funds.
          </span>
        </p>
      )}

      {mfError && (
        <p className="text-xs text-rose-600 flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 shrink-0" /> {mfError}
        </p>
      )}
      {mfResult && (
        <div className="text-xs space-y-1">
          <p className="text-slate-600 flex items-center gap-1.5">
            <Check className="w-4 h-4 shrink-0 text-emerald-600" />
            MF benchmarks: {mfResult.updated} updated ({mfResult.rowsAdded.toLocaleString()} new rows), {mfResult.upToDate} already current
            {mfResult.failed.length > 0 && `, ${mfResult.failed.length} failed`}
          </p>
          {mfResult.failed.map((f, i) => (
            <p key={i} className="text-rose-600 pl-5">{f.name}: {f.reason}</p>
          ))}
        </div>
      )}

      {showSteps && (
        <div className="text-xs text-slate-600 space-y-3 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-700">niftyindices.com opened in a new tab. Follow these steps on that tab:</p>
            <button
              onClick={() => setShowSteps(false)}
              className="flex items-center gap-1 text-slate-400 hover:text-slate-600 font-medium"
            >
              <X className="w-3.5 h-3.5" /> Hide steps
            </button>
          </div>
          <ol className="list-decimal list-inside space-y-1.5">
            <li>
              Click <span className="font-semibold">Copy script</span> below (it shows "Copied" when done).
            </li>
            <li>
              Open the console.
              <span className="font-semibold"> Safari:</span> menu Develop → Show JavaScript Console (Option+Cmd+C). If there is no
              Develop menu: Safari → Settings → Advanced → tick "Show features for web developers".
              <span className="font-semibold"> Chrome:</span> Cmd+Option+J, then type <span className="font-mono">allow pasting</span> and press Enter.
            </li>
            <li>Click in the console's input line at the bottom, paste (Cmd+V) and press Enter.</li>
            <li>
              You should see "Vriddhi TRI download script started". Then one CSV per index ({indexCount}) downloads
              to your Downloads folder. Safari may ask to allow downloads: click Allow.
            </li>
            <li>Come back here, click <span className="font-semibold">Import CSV files</span> and select those files.</li>
          </ol>
          <div className="flex items-center gap-2">
            <button
              onClick={copyScript}
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border hover:bg-slate-50"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy script'}
            </button>
            <span className="text-slate-400">If a console error mentions anything other than this script, the wrong text was pasted.</span>
          </div>
          <textarea
            readOnly
            value={script}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full h-28 p-2 font-mono text-[10px] border rounded-lg bg-slate-50"
            style={{ borderColor: 'var(--color-border)' }}
          />
          <p className="text-slate-400">
            The script runs in your own browser, and Vriddhi never contacts niftyindices.com itself. The site's terms
            restrict automated collection, so use it sparingly. It only asks for dates since your last stored day.
          </p>
        </div>
      )}
    </div>
  );
}
