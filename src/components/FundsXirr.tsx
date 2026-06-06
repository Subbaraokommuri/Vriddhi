import React, { useState, useEffect, useMemo } from 'react';
import { getFundsXirrGrouped, updateNavs, FolioXirrFilters, downloadFundsGroupedCsv, getFoliosBenchmarkXirr, getThemeTags, getOverallXirr, refreshNavAndBenchmarks } from '../lib/api';
import { FundGroupXirr, FolioXirr, FolioBenchmarkXirrResult, GroupBenchmarkXirrResult, OverallXirrResult, OverallBenchmarkXirrResult } from '../lib/types';
import { FundsFilterBar } from './FundsFilterBar';
import { FundGroupRow } from './FundGroupRow';
import { RefreshCw, Loader2, Download, ChevronUp, ChevronDown, ChevronRight, AlertCircle, X, SlidersHorizontal, Target, AlertTriangle } from 'lucide-react';
import { cn, formatCurrency, formatPercent } from '../lib/utils';

interface FundsXirrProps {
  themes: { id: string; name: string }[];
  onNavsUpdated: () => void;
  benchmarks: Array<{ id: string; name: string; symbol: string; is_active: boolean }>;
}

type SortKey = 'fundName' | 'units' | 'investedAmount' | 'currentValue' | 'gainAmount' | 'gainPercent' | 'xirr' | 'nav' | 'navDate' | 'benchmarkXirr' | 'alpha';

