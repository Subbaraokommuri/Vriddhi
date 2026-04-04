import React, { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn, formatCurrency, formatPercent } from '../lib/utils';
import { Folio } from '../lib/types';
import { BenchmarkXirrCell } from './BenchmarkXirrCell';
import { fetchFolios, fetchBenchmarks } from '../lib/api';

export function XirrReport() {
  const [folios, setFolios] = useState<Folio[]>([]);
  const [userBenchmarks, setUserBenchmarks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // UI State
  const [activeOnlyXirr, setActiveOnlyXirr] = useState(() => {
    return localStorage.getItem('activeOnlyXirr') !== 'false';
  });
  const [sortKey, setSortKey] = useState(() => {
    return localStorage.getItem('xirrSortKey') || 'xirr';
  });
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    return (localStorage.getItem('xirrSortDir') as 'asc' | 'desc') || 'desc';
  });
  const [selectedBenchmarkIds, setSelectedBenchmarkIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('selectedBenchmarkIds');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [foliosRes, benchmarksRes] = await Promise.all([
          fetchFolios(),
          fetchBenchmarks()
        ]);
        setFolios(foliosRes);
        setUserBenchmarks(benchmarksRes);
      } catch (err) {
        console.error('XirrReport fetch failed:', err);
        setError('Failed to load performance report');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    localStorage.setItem('activeOnlyXirr', activeOnlyXirr.toString());
  }, [activeOnlyXirr]);

  useEffect(() => {
    localStorage.setItem('selectedBenchmarkIds', JSON.stringify(selectedBenchmarkIds));
  }, [selectedBenchmarkIds]);

  useEffect(() => {
    localStorage.setItem('xirrSortKey', sortKey);
  }, [sortKey]);

  useEffect(() => {
    localStorage.setItem('xirrSortDir', sortDir);
  }, [sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'fund_name' ? 'asc' : 'desc');
    }
  };

  const filteredFolios = activeOnlyXirr ? folios.filter(f => (f.currentUnits ?? 0) > 0.001) : folios;

  const sortedFolios = [...filteredFolios].sort((a, b) => {
    let valA: any;
    let valB: any;

    switch (sortKey) {
      case 'fund_name':
        valA = a.fund_name;
        valB = b.fund_name;
        break;
      case 'units':
        valA = a.currentUnits ?? 0;
        valB = b.currentUnits ?? 0;
        break;
      case 'invested':
        valA = a.grossInvested ?? 0;
        valB = b.grossInvested ?? 0;
        break;
      case 'currentValue':
        valA = a.currentValue ?? 0;
        valB = b.currentValue ?? 0;
        break;
      case 'gain':
        valA = (a.currentUnits ?? 0) <= 0.001 ? (a.totalRedeemed ?? 0) - (a.grossInvested ?? 0) : (a.currentValue ?? 0) - (a.grossInvested ?? 0);
        valB = (b.currentUnits ?? 0) <= 0.001 ? (b.totalRedeemed ?? 0) - (b.grossInvested ?? 0) : (b.currentValue ?? 0) - (b.grossInvested ?? 0);
        break;
      case 'xirr':
        valA = a.xirr ?? -Infinity;
        valB = b.xirr ?? -Infinity;
        break;
      default:
        return 0;
    }

    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-8 h-8 border-4 border-[#01696f] border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 font-medium">Loading Performance Report...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 bg-rose-50 text-rose-700 rounded-2xl border border-rose-100 flex items-center gap-3">
        <AlertCircle className="w-6 h-6" />
        <p className="font-bold">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h3 className="text-lg font-bold">Fund-wise Performance</h3>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer group">
            <div 
              onClick={() => setActiveOnlyXirr(!activeOnlyXirr)}
              className={cn(
                "w-10 h-5 rounded-full transition-colors relative",
                activeOnlyXirr ? "bg-[#01696f]" : "bg-slate-200"
              )}
            >
              <div className={cn(
                "absolute top-1 w-3 h-3 bg-white rounded-full transition-transform",
                activeOnlyXirr ? "translate-x-6" : "translate-x-1"
              )} />
            </div>
            <span className="text-sm font-bold text-slate-600 group-hover:text-[#01696f] transition-colors">Active Only</span>
            <span className="text-xs text-slate-400 font-normal">
              ({filteredFolios.length}/{folios.length})
            </span>
          </label>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th 
                className="px-6 py-4 text-xs font-bold text-slate-500 uppercase cursor-pointer hover:text-[#01696f]"
                onClick={() => handleSort('fund_name')}
              >
                Fund Name {sortKey === 'fund_name' && (sortDir === 'asc' ? '↑' : '↓')}
              </th>
              <th 
                className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right cursor-pointer hover:text-[#01696f]"
                onClick={() => handleSort('units')}
              >
                Units {sortKey === 'units' && (sortDir === 'asc' ? '↑' : '↓')}
              </th>
              <th 
                className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right cursor-pointer hover:text-[#01696f]"
                onClick={() => handleSort('invested')}
              >
                Invested {sortKey === 'invested' && (sortDir === 'asc' ? '↑' : '↓')}
              </th>
              <th 
                className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right cursor-pointer hover:text-[#01696f]"
                onClick={() => handleSort('currentValue')}
              >
                Current Value {sortKey === 'currentValue' && (sortDir === 'asc' ? '↑' : '↓')}
              </th>
              <th 
                className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right cursor-pointer hover:text-[#01696f]"
                onClick={() => handleSort('gain')}
              >
                Gain {sortKey === 'gain' && (sortDir === 'asc' ? '↑' : '↓')}
              </th>
              <th 
                className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right cursor-pointer hover:text-[#01696f]"
                onClick={() => handleSort('xirr')}
              >
                Your XIRR {sortKey === 'xirr' && (sortDir === 'asc' ? '↑' : '↓')}
              </th>
              {selectedBenchmarkIds.map(id => (
                <th key={id} className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">
                  {userBenchmarks.find(b => b.id === id)?.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {sortedFolios.length === 0 ? (
              <tr>
                <td colSpan={6 + selectedBenchmarkIds.length} className="px-6 py-12 text-center text-slate-500">
                  No folios found.
                </td>
              </tr>
            ) : (
              sortedFolios.map((folio) => (
                <tr key={folio.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">{folio.fund_name}</p>
                      {(folio.currentUnits ?? 0) <= 0.001 && (
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded border border-slate-200">
                          CLOSED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">Folio: {folio.folio_number}</p>
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-medium">
                    {(folio.currentUnits ?? 0) <= 0.001 ? '—' : (folio.currentUnits ?? 0).toFixed(3)}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-medium">
                    {formatCurrency(folio.grossInvested ?? 0)}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-bold text-[#01696f]">
                    {formatCurrency(folio.currentValue ?? 0)}
                  </td>
                  <td className={cn(
                    "px-6 py-4 text-right tabular-nums text-sm font-semibold",
                    ((folio.currentUnits ?? 0) <= 0.001 
                      ? ((folio.totalRedeemed ?? 0) - (folio.grossInvested ?? 0)) 
                      : ((folio.currentValue ?? 0) - (folio.grossInvested ?? 0))) >= 0 ? "text-emerald-600" : "text-rose-600"
                  )}>
                    {formatCurrency((folio.currentUnits ?? 0) <= 0.001 
                      ? ((folio.totalRedeemed ?? 0) - (folio.grossInvested ?? 0)) 
                      : ((folio.currentValue ?? 0) - (folio.grossInvested ?? 0)))}
                  </td>
                  <td className={cn(
                    "px-6 py-4 text-right tabular-nums text-sm font-bold",
                    folio.xirr && folio.xirr >= 0 ? "text-emerald-600" : "text-rose-600"
                  )}>
                    {formatPercent(folio.xirr)}
                  </td>
                  <BenchmarkXirrCell folioId={folio.id} benchmarkIds={selectedBenchmarkIds} actualXirr={folio.xirr} />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
