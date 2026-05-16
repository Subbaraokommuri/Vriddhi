import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, AlertCircle, Trash2, Check, X, Loader2, Upload, Download, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { 
  fetchBenchmarks, 
  addUserBenchmark, 
  deleteUserBenchmark, 
  importBenchmarkCsv, 
  getBenchmarkDataSummary, 
  fetchBenchmarkData,
  searchAmfiMetadata,
  refreshAmfiMetadata,
  getAmfiMetadataStatus,
  getAmfiFundHouses
} from '../lib/api';
import { CONFIG } from '../../lib/config.ts';
import { NiftyTRIEntry, UserBenchmark } from '../lib/types.ts';

interface BenchmarkSummary {
  oldest: string;
  latest: string;
  count: number;
}

interface BenchmarksManagerProps {
  userBenchmarks?: UserBenchmark[];
  onRefresh?: () => void;
  onBenchmarkAdded?: () => void;
}

const isDebtFund = (name: string): boolean => {
  const debtKeywords = [
    'liquid', 'overnight', 'ultra short', 'low duration', 'money market',
    'short duration', 'medium duration', 'long duration', 'dynamic bond',
    'credit risk', 'corporate bond', 'banking and psu', 'gilt',
    'floater', 'debt', 'fixed maturity', 'fmp'
  ];
  const lowerName = name.toLowerCase();
  return debtKeywords.some(keyword => lowerName.includes(keyword));
};