export function FundsXirr({ themes, onNavsUpdated, benchmarks }: FundsXirrProps) {
  const [groups, setGroups] = useState<FundGroupXirr[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FolioXirrFilters>({ activeOnly: true, themeId: '', tag: '', investorName: '' });
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [sortCol, setSortCol] = useState<SortKey>('fundName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [updating, setUpdating] = useState(false);
  const [updateErrors, setUpdateErrors] = useState<{ name: string; error: string }[]>([]);
  const [expandedFundIds, setExpandedFundIds] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);

  // Benchmark State variables
  const [selectedBenchmarkSymbol, setSelectedBenchmarkSymbol] = useState<string>('');
  const [benchmarkXirrMap, setBenchmarkXirrMap] = useState<Map<string, FolioBenchmarkXirrResult>>(new Map());
  const [groupBenchmarkXirrMap, setGroupBenchmarkXirrMap] = useState<Map<string, GroupBenchmarkXirrResult>>(new Map());
  const [benchmarkLoading, setBenchmarkLoading] = useState<boolean>(false);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);
  const [overallBenchmarkResult, setOverallBenchmarkResult] = useState<OverallBenchmarkXirrResult | null>(null);

  // Overall XIRR State variables
  const [overallXirr, setOverallXirr] = useState<OverallXirrResult | null>(null);
  const [overallXirrLoading, setOverallXirrLoading] = useState(false);

  useEffect(() => {
    if (filters.themeId) {
      getThemeTags(filters.themeId)
        .then(tags => setAvailableTags(tags))
        .catch(err => {
          console.error("Failed to load theme tags", err);
          setAvailableTags([]);
        });
    } else {
      setAvailableTags([]);
    }
  }, [filters.themeId]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFundsXirrGrouped();
      setGroups(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load funds data');
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
      const fresh = await getFundsXirrGrouped();
      setGroups(fresh);
      onNavsUpdated();
    } catch (err: any) {
      setUpdateErrors([{ name: 'System', error: err.message || String(err) }]);
    } finally {
      setUpdating(false);
    }
  };

  const handleRefreshData = async () => {
    const activeBenchmarkIds = (benchmarks || [])
      .filter((b: any) => b.is_active)
      .map((b: any) => b.id);
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const result = await refreshNavAndBenchmarks(activeBenchmarkIds);
      const benchOk = result.benchmarkResults.length;
      const benchFail = result.benchmarkErrors.length;
      const total = benchOk + benchFail;
      let msg = result.navError ? `NAV update failed. ${result.navError}` : 'NAVs updated.';
      if (total > 0) {
        msg += ` ${benchOk}/${total} benchmark${total !== 1 ? 's' : ''} refreshed.`;
        if (benchFail > 0) msg += ` (${benchFail} failed)`;
      }
      setRefreshMessage(msg);
      setTimeout(() => setRefreshMessage(null), 5000);
      if (onNavsUpdated) onNavsUpdated();
    } catch (err: any) {
      setRefreshMessage('Refresh failed: ' + (err.message || String(err)));
    } finally {
      setRefreshing(false);
    }
  };

  const toggleFund = (fundId: string) => {
    setExpandedFundIds(prev => {
      const next = new Set(prev);
      if (next.has(fundId)) {
        next.delete(fundId);
      } else {
        next.add(fundId);
      }
      return next;
    });
  };

  const filteredGroups = useMemo(() => {
    const result: Array<{ group: FundGroupXirr; visibleFolios: FolioXirr[] }> = [];

    for (const group of groups) {
      // a. Start: let candidateFolios = [...group.folios]
      let candidateFolios = [...group.folios];

      // b. activeOnly filter: if activeOnly === true, filter to f.isActive === true
      if (filters.activeOnly) {
        candidateFolios = candidateFolios.filter(f => f.isActive);
      }

      // c. tag filter: if a tag is selected, filter to f.tags.includes(selectedTag).
      if (filters.tag) {
        candidateFolios = candidateFolios.filter(f => f.tags && f.tags.includes(filters.tag!));
      }

      // Handle pan filter
      if (filters.pan) {
        candidateFolios = candidateFolios.filter(f => f.pan === filters.pan);
      }

      // Handle investorName filter
      if (filters.investorName) {
        const target = filters.investorName.trim().toUpperCase();
        candidateFolios = candidateFolios.filter(
          f => f.investorName?.trim().toUpperCase() === target
        );
      }

      // d. If candidateFolios.length === 0 after (b) and (c): exclude group, continue.
      if (candidateFolios.length === 0) {
        continue;
      }

      // e. Group-level filters (apply to the group as a whole — exclude entire group if not matched):
      if (filters.investorName) {
        const target = filters.investorName.trim().toUpperCase();
        const hasMatch = (group.folios || []).some(
          (f: any) => f.investorName?.trim().toUpperCase() === target
        );
        if (!hasMatch) continue;
      }

      // - search (non-empty)
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const matchesName = (group.clean_name || group.fundName).toLowerCase().includes(searchLower);
        const matchesFolio = candidateFolios.some(f => f.folioNumber.toLowerCase().includes(searchLower));
        if (!matchesName && !matchesFolio) {
          continue;
        }
      }

      // - fundHouse (non-empty)
      if (filters.fundHouse && group.fundHouse !== filters.fundHouse) {
        continue;
      }

      // - category (maps to assetClass)
      if (filters.category && group.assetClass !== filters.category) {
        continue;
      }

      // - subCategory (maps to schemeSubCat)
      if (filters.subCategory && group.schemeSubCat !== filters.subCategory) {
        continue;
      }

      // - plan ('Direct' or 'Regular')
      if (filters.plan && group.plan !== filters.plan) {
        continue;
      }

      // - fundOption ('Growth' or 'IDCW')
      if (filters.fundOption && group.fundOption !== filters.fundOption) {
        continue;
      }

      // f. If group passes all filters: push { group, visibleFolios: candidateFolios }
      result.push({ group, visibleFolios: candidateFolios });
    }

    return result;
  }, [groups, filters]);

  useEffect(() => {
    let active = true;
    const folioIds = filteredGroups.flatMap(g => (g.visibleFolios || g.folios || []).map(f => f.folioId));
    if (folioIds.length === 0) {
      setOverallXirr(null);
      return;
    }

    const fetchOverallXirr = async () => {
      setOverallXirrLoading(true);
      try {
        const result = await getOverallXirr(folioIds);
        if (active) {
          setOverallXirr(result);
        }
      } catch (err) {
        if (active) {
          setOverallXirr(null);
        }
      } finally {
        if (active) {
          setOverallXirrLoading(false);
        }
      }
    };

    fetchOverallXirr();

    return () => {
      active = false;
    };
  }, [filteredGroups]);

  const handleBenchmarkChange = async (symbol: string) => {
    setSelectedBenchmarkSymbol(symbol);
    setBenchmarkXirrMap(new Map());
    setGroupBenchmarkXirrMap(new Map());
    setBenchmarkError(null);
    if (!symbol) {
      setOverallBenchmarkResult(null);
      return;
    }

    // Collect folioIds from currently filtered groups only
    const folioIds = filteredGroups.flatMap(item =>
      item.visibleFolios.map(f => f.folioId)
    );
    if (folioIds.length === 0) {
      setOverallBenchmarkResult(null);
      return;
    }

    setBenchmarkLoading(true);
    try {
      const result = await getFoliosBenchmarkXirr(folioIds, symbol);
      setBenchmarkXirrMap(
        new Map(result.folioResults.map(r => [r.folioId, r]))
      );
      setGroupBenchmarkXirrMap(
        new Map(result.groupResults.map(r => [r.fundId, r]))
      );
      setOverallBenchmarkResult(result.overallResult ?? null);
    } catch (err) {
      setBenchmarkError('Benchmark XIRR calculation failed. Try again.');
      setOverallBenchmarkResult(null);
    } finally {
      setBenchmarkLoading(false);
    }
  };

  useEffect(() => {
    if (selectedBenchmarkSymbol) {
      handleBenchmarkChange(selectedBenchmarkSymbol);
    }
  }, [filteredGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedGroups = useMemo(() => {
    const sorted = [...filteredGroups].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortCol) {
        case 'fundName':
          aVal = a.group.simple_name || a.group.clean_name || a.group.fundName;
          bVal = b.group.simple_name || b.group.clean_name || b.group.fundName;
          break;
        case 'units':
          aVal = a.group.totalUnits;
          bVal = b.group.totalUnits;
          break;
        case 'investedAmount':
          aVal = a.group.totalInvested;
          bVal = b.group.totalInvested;
          break;
        case 'currentValue':
          aVal = a.group.totalCurrentValue;
          bVal = b.group.totalCurrentValue;
          break;
        case 'gainAmount':
          aVal = a.group.gainAmount;
          bVal = b.group.gainAmount;
          break;
        case 'gainPercent':
          aVal = a.group.gainPercent;
          bVal = b.group.gainPercent;
          break;
        case 'xirr':
          aVal = a.group.groupXirr;
          bVal = b.group.groupXirr;
          break;
        case 'nav':
          aVal = a.group.folios[0]?.nav ?? null;
          bVal = b.group.folios[0]?.nav ?? null;
          break;
        case 'navDate':
          aVal = a.group.folios[0]?.navDate ?? null;
          bVal = b.group.folios[0]?.navDate ?? null;
          break;
        case 'benchmarkXirr': {
          const aRes = groupBenchmarkXirrMap.get(a.group.fundId);
          const bRes = groupBenchmarkXirrMap.get(b.group.fundId);
          aVal = aRes && aRes.benchmarkXirr !== null && aRes.benchmarkXirr !== undefined ? aRes.benchmarkXirr : null;
          bVal = bRes && bRes.benchmarkXirr !== null && bRes.benchmarkXirr !== undefined ? bRes.benchmarkXirr : null;
          break;
        }
        case 'alpha': {
          const aRes = groupBenchmarkXirrMap.get(a.group.fundId);
          const bRes = groupBenchmarkXirrMap.get(b.group.fundId);
          aVal = aRes && aRes.alpha !== null && aRes.alpha !== undefined ? aRes.alpha : null;
          bVal = bRes && bRes.alpha !== null && bRes.alpha !== undefined ? bRes.alpha : null;
          break;
        }
        default:
          aVal = a.group.totalCurrentValue;
          bVal = b.group.totalCurrentValue;
      }

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredGroups, sortCol, sortDir, groupBenchmarkXirrMap]);

  const fundHouses = useMemo(() => 
    [...new Set(groups.map(g => g.fundHouse).filter(Boolean))].sort(), 
  [groups]);

  const categories = useMemo(() => 
    [...new Set(groups.map(g => g.assetClass).filter(Boolean))].sort(), 
  [groups]);

  const pans = useMemo(() => {
    const allPans = groups.flatMap(g => g.folios.map(f => f.pan));
    return [...new Set(allPans.filter(Boolean))].sort();
  }, [groups]);

  const uniqueInvestorNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    (groups || []).forEach((group: any) => {
      (group.folios || []).forEach((folio: any) => {
        if (folio.investorName) {
          const key = folio.investorName.trim().toUpperCase();
          if (!seen.has(key)) {
            seen.add(key);
            names.push(folio.investorName.trim());
          }
        }
      });
    });
    return names.sort();
  }, [groups]);

  const subCategories = useMemo(() => {
    const source = filters.category
      ? groups.filter(g => g.assetClass === filters.category)
      : groups;
    return [...new Set(source.map(g => g.schemeSubCat).filter(Boolean))].sort();
  }, [groups, filters.category]);

  const handleSort = (key: SortKey) => {
    if ((key === 'benchmarkXirr' || key === 'alpha') && !selectedBenchmarkSymbol) {
      return;
    }
    if (sortCol === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(key);
      setSortDir((key === 'benchmarkXirr' || key === 'alpha') ? 'desc' : 'asc');
    }
  };

  const totals = useMemo(() => {
    let totalInvested = 0;
    let totalCurrentValue = 0;
    let totalGainAmount = 0;

    for (const item of filteredGroups) {
      totalInvested += item.group.totalInvested || 0;
      totalCurrentValue += item.group.totalCurrentValue || 0;
      totalGainAmount += item.group.gainAmount || 0;
    }

    const totalGainPercent = totalInvested > 0 ? (totalGainAmount / totalInvested) : null;

    return {
      totalInvested,
      totalCurrentValue,
      totalGainAmount,
      totalGainPercent
    };
  }, [filteredGroups]);

  const totalVisibleFolios = filteredGroups.reduce(
    (sum, item) => sum + item.visibleFolios.length, 0
  );

  if (loading && groups.length === 0) {
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
          <span className="text-sm text-slate-400 font-normal">
            {filteredGroups.length} funds ({totalVisibleFolios} folios)
          </span>
          {benchmarkLoading && (
            <span className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <span className="w-3 h-3 border-2 border-[#01696f] border-t-transparent rounded-full animate-spin" />
              Recalculating benchmark XIRR...
            </span>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadFundsGroupedCsv({
                search: filters.search,
                fundHouse: filters.fundHouse,
                category: filters.category,
                plan: filters.plan,
                fundOption: filters.fundOption,
                activeOnly: filters.activeOnly,
              })}
              className="flex items-center gap-2 px-4 py-2 bg-[#01696f] hover:bg-[#014f53] text-white rounded-xl text-sm font-semibold transition-colors"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            <button
              onClick={handleRefreshData}
              disabled={refreshing}
              className="flex flex-col items-center justify-center gap-0.5 px-4 py-1 bg-[#01696f] text-white rounded-xl text-sm font-bold hover:bg-[#014f53] transition-all disabled:opacity-50"
            >
              <span className="flex items-center gap-2">
                {refreshing
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <RefreshCw className="w-4 h-4" />}
                Refresh Data
              </span>
              <span className="text-[9px] font-normal opacity-80 leading-none">
                NAV + Benchmarks
              </span>
            </button>
          </div>
          {refreshMessage && (
            <span className="text-[10px] text-slate-500 max-w-[220px] text-right leading-tight">
              {refreshMessage}
            </span>
          )}
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

      {/* PANEL 1 — "Filters" */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden select-none">
        <button
          onClick={() => setFiltersOpen(!filtersOpen)}
          className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-50 transition-colors focus:outline-none"
        >
          <div className="flex items-center gap-2">
            {filtersOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
            <SlidersHorizontal className="w-4 h-4 text-slate-500" />
            <span className="font-medium text-sm text-slate-700 uppercase tracking-wide">Search & Filter</span>
          </div>
        </button>
        {filtersOpen && (
          <div className="p-5 border-t border-slate-100 bg-white">
            <FundsFilterBar 
              filters={filters} 
              onChange={setFilters} 
              themes={themes}
              fundHouses={fundHouses}
              categories={categories}
              pans={pans}
              subCategories={subCategories}
              availableTags={availableTags}
              investorNames={uniqueInvestorNames}
            />
          </div>
        )}
      </div>

      {/* PANEL 2 — "Benchmark" */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden select-none">
        <button
          onClick={() => setBenchmarkOpen(!benchmarkOpen)}
          className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-50 transition-colors focus:outline-none"
        >
          <div className="flex items-center gap-2">
            {benchmarkOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
            <Target className="w-4 h-4 text-slate-500" />
            <span className="font-medium text-sm text-slate-700 uppercase tracking-wide">Benchmark</span>
          </div>
        </button>
        {benchmarkOpen && (
          <div className="p-5 border-t border-slate-100 bg-white flex items-center gap-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Select Benchmark:</span>
            <select
              value={selectedBenchmarkSymbol}
              onChange={(e) => handleBenchmarkChange(e.target.value)}
              className="min-w-[220px] max-w-sm pl-3 pr-10 py-1.5 text-sm border border-slate-200 bg-slate-50 rounded-lg focus:outline-none focus:ring-[#01696f] focus:border-[#01696f]"
            >
              <option value="">None</option>
              {benchmarks.filter(b => b.is_active).map(b => (
                <option key={b.id} value={b.symbol}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {benchmarkError && (
        <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <p className="text-sm font-semibold text-rose-800">{benchmarkError}</p>
          <button 
            onClick={() => handleBenchmarkChange(selectedBenchmarkSymbol)} 
            className="ml-auto px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-xs"
          >
            Retry
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <HeaderCell label="FUND NAME & FOLIO" sortKey="fundName" currentSort={sortCol} dir={sortDir} onSort={handleSort} />
                <HeaderCell label="NAV" sortKey="nav" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="UNITS" sortKey="units" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="INVESTED" sortKey="investedAmount" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="CURRENT VALUE" sortKey="currentValue" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="GAIN ₹" sortKey="gainAmount" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="GAIN %" sortKey="gainPercent" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                <HeaderCell label="XIRR" sortKey="xirr" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                {selectedBenchmarkSymbol && (
                  <>
                    <HeaderCell label="BENCHMARK XIRR" sortKey="benchmarkXirr" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                    <HeaderCell label="ALPHA" sortKey="alpha" currentSort={sortCol} dir={sortDir} onSort={handleSort} align="right" />
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedGroups.length === 0 ? (
                <tr>
                  <td colSpan={selectedBenchmarkSymbol ? 10 : 8} className="px-6 py-12 text-center">
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
                <>
                  {sortedGroups.map((item) => (
                    <FundGroupRow 
                      key={item.group.fundId} 
                      group={item.group} 
                      visibleFolios={item.visibleFolios}
                      isExpanded={expandedFundIds.has(item.group.fundId)}
                      onToggle={() => toggleFund(item.group.fundId)}
                      themes={themes}
                      onTagsChanged={loadData}
                      benchmarkResult={groupBenchmarkXirrMap.get(item.group.fundId)}
                      foliosBenchmarkMap={benchmarkXirrMap}
                      benchmarkLoading={benchmarkLoading}
                      isBenchmarkActive={!!selectedBenchmarkSymbol}
                    />
                  ))}
                  {/* Summary Footer Row */}
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-t-2 border-slate-300 dark:border-slate-600 font-semibold text-slate-900 dark:text-slate-100">
                    <td className="px-6 py-4 text-sm font-semibold">
                      Portfolio Total
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-slate-400 font-normal">
                      —
                    </td>
                    <td className="px-6 py-4 text-right text-sm text-slate-400 font-normal">
                      —
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold text-slate-600 dark:text-slate-300">
                      {formatCurrency(totals.totalInvested)}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {formatCurrency(totals.totalCurrentValue)}
                    </td>
                    <td className={cn("px-6 py-4 text-right tabular-nums text-sm font-bold", totals.totalGainAmount >= 0 ? "text-emerald-600" : "text-rose-600")}>
                      {formatCurrency(totals.totalGainAmount)}
                    </td>
                    <td className={cn("px-6 py-4 text-right tabular-nums text-sm font-bold", totals.totalGainPercent !== null && totals.totalGainPercent >= 0 ? "text-emerald-600" : "text-rose-600")}>
                      {totals.totalGainPercent === null ? "—" : formatPercent(totals.totalGainPercent)}
                    </td>
                    <td className={cn("px-6 py-4 text-right tabular-nums text-sm font-bold")}>
                      {overallXirrLoading ? (
                        <span className="text-slate-400 animate-pulse">…</span>
                      ) : overallXirr && overallXirr.xirr !== null ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className={overallXirr.xirr >= 0 ? "text-emerald-600" : "text-rose-600"}>
                            {formatPercent(overallXirr.xirr)}
                          </span>
                          {overallXirr.xirrWarning && (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" title="Overall XIRR may be unreliable" />
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 font-normal">—</span>
                      )}
                    </td>
                    {selectedBenchmarkSymbol && (
                      <>
                        <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                          {benchmarkLoading ? (
                            <span className="text-slate-400 animate-pulse">…</span>
                          ) : overallBenchmarkResult && overallBenchmarkResult.benchmarkXirr !== null ? (
                            <div className="flex items-center justify-end gap-1">
                              <span className={cn(overallBenchmarkResult.benchmarkXirr >= 0 ? "text-emerald-600" : "text-rose-600")}>
                                {formatPercent(overallBenchmarkResult.benchmarkXirr)}
                              </span>
                              {overallBenchmarkResult.benchmarkXirrWarning && (
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" title="Overall benchmark XIRR may be unreliable" />
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 font-normal">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right tabular-nums text-sm font-semibold">
                          {benchmarkLoading ? (
                            <span className="text-slate-400 animate-pulse">…</span>
                          ) : overallBenchmarkResult && overallBenchmarkResult.alpha !== null ? (
                            <span className={cn(
                              "font-bold",
                              overallBenchmarkResult.alpha > 0 
                                ? "text-emerald-600" 
                                : overallBenchmarkResult.alpha < 0 
                                  ? "text-rose-600" 
                                  : "text-slate-500"
                            )}>
                              {overallBenchmarkResult.alpha > 0 ? "+" : ""}
                              {formatPercent(overallBenchmarkResult.alpha)}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal">—</span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                </>
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
