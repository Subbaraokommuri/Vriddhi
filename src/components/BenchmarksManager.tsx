import React, { useState } from 'react';
import { RefreshCw, Plus, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { fetchAllBenchmarks } from '../lib/api';

interface BenchmarksManagerProps {
  userBenchmarks: any[];
  selectedBenchmarkIds: string[];
  setSelectedBenchmarkIds: (ids: string[]) => void;
  onRefresh: () => void;
}

export function BenchmarksManager({ 
  userBenchmarks, 
  selectedBenchmarkIds, 
  setSelectedBenchmarkIds,
  onRefresh 
}: BenchmarksManagerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRefreshAll = async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchAllBenchmarks();
      onRefresh();
    } catch (err) {
      console.error('Failed to refresh benchmarks:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh benchmark prices');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold">Benchmark Management</h3>
        <div className="flex gap-3">
          <button 
            onClick={handleRefreshAll}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-bold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Refresh All Prices
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-[#01696f] text-white rounded-xl text-sm font-bold hover:bg-[#015a5f] transition-colors">
            <Plus className="w-4 h-4" />
            Add Benchmark
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 rounded-2xl border border-rose-100 flex items-center gap-3 text-rose-700 text-sm font-medium">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Benchmark Name</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Symbol / AMFI</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Source</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Category</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {userBenchmarks.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: b.color || '#01696f' }} />
                      <span className="font-semibold text-sm">{b.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm font-mono text-slate-500">{b.symbol}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold uppercase text-slate-600">
                      {b.source}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 capitalize">{b.category?.replace('_', ' ')}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                      b.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                    )}>
                      {b.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => {
                        if (selectedBenchmarkIds.includes(b.id)) {
                          setSelectedBenchmarkIds(selectedBenchmarkIds.filter(id => id !== b.id));
                        } else if (selectedBenchmarkIds.length < 3) {
                          setSelectedBenchmarkIds([...selectedBenchmarkIds, b.id]);
                        }
                      }}
                      className={cn(
                        "text-xs font-bold px-3 py-1 rounded-lg transition-colors",
                        selectedBenchmarkIds.includes(b.id) 
                          ? "bg-[#01696f] text-white" 
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      )}
                    >
                      {selectedBenchmarkIds.includes(b.id) ? 'Comparing' : 'Compare'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-slate-400 italic">
        Note: TRI (Total Return Index) data includes dividends reinvested and is more accurate for comparison with growth mutual funds.
      </p>
    </div>
  );
}
