import React, { useState, useEffect } from 'react';
import { Search, Filter, AlertCircle, Download } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';
import { Folio } from '../lib/types';
import { fetchFolios } from '../lib/api';

export function FundsList() {
  const [folios, setFolios] = useState<Folio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // UI State
  const [activeOnly, setActiveOnly] = useState(() => {
    return localStorage.getItem('activeOnlyFunds') === 'true';
  });

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchFolios();
        setFolios(data);
      } catch (err) {
        console.error('FundsList fetch failed:', err);
        setError('Failed to load funds');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    localStorage.setItem('activeOnlyFunds', activeOnly.toString());
  }, [activeOnly]);

  const filteredFolios = activeOnly ? (folios ?? []).filter(f => (f.currentUnits ?? 0) > 0) : (folios ?? []);

  if (!folios) return <div className="p-4 text-gray-500">Loading holdings...</div>;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-8 h-8 border-4 border-[#01696f] border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 font-medium">Loading Funds...</p>
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
        <h3 className="text-lg font-bold">Funds & Folios</h3>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer group">
            <div 
              onClick={() => setActiveOnly(!activeOnly)}
              className={cn(
                "w-10 h-5 rounded-full transition-colors relative",
                activeOnly ? "bg-[#01696f]" : "bg-slate-200"
              )}
            >
              <div className={cn(
                "absolute top-1 w-3 h-3 bg-white rounded-full transition-transform",
                activeOnly ? "translate-x-6" : "translate-x-1"
              )} />
            </div>
            <span className="text-sm font-bold text-slate-600 group-hover:text-[#01696f] transition-colors">Active Only</span>
          </label>
          <div className="flex gap-2">
            <button 
              onClick={() => window.location.href = '/api/export-holdings-csv'}
              className="flex items-center gap-2 px-3 py-2 bg-[#01696f] text-white rounded-lg hover:bg-opacity-90 transition-all text-sm font-bold shadow-sm mr-2"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>
            <button className="p-2 hover:bg-slate-100 rounded-lg"><Filter className="w-5 h-5 text-slate-500" /></button>
            <button className="p-2 hover:bg-slate-100 rounded-lg"><Search className="w-5 h-5 text-slate-500" /></button>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Fund Name</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Units</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">NAV</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Current Value</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Category</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {(filteredFolios ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                  No funds found.
                </td>
              </tr>
            ) : (
              (filteredFolios ?? []).map((folio) => (
                <tr key={folio.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-sm">{folio.fund_name}</p>
                    <p className="text-xs text-slate-500">Folio: {folio.folio_number}</p>
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-medium">
                    {(folio.currentUnits ?? 0).toFixed(3)}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-medium">
                    ₹{(folio.nav ?? 0).toFixed(4)}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-bold text-[#01696f]">
                    {formatCurrency(folio.currentValue)}
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold uppercase text-slate-600">
                      {folio.category || 'Mutual Fund'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
