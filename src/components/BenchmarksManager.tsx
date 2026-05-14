import React, { useState, useEffect, useRef } from 'react';
import { Plus, AlertCircle, Trash2, Check, X, Loader2, Upload, Download } from 'lucide-react';
import { cn } from '../lib/utils';
import { fetchBenchmarks, addUserBenchmark, deleteUserBenchmark, importBenchmarkCsv, getBenchmarkDataSummary, fetchBenchmarkData } from '../lib/api';

interface Benchmark {
  id: string;
  symbol: string;
  name: string;
  source: string;
  category: string;
  color: string;
  is_active: number;
}

interface BenchmarkSummary {
  oldest: string;
  latest: string;
  count: number;
}

interface BenchmarksManagerProps {
  userBenchmarks?: Benchmark[];
  onRefresh?: () => void;
}

export function BenchmarksManager({ 
  userBenchmarks: propBenchmarks, 
  onRefresh 
}: BenchmarksManagerProps) {
  const [userBenchmarks, setUserBenchmarks] = useState<Benchmark[]>(propBenchmarks || []);
  const [loading, setLoading] = useState(!propBenchmarks || propBenchmarks.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, BenchmarkSummary | null>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedBenchmarkForUpload, setSelectedBenchmarkForUpload] = useState<string | null>(null);

  // Add Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSymbol, setNewSymbol] = useState('');
  const [newName, setNewName] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  // Sync prop benchmarks to local state
  useEffect(() => {
    if (propBenchmarks && propBenchmarks.length > 0) {
      setUserBenchmarks(propBenchmarks);
      setLoading(false);
    }
  }, [propBenchmarks]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBenchmarks();
      setUserBenchmarks(data);
      // Fetch summaries for each benchmark
      const summaryPromises = data.map(b => getBenchmarkDataSummary(b.id));
      const summaryResults = await Promise.all(summaryPromises);
      const newSummaries: Record<string, BenchmarkSummary | null> = {};
      data.forEach((b, i) => {
        newSummaries[b.id] = summaryResults[i];
      });
      setSummaries(newSummaries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load benchmarks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRefreshSummary = async (id: string) => {
    try {
      const summary = await getBenchmarkDataSummary(id);
      setSummaries(prev => ({ ...prev, [id]: summary }));
    } catch (err) {
      console.error('Failed to refresh summary:', err);
    }
  };

  const handleAddBenchmark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbol || !newName) return;
    
    setAddLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await addUserBenchmark({
        symbol: newSymbol.toUpperCase().trim(),
        name: newName,
        source: 'niftyindices',
        category: 'equity',
        color: '#01696f'
      });
      setNewSymbol('');
      setNewName('');
      setShowAddForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add benchmark');
    } finally {
      setAddLoading(false);
    }
  };

  const handleImportClick = (benchmarkId: string) => {
    setSelectedBenchmarkForUpload(benchmarkId);
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedBenchmarkForUpload) return;

    setUploadingId(selectedBenchmarkForUpload);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await importBenchmarkCsv(selectedBenchmarkForUpload, file);
      setSuccessMessage(`Imported ${result.inserted} rows (${result.skipped} skipped)`);
      setTimeout(() => setSuccessMessage(null), 4000);
      await handleRefreshSummary(selectedBenchmarkForUpload);
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import CSV');
    } finally {
      setUploadingId(null);
      setSelectedBenchmarkForUpload(null);
      if (e.target) e.target.value = '';
    }
  };

  const handleAutoFetch = async (benchmarkId: string) => {
    setFetchingId(benchmarkId);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await fetchBenchmarkData(benchmarkId);
      setSuccessMessage(`Fetched ${result.inserted} new rows`);
      setTimeout(() => setSuccessMessage(null), 4000);
      await handleRefreshSummary(benchmarkId);
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch benchmark data');
    } finally {
      setFetchingId(null);
    }
  };

  const handleDelete = async (benchmark: Benchmark) => {
    if (!window.confirm(`Are you sure you want to delete "${benchmark.name}"?`)) return;

    setError(null);
    try {
      await deleteUserBenchmark(benchmark.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete benchmark');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div 
          className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" 
          style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
        />
        <p style={{ color: 'var(--color-text-muted)' }} className="font-medium">Loading Benchmarks...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold">Benchmark Management</h3>
        <div className="flex gap-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".csv"
            className="hidden"
          />
          <button 
            onClick={() => setShowAddForm(!showAddForm)}
            style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-text-inverse)' }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors hover:brightness-110 active:brightness-90"
          >
            {showAddForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showAddForm ? 'Cancel' : 'Add Benchmark'}
          </button>
        </div>
      </div>

      {error && (
        <div 
          style={{ backgroundColor: 'var(--color-error-highlight)', color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
          className="p-4 rounded-2xl border flex items-center gap-3 text-sm font-medium"
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div 
          style={{ backgroundColor: 'var(--color-success-highlight)', color: 'var(--color-success)', borderColor: 'var(--color-success)' }}
          className="p-4 rounded-2xl border flex items-center gap-3 text-sm font-medium"
        >
          <Check className="w-5 h-5 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      <div 
        className="bg-white rounded-2xl shadow-sm border overflow-hidden"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead style={{ backgroundColor: 'var(--color-surface-offset)', borderBottomColor: 'var(--color-border)' }} className="border-b">
              <tr>
                <th className="px-6 py-4 text-xs font-bold uppercase" style={{ color: 'var(--color-text-muted)' }}>Benchmark Name</th>
                <th className="px-6 py-4 text-xs font-bold uppercase" style={{ color: 'var(--color-text-muted)' }}>Data</th>
                <th className="px-6 py-4 text-xs font-bold uppercase text-right" style={{ color: 'var(--color-text-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ divideColor: 'var(--color-border)' }}>
              {showAddForm && (
                <tr style={{ backgroundColor: 'var(--color-surface-offset)' }}>
                  <td className="px-6 py-4">
                    <input
                      type="text"
                      placeholder="Display Name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-1"
                      style={{ borderColor: 'var(--color-border)', focusRingColor: 'var(--color-primary)' }}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <input
                      type="text"
                      placeholder="Index Name (e.g. NIFTY 50)"
                      value={newSymbol}
                      onChange={(e) => setNewSymbol(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono border rounded-lg focus:outline-none focus:ring-1"
                      style={{ borderColor: 'var(--color-border)', focusRingColor: 'var(--color-primary)' }}
                    />
                    <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      Exact name from niftyindices.com — e.g. NIFTY 50, NIFTY NEXT 50, NIFTY BANK
                    </p>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={handleAddBenchmark}
                      disabled={addLoading || !newSymbol || !newName}
                      className="p-2 rounded-lg text-white disabled:opacity-50"
                      style={{ backgroundColor: 'var(--color-primary)' }}
                    >
                      {addLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              )}

              {userBenchmarks.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: b.color || 'var(--color-primary)' }} />
                      <span className="font-semibold text-sm">{b.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span 
                        className="text-xs font-bold"
                        style={{ color: summaries[b.id] ? 'var(--color-success)' : 'var(--color-text-muted)' }}
                      >
                        {summaries[b.id] ? `${summaries[b.id]?.count.toLocaleString()} rows` : 'No data yet'}
                      </span>
                      {summaries[b.id] && (
                        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                          up to {new Date(summaries[b.id]!.latest).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleAutoFetch(b.id)}
                        disabled={fetchingId === b.id || uploadingId === b.id}
                        className="p-1 px-2 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
                        style={{ color: 'var(--color-primary)' }}
                        title="Auto-Fetch from NiftyIndices"
                      >
                        {fetchingId === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleImportClick(b.id)}
                        disabled={uploadingId === b.id || fetchingId === b.id}
                        className="p-1 px-2 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
                        style={{ color: 'var(--color-primary)' }}
                        title="Import CSV"
                      >
                        {uploadingId === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleDelete(b)}
                        className="p-1 px-2 rounded-lg text-rose-500 hover:bg-rose-50 transition-colors disabled:opacity-50"
                        title="Delete Benchmark"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs italic" style={{ color: 'var(--color-text-muted)' }}>
        Note: TRI (Total Return Index) data includes dividends reinvested and is more accurate for comparison with growth mutual funds.
      </p>
    </div>
  );
}
