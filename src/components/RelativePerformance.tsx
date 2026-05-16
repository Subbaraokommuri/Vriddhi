import React, { useState, useEffect } from 'react';
import { 
  BarChart2, 
  Loader2, 
  AlertCircle, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown,
  ArrowRight
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend, 
  ResponsiveContainer, 
  CartesianGrid 
} from 'recharts';
import { TagTheme, RelativePerformanceResult } from '../lib/types.ts';
import { fetchRelativePerformance } from '../lib/api.ts';
import { formatCurrency, formatPercent, cn } from '../lib/utils.ts';

interface RelativePerformanceProps {
  themes: TagTheme[];
  benchmarks: { symbol: string; name: string }[];
  selectedThemeId: string;
  selectedTag: string;
  selectedBenchmark: string;
  onThemeChange: (id: string) => void;
  onTagChange: (tag: string) => void;
  onBenchmarkChange: (symbol: string) => void;
}

export function RelativePerformance({ 
  themes, 
  benchmarks,
  selectedThemeId,
  selectedTag,
  selectedBenchmark,
  onThemeChange,
  onTagChange,
  onBenchmarkChange
}: RelativePerformanceProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RelativePerformanceResult | null>(null);

  const selectedTheme = themes.find(t => t.id === selectedThemeId);

  useEffect(() => {
    onTagChange('');
  }, [selectedThemeId]);

  const handleRun = async () => {
    if (!selectedThemeId || !selectedTag || !selectedBenchmark) return;

    setLoading(true);
    setError(null);
    try {
      const data = await fetchRelativePerformance(selectedThemeId, selectedTag, selectedBenchmark);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch performance data');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const formatShortCurrency = (val: number) => {
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
    return `₹${val.toLocaleString('en-IN')}`;
  };

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap items-end gap-4">
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Theme</label>
          <select 
            value={selectedThemeId}
            onChange={(e) => onThemeChange(e.target.value)}
            className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-primary/20 appearance-none text-sm cursor-pointer"
          >
            <option value="">Select Theme</option>
            {themes.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Tag</label>
          <select 
            value={selectedTag}
            onChange={(e) => onTagChange(e.target.value)}
            disabled={!selectedThemeId}
            className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-primary/20 appearance-none text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">Select Tag</option>
            {selectedTheme?.tags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5 flex-1 min-w-[240px]">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Benchmark</label>
          <select 
            value={selectedBenchmark}
            onChange={(e) => onBenchmarkChange(e.target.value)}
            className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-primary/20 appearance-none text-sm cursor-pointer"
          >
            <option value="">Select Benchmark</option>
            {benchmarks.map(b => (
              <option key={b.symbol} value={b.symbol}>{b.name}</option>
            ))}
          </select>
        </div>

        <button
          onClick={handleRun}
          disabled={loading || !selectedThemeId || !selectedTag || !selectedBenchmark}
          className="h-11 px-8 rounded-xl bg-orange-600 text-white font-bold text-sm hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-600/20"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Running...</span>
            </>
          ) : (
            <>
              <BarChart2 className="w-4 h-4" />
              <span>Run Analysis</span>
            </>
          )}
        </button>
      </div>

      {/* Error Box */}
      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3 text-rose-700 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-28 bg-slate-200 animate-pulse rounded-2xl" />
            ))}
          </div>
          <div className="h-80 bg-slate-200 animate-pulse rounded-2xl" />
        </div>
      )}

      {/* Results Content */}
      {result && !loading && (
        <div className="space-y-6">
          {/* Warning Banner */}
          {result.xirrWarning && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-amber-700 text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span className="font-medium">⚠ XIRR exceeds normal bounds (&gt;100% or &lt;-50%) — treat as indicative only</span>
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Current Value</p>
              <h3 className="text-2xl font-black text-slate-900">{formatCurrency(result.currentValue)}</h3>
              <p className="text-xs text-slate-500 mt-1">{formatCurrency(result.investedAmount)} invested</p>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Unrealised P&L</p>
              <h3 className="text-2xl font-black text-slate-900">{formatCurrency(result.unrealisedPnl)}</h3>
              <div className={cn(
                "flex items-center gap-1 text-xs font-bold mt-1",
                result.unrealisedPnl >= 0 ? "text-emerald-600" : "text-rose-600"
              )}>
                {result.unrealisedPnl >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                <span>{result.unrealisedPnl >= 0 ? 'net gain' : 'net loss'}</span>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Portfolio XIRR</p>
              <h3 className="text-2xl font-black text-slate-900">
                {result.portfolioXirr !== null ? formatPercent(result.portfolioXirr) : "—"}
              </h3>
              <p className="text-xs text-slate-500 mt-1">annualised return</p>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Alpha vs Benchmark</p>
              <h3 className={cn(
                "text-2xl font-black",
                (result.alpha || 0) >= 0 ? "text-emerald-600" : "text-rose-600"
              )}>
                {result.alpha !== null ? (result.alpha >= 0 ? '+' : '') + formatPercent(result.alpha) : "—"}
              </h3>
              <p className="text-xs text-slate-500 mt-1 truncate" title={`${result.benchmarkName} ${result.benchmarkXirr !== null ? formatPercent(result.benchmarkXirr) : '—'}`}>
                {result.benchmarkName} {result.benchmarkXirr !== null ? formatPercent(result.benchmarkXirr) : "—"}
              </p>
            </div>
          </div>

          {/* Time Series Chart */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
             <div className="flex items-center justify-between mb-6">
              <h4 className="text-sm font-bold text-slate-900">Wealth Growth vs Benchmark</h4>
              <div className="flex gap-4">
                <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-slate-400">
                  <div className="w-3 h-0.5" style={{ backgroundColor: '#01696f' }}></div>
                  Portfolio
                </div>
                <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-slate-400">
                  <div className="w-3 h-0.5" style={{ backgroundColor: '#da7101' }}></div>
                  {result.benchmarkName}
                </div>
              </div>
            </div>
            <div className="w-full h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={result.timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border, #e2e8f0)" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(d) => d.slice(0, 4)}
                    interval="preserveStartEnd"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                    dy={10}
                  />
                  <YAxis 
                    tickFormatter={formatShortCurrency}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fontBold: 700, fill: '#94a3b8' }}
                  />
                  <Tooltip 
                    formatter={(val: number) => [formatShortCurrency(val), ""]}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', padding: '12px' }}
                    labelStyle={{ fontWeight: 700, marginBottom: '4px', fontSize: '12px' }}
                  />
                  <Legend verticalAlign="bottom" height={36} content={() => null} />
                  <Line 
                    type="monotone" 
                    dataKey="portfolioValue" 
                    name="Portfolio" 
                    stroke="#01696f" 
                    strokeWidth={2.5} 
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0, fill: '#01696f' }} 
                  />
                  <Line 
                    type="monotone" 
                    dataKey="benchmarkValue" 
                    name={result.benchmarkName} 
                    stroke="#da7101" 
                    strokeWidth={2.5} 
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0, fill: '#da7101' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="investedValue" 
                    name="Invested" 
                    stroke="#94a3b8" 
                    strokeWidth={1.5} 
                    strokeDasharray="4 4" 
                    dot={false} 
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Funds Table */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h4 className="text-sm font-bold text-slate-900 tracking-tight">Funds in this group</h4>
              <span className="text-xs font-bold text-slate-500 px-3 py-1 bg-white border border-slate-200 rounded-full">
                {result.folioCount} folios, {result.fundCount} funds
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Fund Name</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Folio</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Invested</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Current Value</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {result.folios.map(f => {
                    const pnl = f.currentValue - f.invested;
                    return (
                      <tr key={f.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 text-sm font-bold text-slate-900">{f.fund_name}</td>
                        <td className="px-6 py-4 text-xs font-mono text-slate-500">{f.folio_number}</td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-600 text-right font-mono">{formatCurrency(f.invested)}</td>
                        <td className="px-6 py-4 text-sm font-bold text-slate-900 text-right font-mono">{formatCurrency(f.currentValue)}</td>
                        <td className={cn(
                          "px-6 py-4 text-sm font-black text-right font-mono",
                          pnl >= 0 ? "text-emerald-600" : "text-rose-600"
                        )}>
                          {formatCurrency(pnl)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!result && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
            <BarChart2 className="w-8 h-8" />
          </div>
          <div className="max-w-xs">
            <h4 className="text-lg font-bold text-slate-900">Analyze Performance</h4>
            <p className="text-sm text-slate-500 mt-1">Select a theme, tag, and benchmark to see how your portfolio groups have performed over time.</p>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-300 animate-pulse" />
        </div>
      )}
    </div>
  );
}