export function BenchmarksManager({ 
  userBenchmarks: propBenchmarks, 
  onRefresh,
  onBenchmarkAdded
}: BenchmarksManagerProps) {
  const [userBenchmarks, setUserBenchmarks] = useState<UserBenchmark[]>(propBenchmarks || []);
  const [loading, setLoading] = useState(!propBenchmarks || propBenchmarks.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, BenchmarkSummary | null>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedBenchmarkForUpload, setSelectedBenchmarkForUpload] = useState<string | null>(null);

  // Add Panel State
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'nifty_tri' | 'mf_nav' | 'manual'>('nifty_tri');
  const [activeNiftySubTab, setActiveNiftySubTab] = useState<string>('Broad Based');
  const [mfSearchQuery, setMfSearchQuery] = useState('');
  const [mfSearchResults, setMfSearchResults] = useState<{ amfi_code: string; name: string; fundHouse: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingItem, setAddingItem] = useState<string | null>(null);

  // MF Advanced State
  const [mfUniverse, setMfUniverse] = useState<{count:number}|null>(null);
  const [allFundHouses, setAllFundHouses] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [assetClassFilter, setAssetClassFilter] = useState<'all' | 'equity' | 'debt'>('all');
  const [planFilter, setPlanFilter] = useState<'all' | 'direct' | 'regular'>('all');
  const [optionFilter, setOptionFilter] = useState<'all' | 'growth' | 'idcw'>('all');
  const [fundHouseFilter, setFundHouseFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Manual Form State
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

  // MF Search Debounce
  useEffect(() => {
    if (activeTab !== 'mf_nav') return;
    if (mfSearchQuery.length < 3) {
      setMfSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const { results } = await searchAmfiMetadata(mfSearchQuery);
        setMfSearchResults(results);
      } catch (err) {
        console.error('MF search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 400); // Debounce 400ms
    return () => clearTimeout(timer);
  }, [mfSearchQuery, activeTab]);

  // MF Status effect
  useEffect(() => {
    if (activeTab === 'mf_nav' && mfUniverse === null) {
      getAmfiMetadataStatus().then(s => {
        if (s.count > 0) setMfUniverse({ count: s.count });
      }).catch(() => {});
      
      getAmfiFundHouses().then(r => setAllFundHouses(r.fundHouses)).catch(() => {});
    }
  }, [activeTab, mfUniverse]);

  // Reset filters when query changes
  useEffect(() => {
    setAssetClassFilter('all');
    setFundHouseFilter('all');
    setCategoryFilter('all');
  }, [mfSearchQuery]);

  const handleRefreshSummary = async (id: string) => {
    try {
      const summary = await getBenchmarkDataSummary(id);
      setSummaries(prev => ({ ...prev, [id]: summary }));
    } catch (err) {
      console.error('Failed to refresh summary:', err);
    }
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbol || !newName) return;
    
    setAddLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await addUserBenchmark({
        symbol: newSymbol.toUpperCase().trim(),
        name: newName,
        source: 'manual',
        category: 'custom',
        color: '#01696f',
        benchmark_type: 'yahoo'
      });
      setNewSymbol('');
      setNewName('');
      setShowAddForm(false);
      setSuccessMessage(`Successfully added ${newName}`);
      setTimeout(() => setSuccessMessage(null), 3000);
      await loadData();
      onBenchmarkAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add benchmark');
    } finally {
      setAddLoading(false);
    }
  };

  const handleAddFromCatalogue = async (entry: NiftyTRIEntry) => {
    if (userBenchmarks.some(b => b.symbol === entry.symbol)) return;

    setAddingItem(entry.symbol);
    setError(null);
    try {
      await addUserBenchmark({
        symbol: entry.symbol,
        name: entry.name,
        source: 'niftyindices',
        category: entry.category,
        color: '#01696f',
        benchmark_type: 'nifty_tri'
      });
      setSuccessMessage(`Successfully added ${entry.name}`);
      setTimeout(() => setSuccessMessage(null), 3000);
      await loadData();
      onBenchmarkAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add benchmark');
    } finally {
      setAddingItem(null);
    }
  };

  const handleAddMF = async (result: { amfi_code: string; name: string; fundHouse: string }) => {
    if (userBenchmarks.some(b => b.amfi_code === result.amfi_code)) return;

    setAddingItem(result.amfi_code);
    setError(null);
    try {
      await addUserBenchmark({
        symbol: result.amfi_code,
        name: result.name,
        source: 'amfi',
        category: 'mf_nav',
        color: '#4f98a3',
        benchmark_type: 'mf_nav',
        amfi_code: result.amfi_code
      });
      setMfSearchQuery('');
      setMfSearchResults([]);
      setSuccessMessage(`Successfully added ${result.name}`);
      setTimeout(() => setSuccessMessage(null), 3000);
      await loadData();
      onBenchmarkAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add benchmark');
    } finally {
      setAddingItem(null);
    }
  };

  const handleRefreshMFUniverse = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const result = await refreshAmfiMetadata();
      setMfUniverse({ count: result.count });
      setSuccessMessage(`Successfully refreshed MF universe (${result.count.toLocaleString()} funds)`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh MF universe');
    } finally {
      setRefreshing(false);
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

  const handleDelete = async (benchmark: UserBenchmark) => {
    if (!window.confirm(`Are you sure you want to delete "${benchmark.name}"?`)) return;

    setError(null);
    try {
      await deleteUserBenchmark(benchmark.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete benchmark');
    }
  };

  const filteredCatalogue = useMemo(() => {
    return CONFIG.NIFTY_TRI_CATALOGUE.filter(entry => entry.category === activeNiftySubTab);
  }, [activeNiftySubTab]);

  const fundHouses = useMemo(() => {
    return ['all', ...allFundHouses];
  }, [allFundHouses]);

  const filteredMfSearchResults = useMemo(() => {
    let results = mfSearchResults;

    if (assetClassFilter === 'debt') {
      results = results.filter(r => isDebtFund(r.name));
    } else if (assetClassFilter === 'equity') {
      results = results.filter(r => !isDebtFund(r.name) && !r.name.toLowerCase().includes('arbitrage'));
    }
    
    if (planFilter === 'direct') {
      results = results.filter(r => r.name.includes('Direct'));
    } else if (planFilter === 'regular') {
      results = results.filter(r => !r.name.includes('Direct'));
    }
    
    if (optionFilter === 'growth') {
      results = results.filter(r => r.name.toLowerCase().includes('growth'));
    } else if (optionFilter === 'idcw') {
      results = results.filter(r => r.name.toLowerCase().includes('idcw') || r.name.toLowerCase().includes('dividend'));
    }

    if (fundHouseFilter !== 'all') {
      results = results.filter(r => r.fundHouse === fundHouseFilter);
    }

    if (categoryFilter !== 'all') {
      results = results.filter(r => {
        const n = r.name.toLowerCase();
        switch(categoryFilter) {
          case 'large_cap': return n.includes('large cap');
          case 'mid_cap':   return n.includes('mid cap') || n.includes('midcap');
          case 'small_cap': return n.includes('small cap') || n.includes('smallcap');
          case 'flexi_cap': return n.includes('flexi cap') || n.includes('flexicap');
          case 'multi_cap': return n.includes('multi cap') || n.includes('multicap');
          case 'elss':      return n.includes('elss') || n.includes('tax saver') || n.includes('tax saving');
          case 'index':     return n.includes('index') || n.includes('nifty') || n.includes('sensex');
          case 'sectoral':  return n.includes('sector') || n.includes('thematic');
          default:          return true;
        }
      });
    }
    
    return results;
  }, [mfSearchResults, planFilter, optionFilter, fundHouseFilter, categoryFilter, assetClassFilter]);

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

      {showAddForm && (
        <div 
          className="rounded-2xl border overflow-hidden transition-all animate-in fade-in slide-in-from-top-2 duration-300 shadow-sm"
          style={{ backgroundColor: 'var(--color-surface-offset)', borderColor: 'var(--color-border)' }}
        >
          {/* Main Tabs */}
          <div className="flex border-b" style={{ borderColor: 'var(--color-border)' }}>
            {[
              { id: 'nifty_tri', label: 'Nifty TRI' },
              { id: 'mf_nav', label: 'MF Benchmark' },
              { id: 'manual', label: 'Manual' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  "px-6 py-4 text-sm font-bold border-b-2 transition-colors",
                  activeTab === tab.id 
                    ? "border-primary text-primary" 
                    : "border-transparent text-gray-500 hover:text-gray-700"
                )}
                style={{ 
                  color: activeTab === tab.id ? 'var(--color-primary)' : 'inherit',
                  borderColor: activeTab === tab.id ? 'var(--color-primary)' : 'transparent'
                }}
              >
                {tab.label}
              </button>
            ))}
            <button 
              onClick={() => setShowAddForm(false)}
              className="ml-auto p-4 text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 max-h-[500px] overflow-y-auto">
            {activeTab === 'nifty_tri' && (
              <div className="space-y-6">
                <div className="flex flex-wrap gap-2">
                  {['Broad Based', 'Sectoral', 'Thematic', 'Strategy'].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setActiveNiftySubTab(cat)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-bold transition-colors",
                        activeNiftySubTab === cat
                          ? "bg-primary text-white"
                          : "bg-white border text-gray-600 hover:bg-gray-50"
                      )}
                      style={{
                        backgroundColor: activeNiftySubTab === cat ? 'var(--color-primary)' : undefined,
                        borderColor: activeNiftySubTab === cat ? 'var(--color-primary)' : 'var(--color-border)',
                        color: activeNiftySubTab === cat ? '#fff' : undefined
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredCatalogue.map(entry => {
                    const isAdded = userBenchmarks.some(b => b.symbol === entry.symbol);
                    const isAdding = addingItem === entry.symbol;

                    return (
                      <button
                        key={entry.symbol}
                        disabled={isAdded || isAdding}
                        onClick={() => handleAddFromCatalogue(entry)}
                        className={cn(
                          "flex flex-col items-start p-4 rounded-xl border text-left transition-all relative group",
                          isAdded ? "opacity-60 bg-gray-50" : "bg-white hover:border-primary/50 hover:shadow-md cursor-pointer"
                        )}
                        style={{ borderColor: 'var(--color-border)' }}
                      >
                        <div className="flex justify-between items-start w-full">
                          <span className="font-bold text-sm leading-tight pr-6">{entry.name}</span>
                          {isAdded && <Check className="w-4 h-4 text-success shrink-0" style={{ color: 'var(--color-success)' }} />}
                          {isAdding && <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" style={{ color: 'var(--color-primary)' }} />}
                        </div>
                        <span className="text-[11px] text-gray-500 mt-2 line-clamp-2">{entry.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'mf_nav' && (
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search mutual fund (e.g. Nifty 50 Index Fund)"
                      className="w-full pl-10 pr-4 py-3 rounded-xl border bg-white focus:outline-none focus:ring-2"
                      style={{ borderColor: 'var(--color-border)', focusRingColor: 'var(--color-primary)' }}
                      value={mfSearchQuery}
                      onChange={(e) => setMfSearchQuery(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleRefreshMFUniverse}
                      disabled={refreshing}
                      className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-bold border transition-colors hover:bg-gray-50 disabled:opacity-50"
                      style={{ borderColor: 'var(--color-border)' }}
                    >
                      {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      Refresh MF Universe
                    </button>
                    {mfUniverse && (
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">
                        {mfUniverse.count.toLocaleString()} funds loaded
                      </span>
                    )}
                  </div>
                </div>

                {activeTab === 'mf_nav' && (
                  <div className="flex flex-col gap-4 py-3 border-y" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex flex-wrap items-center gap-6">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase text-gray-400">Asset Class</span>
                        <div className="flex bg-gray-100 p-0.5 rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
                          {(['all', 'equity', 'debt'] as const).map(f => (
                            <button
                              key={f}
                              onClick={() => setAssetClassFilter(f)}
                              className={cn(
                                "px-2 py-1 text-[10px] font-bold rounded-md transition-all",
                                assetClassFilter === f ? "bg-white shadow-sm text-primary" : "text-gray-500 hover:text-gray-700"
                              )}
                              style={{ color: assetClassFilter === f ? 'var(--color-primary)' : undefined }}
                            >
                              {f.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase text-gray-400">Plan</span>
                        <div className="flex bg-gray-100 p-0.5 rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
                          {(['all', 'direct', 'regular'] as const).map(f => (
                            <button
                              key={f}
                              onClick={() => setPlanFilter(f)}
                              className={cn(
                                "px-2 py-1 text-[10px] font-bold rounded-md transition-all",
                                planFilter === f ? "bg-white shadow-sm text-primary" : "text-gray-500 hover:text-gray-700"
                              )}
                              style={{ color: planFilter === f ? 'var(--color-primary)' : undefined }}
                            >
                              {f.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase text-gray-400">Option</span>
                        <div className="flex bg-gray-100 p-0.5 rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
                          {(['all', 'growth', 'idcw'] as const).map(f => (
                            <button
                              key={f}
                              onClick={() => setOptionFilter(f)}
                              className={cn(
                                "px-2 py-1 text-[10px] font-bold rounded-md transition-all",
                                optionFilter === f ? "bg-white shadow-sm text-primary" : "text-gray-500 hover:text-gray-700"
                              )}
                              style={{ color: optionFilter === f ? 'var(--color-primary)' : undefined }}
                            >
                              {f.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase text-gray-400">Fund House</span>
                        <select
                          value={fundHouseFilter}
                          onChange={(e) => setFundHouseFilter(e.target.value)}
                          className="text-[10px] font-bold bg-white border rounded-lg px-2 py-1 outline-none focus:ring-1 max-w-[150px]"
                          style={{ borderColor: 'var(--color-border)', focusRingColor: 'var(--color-primary)' }}
                        >
                          {fundHouses.map(h => (
                            <option key={h} value={h}>{h === 'all' ? 'All Fund Houses' : h}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold uppercase text-gray-400">Category</span>
                      <div className="flex flex-wrap gap-1">
                        {[
                          { id: 'all', label: 'All' },
                          { id: 'large_cap', label: 'Large' },
                          { id: 'mid_cap', label: 'Mid' },
                          { id: 'small_cap', label: 'Small' },
                          { id: 'flexi_cap', label: 'Flexi' },
                          { id: 'multi_cap', label: 'Multi' },
                          { id: 'elss', label: 'ELSS' },
                          { id: 'index', label: 'Index' },
                          { id: 'sectoral', label: 'Sectoral' }
                        ].map(c => (
                          <button
                            key={c.id}
                            onClick={() => setCategoryFilter(c.id)}
                            className={cn(
                              "px-2 py-1 text-[10px] font-bold rounded-md transition-all border",
                              categoryFilter === c.id 
                                ? "bg-primary text-white border-primary" 
                                : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                            )}
                            style={{ 
                              backgroundColor: categoryFilter === c.id ? 'var(--color-primary)' : undefined,
                              borderColor: categoryFilter === c.id ? 'var(--color-primary)' : undefined,
                              color: categoryFilter === c.id ? '#fff' : undefined
                            }}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {filteredMfSearchResults.length !== mfSearchResults.length && (
                      <span className="text-[10px] font-medium text-gray-500">
                        Showing {filteredMfSearchResults.length} of {mfSearchResults.length} results
                      </span>
                    )}
                  </div>
                )}

                <div className="space-y-1">
                  {isSearching ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" style={{ color: 'var(--color-primary)' }} />
                    </div>
                  ) : filteredMfSearchResults.length > 0 ? (
                    <div className="divide-y border rounded-xl overflow-hidden bg-white" style={{ borderColor: 'var(--color-border)', divideColor: 'var(--color-border)' }}>
                      {filteredMfSearchResults.map(result => {
                        const isAdded = userBenchmarks.some(b => b.amfi_code === result.amfi_code);
                        const isAdding = addingItem === result.amfi_code;

                        return (
                          <button
                            key={result.amfi_code}
                            disabled={isAdded || isAdding}
                            onClick={() => handleAddMF(result)}
                            className={cn(
                              "w-full flex items-center justify-between p-4 text-left transition-colors",
                              isAdded ? "bg-gray-50 opacity-60" : "hover:bg-gray-50 active:bg-gray-100"
                            )}
                          >
                            <div className="flex flex-col">
                              <span className="text-sm font-bold">{result.name}</span>
                              <span className="text-[10px] text-gray-500">AMFI Code: {result.amfi_code}</span>
                            </div>
                            {isAdded && <Check className="w-5 h-5 text-success" style={{ color: 'var(--color-success)' }} />}
                            {isAdding && <Loader2 className="w-5 h-5 animate-spin text-primary" style={{ color: 'var(--color-primary)' }} />}
                          </button>
                        );
                      })}
                    </div>
                  ) : mfSearchQuery.length >= 3 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
                       <p className="text-center text-gray-500 text-sm">No funds found. Try refreshing the MF universe first.</p>
                       <button 
                        onClick={handleRefreshMFUniverse}
                        className="text-xs font-bold text-primary hover:underline"
                        style={{ color: 'var(--color-primary)' }}
                       >
                         Click here to reload fund data
                       </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
                      <Search className="w-8 h-8 opacity-20" />
                      <p className="text-sm text-center">Type at least 3 characters to search</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'manual' && (
              <form onSubmit={handleManualAdd} className="max-w-xl mx-auto space-y-6 py-4">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase text-gray-500">Display Name</label>
                    <input
                      type="text"
                      placeholder="e.g. My Custom Benchmark"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full px-4 py-3 text-sm border rounded-xl bg-white focus:outline-none focus:ring-2"
                      style={{ borderColor: 'var(--color-border)', focusRingColor: 'var(--color-primary)' }}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase text-gray-500">Index Symbol</label>
                    <input
                      type="text"
                      placeholder="e.g. NIFTY 50"
                      value={newSymbol}
                      onChange={(e) => setNewSymbol(e.target.value)}
                      className="w-full px-4 py-3 text-sm font-mono border rounded-xl bg-white focus:outline-none focus:ring-2"
                      style={{ borderColor: 'var(--color-border)', focusRingColor: 'var(--color-primary)' }}
                      required
                    />
                    <p className="text-[10px] text-gray-400">
                      Exact name from source — e.g. ^NSEI for Yahoo Finance or NIFTY 50 for Nifty Indices.
                    </p>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={addLoading || !newSymbol || !newName}
                  className="w-full py-4 rounded-xl text-white font-bold transition-all hover:brightness-110 active:brightness-90 disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                >
                  {addLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                  Add Custom Benchmark
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {error && (
        <div 
          style={{ backgroundColor: 'var(--color-error-highlight)', color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
          className="p-4 rounded-2xl border flex items-center gap-3 text-sm font-medium animate-in fade-in duration-300"
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div 
          style={{ backgroundColor: 'var(--color-success-highlight)', color: 'var(--color-success)', borderColor: 'var(--color-success)' }}
          className="p-4 rounded-2xl border flex items-center gap-3 text-sm font-medium animate-in fade-in duration-300"
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
              {userBenchmarks.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: b.color || 'var(--color-primary)' }} />
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{b.name}</span>
                          <span 
                            className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider"
                            style={{ 
                              backgroundColor: b.benchmark_type === 'nifty_tri' ? 'var(--color-primary)' : b.benchmark_type === 'mf_nav' ? '#7c3aed' : '#6b7280',
                              color: '#fff'
                            }}
                          >
                            {b.benchmark_type === 'nifty_tri' ? 'NIFTY TRI' : b.benchmark_type === 'mf_nav' ? 'MF NAV' : b.benchmark_type === 'manual' ? 'MANUAL' : 'UNKNOWN'}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-400 font-mono">{b.symbol} {b.benchmark_type === 'mf_nav' ? '(MF)' : ''}</span>
                      </div>
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
                      {summaries[b.id] && summaries[b.id]!.latest && (
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
                        title="Auto-Fetch from Source"
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
              {userBenchmarks.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center text-gray-400 text-sm italic">
                    No benchmarks added yet. Click &quot;Add Benchmark&quot; to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs italic mt-4" style={{ color: 'var(--color-text-muted)' }}>
        Note: TRI (Total Return Index) and Mutual Fund NAV data include dividends reinvested and are more accurate for comparison with growth funds.
      </p>
    </div>
  );
}
