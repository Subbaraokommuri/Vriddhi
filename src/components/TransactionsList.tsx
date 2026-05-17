import React, { useState, useEffect } from 'react';
import { Filter, AlertCircle, ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn, formatCurrency, formatFundName } from '../lib/utils';
import { Transaction, TransactionFilters } from '../lib/types';
import { getTransactions, getTransactionFundsList } from '../lib/api';

export function TransactionsList() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [fundsList, setFundsList] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<TransactionFilters>({});
  
  const loadData = async (currentFilters?: TransactionFilters) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTransactions(currentFilters);
      setTransactions(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const [funds] = await Promise.all([
          getTransactionFundsList(),
          loadData()
        ]);
        setFundsList(funds);
      } catch (err: any) {
        setError(err.message || 'Initialization failed');
      }
    };
    init();
  }, []);

  const handleApplyFilters = () => {
    loadData(filters);
  };

  const handleClearFilters = () => {
    const cleared = {};
    setFilters(cleared);
    loadData(cleared);
  };

  if (loading && transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-8 h-8 border-4 border-[#01696f] border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 font-medium">Loading Transactions...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-lg font-bold">Transaction History</h3>
          <div className="flex gap-2">
            <button 
              onClick={() => setFiltersOpen(!filtersOpen)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors",
                filtersOpen ? "bg-[#01696f] text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-700"
              )}
            >
              <Filter className="w-4 h-4" />
              Filters
              {filtersOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {filtersOpen && (
          <div className="p-6 bg-slate-50 border-b border-slate-200 animate-in fade-in slide-in-from-top-4 duration-200">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Date From</label>
                <input 
                  type="date" 
                  value={filters.dateFrom || ''}
                  onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696f]/20"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Date To</label>
                <input 
                  type="date" 
                  value={filters.dateTo || ''}
                  onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696f]/20"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Type</label>
                <div className="flex bg-white p-1 rounded-xl border border-slate-200">
                  {['all', 'buy', 'sell'].map((type) => (
                    <button
                      key={type}
                      onClick={() => setFilters({ ...filters, type: type === 'all' ? undefined : type as 'buy' | 'sell' })}
                      className={cn(
                        "flex-1 py-1 text-xs font-bold rounded-lg transition-colors capitalize",
                        (type === 'all' && !filters.type) || filters.type === type
                          ? "bg-[#01696f] text-white"
                          : "text-slate-500 hover:bg-slate-50"
                      )}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fund</label>
                <select 
                  value={filters.fundId || ''}
                  onChange={(e) => setFilters({ ...filters, fundId: e.target.value || undefined })}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696f]/20"
                >
                  <option value="">All Funds</option>
                  {fundsList.map(fund => (
                    <option key={fund.id} value={fund.id}>{formatFundName(fund.name)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Folio</label>
                <input 
                  type="text" 
                  placeholder="Folio number..."
                  value={filters.folio || ''}
                  onChange={(e) => setFilters({ ...filters, folio: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696f]/20"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Min Amount</label>
                <input 
                  type="number" 
                  placeholder="₹ Min"
                  value={filters.amountMin || ''}
                  onChange={(e) => setFilters({ ...filters, amountMin: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696f]/20"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Max Amount</label>
                <input 
                  type="number" 
                  placeholder="₹ Max"
                  value={filters.amountMax || ''}
                  onChange={(e) => setFilters({ ...filters, amountMax: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#01696f]/20"
                />
              </div>
              <div className="flex items-end gap-2">
                <button 
                  onClick={handleApplyFilters}
                  disabled={loading}
                  className="flex-1 bg-[#01696f] hover:bg-[#014f54] text-white py-2 rounded-xl text-sm font-bold transition-colors disabled:opacity-50"
                >
                  {loading ? 'Applying...' : 'Apply Filters'}
                </button>
                <button 
                  onClick={handleClearFilters}
                  className="px-3 py-2 text-slate-400 hover:text-slate-600 font-bold text-sm transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="p-6 bg-rose-50 text-rose-700 border-b border-rose-100 flex items-center gap-3">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm font-bold">{error}</p>
          </div>
        )}

        <div className="overflow-x-auto">
          {transactions.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              {loading ? 'Fetching transactions...' : 'No transactions match your filters.'}
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Date</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Fund / Folio</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Type</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Amount</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Units</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">NAV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {transactions.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-slate-600">
                      {new Date(t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-sm truncate max-w-xs" title={t.fund_name}>
                        {formatFundName(t.fund_name)}
                      </p>
                      <p className="text-xs text-slate-500">Folio: {t.folio_number}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        t.transaction_type === 'buy' ? "bg-emerald-100 text-emerald-700" : 
                        t.transaction_type === 'sell' ? "bg-rose-100 text-rose-700" : "bg-blue-100 text-blue-700"
                      )}>
                        {t.transaction_type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-sm font-bold">
                      {formatCurrency(t.amount)}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-sm font-medium text-slate-600">
                      {t.units.toFixed(3)}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-sm font-medium text-slate-600">
                      ₹{t.nav.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
