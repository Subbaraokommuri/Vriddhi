import React, { useState, useEffect, useMemo } from 'react';
import { getFoliosXirr, updateNavs, FolioXirrFilters } from '../lib/api';
import { FolioXirr } from '../lib/types';
import { FundsFilterBar } from './FundsFilterBar';
import { FundRow } from './FundRow';
import { RefreshCw, Download, ChevronUp, ChevronDown, AlertCircle, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface FundsXirrProps {
  themes: any[];
  onNavsUpdated: () => void;
}

type SortKey = 'fundName' | 'units' | 'investedAmount' | 'currentValue' | 'gainAmount' | 'gainPercent' | 'xirr' | 'nav' | 'navDate';

export function FundsXirr({ themes, onNavsUpdated }: FundsXirrProps) {
  const [allFolios, setAllFolios] = useState<FolioXirr[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FolioXirrFilters>({ activeOnly: true });
  const [sortCol, setSortCol] = useState<SortKey>('fundName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [updating, setUpdating] = useState(false);
  const [updateErrors, setUpdateErrors] = useState<{ name: string; error: string }[]>([]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFoliosXirr();
      setAllFolios(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load folios data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleUpdateNavs = async () => {
    setUpdating(true);
    setUpdateErrors([]);
    try {
      const result = await updateNavs();
      if (result.errors && result.errors.length > 0) {
        setUpdateErrors(result.errors.map(e => ({ name: e.name, error: e.error })));
      }
      const fresh = await getFoliosXirr();
      setAllFolios(fresh);
      onNavsUpdated();
    } catch (err: any) {
      setUpdateErrors([{ name: 'System', error: err.message || String(err) }]);
    } finally {
      setUpdating(false);
    }
  };

  const filteredFolios = useMemo(() => {
    return allFolios.filter(f => {
      if (filters.activeOnly && !f.isActive) return false;
      if (filters.plan && f.plan !== filters.plan) return false;
      if (filters.fundOption && f.fundOption !== filters.fundOption) return false;
      if (filters.category && !f.category?.toLowerCase().includes(filters.category.toLowerCase())) return false;
      if (filters.fundHouse && !f.fundName.toLowerCase().includes(filters.fundHouse.toLowerCase())) return false;
      if (filters.search) {
        const s = filters.search.toLowerCase();
        if (!f.fundName.toLowerCase().includes(s) && !f.folioNumber.toLowerCase().includes(s)) return false;
      }
      if (filters.tag) {
        if (!f.tags.includes(filters.tag)) return false;
      }
      return true;
    });
  }, [allFolios, filters]);

  const sortedFolios = useMemo(() => {
    const sorted = [...filteredFolios].sort((a, b) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];

      if (aVal === null) return 1;
      if (bVal === null) return -1;

      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredFolios, sortCol, sortDir]);

  const fundHouses = useMemo(() => [...new Set(allFolios.map(f => f.fundHouse).filter(Boolean))].sort(), [allFolios]);
  const categories = useMemo(() => [...new Set(allFolios.map(f => f.category).filter(Boolean))].sort(), [allFolios]);

  const handleSort = (key: SortKey) => {
    if (sortCol === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(key);
      setSortDir('asc');
    }
  };

  if (loading && allFolios.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-8 h-8 border-4 border-[#01696f] border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 font-medium">Loading holdings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-bold text-slate-800">Funds & Folios</h2>
          <span className="text-sm text-slate-400">
            {filteredFolios.filter(f => f.isActive).length} active / {allFolios.length} total
          </span>
        </div>

        <div className="flex items-center gap-2">
          <a 
            href="/api/export-holdings-csv" 
            download
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </a>
          <button
            onClick={handleUpdateNavs}
            disabled={updating}
            className="flex items-center gap-2 px-4 py-2 bg-[#01696f] hover:bg-[#0c4e54] text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", updating && "animate-spin")} />
            {updating ? 'Updating...' : 'Update NAVs'}
          </button>
        </div>
      </div>

      {updateErrors.length > 0 && (
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 relative pr-12">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-rose-800 mb-1">NAV Update Partial Failures</p>
              <ul className="text-xs text-rose-700 space-y-1 list-disc list-inside">
                {updateErrors.map((err, i) => (
                  <li key={i}><span className="font-semibold">{err.name}:</span> {err.error}</li>
                ))}
              </ul>
            </div>
          </div>
          <button 
            onClick={() => setUpdateErrors([])}
            className="absolute top-4 right-4 p-1 text-rose-400 hover:text-rose-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 p-6 rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-6 h-6 text-rose-600" />
            <p className="text-rose-700 font-bold">{error}</p>
          </div>
          <button 
            onClick={loadData}
            className="px-4 py-2 bg-rose-600 text-white font-bold rounded-xl hover:bg-rose-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      <FundsFilterBar 
        filters={filters} 
        onChange={setFilters} 
        themes={themes}
        fundHouses={fundHouses}
        categories={categories}
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <HeaderCell label="FUND NAME & FOLIO" sortKey="fundName" currentSort={sortCol} dir={sortDir} onSort={handleSort} />
                <HeaderCell label="UNITS" sortKey="units" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="INVESTED" sortKey="investedAmount" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="CURRENT VALUE" sortKey="currentValue" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="GAIN ₹" sortKey="gainAmount" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="GAIN %" sortKey="gainPercent" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="XIRR" sortKey="xirr" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="NAV" sortKey="nav" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="LAST UPDATED" sortKey="navDate" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider">TAGS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedFolios.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center">
                    <p className="text-slate-400 font-medium">No funds match your filters.</p>
                    <button 
                      onClick={() => setFilters({ activeOnly: true })}
                      className="mt-3 text-sm font-bold text-[#01696f] hover:underline"
                    >
                      Clear Filters
                    </button>
                  </td>
                </tr>
              ) : (
                sortedFolios.map((folio: FolioXirr) => (
                  <FundRow 
                    key={folio.folioId} 
                    folio={folio} 
                    themes={themes} 
                    onTagsChanged={() => { loadData(); }} 
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface HeaderCellProps {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right';
}

function HeaderCell({ label, sortKey, currentSort, dir, onSort, align = 'left' }: HeaderCellProps) {
  const active = currentSort === sortKey;
  return (
    <th 
      className={cn(
        "px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100/50 transition-colors",
        align === 'right' && "text-right"
      )}
      onClick={() => onSort(sortKey)}
    >
      <div className={cn("flex items-center gap-1", align === 'right' && "justify-end")}>
        {label}
        <div className="w-3">
          {active && (dir === 'asc' ? <ChevronUp className="w-3 h-3 text-[#01696f]" /> : <ChevronDown className="w-3 h-3 text-[#01696f]" />)}
        </div>
      </div>
    </th>
  );
}
