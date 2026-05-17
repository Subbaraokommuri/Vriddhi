import React, { useState, useEffect, useMemo } from 'react';
import { 
  PieChart, 
  Briefcase, 
  TrendingUp,
  AlertCircle
} from 'lucide-react';
import { motion } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  LineChart,
  Line,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend,
  ResponsiveContainer, 
  Cell,
  PieChart as RePieChart,
  Pie,
  ComposedChart,
  ReferenceLine
} from 'recharts';
import { cn, formatCurrency, formatIndianNumber, formatPercent } from '../lib/utils';
import { Summary, Folio, InvestmentTrendPoint } from '../lib/types';
import { 
  fetchSummary, 
  fetchFolios, 
  fetchBenchmarks, 
  fetchBenchmarkXirr, 
  fetchPortfolioGrowth 
} from '../lib/api';

interface DashboardProps {
  investmentTrend: InvestmentTrendPoint[];
}

export function Dashboard({ investmentTrend }: DashboardProps) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [folios, setFolios] = useState<Folio[]>([]);
  const [overallBenchmarkData, setOverallBenchmarkData] = useState<any>(null);
  const [growthData, setGrowthData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [summaryRes, foliosRes, benchmarksRes] = await Promise.all([
          fetchSummary(),
          fetchFolios(),
          fetchBenchmarks(),
        ]);
        setSummary(summaryRes);
        setFolios(foliosRes);

        // Fetch overall benchmark comparison (Nifty 50)
        const nifty = benchmarksRes.find((b: any) => b.symbol === '^NSEI');
        if (nifty) {
          const [benchmarkXirrRes, growthRes] = await Promise.all([
            fetchBenchmarkXirr({ portfolioId: 'all', benchmarkIds: [nifty.id] }),
            fetchPortfolioGrowth('^NSEI')
          ]);
          setOverallBenchmarkData(benchmarkXirrRes);
          setGrowthData(growthRes);
        }
      } catch (err) {
        console.error('Dashboard data fetch failed:', err);
        setError('Failed to load dashboard data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const allocationData = useMemo(() => {
    // TODO Step 11: replace cleanName with formatFundName()
    const cleanName = (raw: string) => raw.replace(/^[A-Z0-9]+-/, '');

    const activeFolios = folios
      .filter(f => f.currentValue > 0)
      .sort((a, b) => b.currentValue - a.currentValue);

    if (activeFolios.length <= 5) {
      return activeFolios.map(f => ({ name: cleanName(f.fund_name), value: f.currentValue }));
    }

    const top5 = activeFolios.slice(0, 5).map(f => ({ name: cleanName(f.fund_name), value: f.currentValue }));
    const othersValue = activeFolios.slice(5).reduce((sum, f) => sum + f.currentValue, 0);
    
    return [...top5, { name: 'Others', value: othersValue }];
  }, [folios]);

  const PIE_COLORS = ['#01696f', '#0891b2', '#7c3aed', '#d97706', '#dc2626', '#94a3b8'];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-8 h-8 border-4 border-[#01696f] border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 font-medium">Loading Dashboard...</p>
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

  const kpiCards = [
    { label: 'Current Value', value: summary?.currentValue, sub: 'Net Worth', icon: PieChart, color: 'text-[#01696f]' },
    { label: 'Total Invested', value: summary?.totalInvested, sub: 'Cost Basis', icon: Briefcase, color: 'text-blue-600' },
    {
      label: 'Unrealised Gain',
      value: summary?.gain,
      sub: 'Absolute Return ₹',
      icon: TrendingUp,
      color: (summary?.gain ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600',
      isRaw: false
    },
    { 
      label: 'Unrealised Gain %', 
      value: summary?.totalInvested ? formatPercent(summary.gain / summary.totalInvested) : 'N/A', 
      sub: 'Unrealised Return', 
      icon: TrendingUp, 
      color: (summary?.gain ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600',
      isRaw: true 
    },
    { label: 'Overall XIRR', value: summary?.xirr ? formatPercent(summary.xirr) : 'N/A', sub: 'Annualised', icon: TrendingUp, color: 'text-indigo-600', isRaw: true },
    { 
      label: 'vs Benchmark', 
      value: overallBenchmarkData?.benchmarks?.[0]?.diff !== undefined 
        ? `${overallBenchmarkData.benchmarks[0].diff >= 0 ? '+' : ''}${formatPercent(overallBenchmarkData.benchmarks[0].diff)}` 
        : 'N/A', 
      sub: 'Alpha (Nifty 50)', 
      icon: PieChart, 
      color: overallBenchmarkData?.benchmarks?.[0]?.diff >= 0 ? 'text-emerald-600' : 'text-rose-600', 
      isRaw: true 
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {kpiCards.map((card, i) => (
          <div key={i} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div className={cn("p-2 rounded-xl bg-slate-50", card.color)}>
                <card.icon className="w-6 h-6" />
              </div>
            </div>
            <p className="text-sm font-medium text-slate-500 mb-1">{card.label}</p>
            <p className="text-2xl font-bold tabular-nums">
              {card.isRaw ? card.value : formatCurrency(card.value || 0)}
            </p>
            <p className={cn("text-xs font-semibold mt-2", card.color)}>{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold mb-6">Portfolio Allocation</h3>
          <div className="h-96">
            <div className="flex items-center gap-6 h-full">
              <div className="flex-shrink-0" style={{ width: '55%', height: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie
                      data={allocationData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={120}
                      paddingAngle={3}
                    >
                      {allocationData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-3 flex-1 min-w-0">
                {allocationData.map((entry, index) => (
                  <div key={index} className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                    />
                    <span className="text-xs text-slate-600 truncate" title={entry.name}>
                      {entry.name.length > 28 ? `${entry.name.substring(0, 28)}…` : entry.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div></div> {/* Spacer for Category removal */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 lg:col-span-2">
          <h3 className="text-lg font-bold mb-6">Growth Comparison (Indexed to 100)</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={growthData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="date" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  tickFormatter={(v) => new Date(v).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  domain={['auto', 'auto']}
                />
                <Tooltip 
                  formatter={(value: number) => value.toFixed(2)}
                  labelFormatter={(label) => new Date(label).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                />
                <Legend />
                <Line type="monotone" dataKey="portfolio" name="Your Portfolio" stroke="#01696f" strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="benchmark" name="Nifty 50" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 lg:col-span-2">
          <h3 className="text-lg font-bold mb-6">Investment Trend</h3>
          {investmentTrend.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              <p className="text-slate-400 font-medium">No transaction data available</p>
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={investmentTrend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="year" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    tickFormatter={(v, index) => {
                      const point = investmentTrend[index];
                      return point?.isPartialYear ? `${v}*` : v;
                    }}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    domain={[0, 10000000]}
                    ticks={[0, 2500000, 5000000, 7500000, 10000000]}
                    tickFormatter={(v) => {
                      if (v === 0) return '₹0';
                      if (v === 10000000) return '₹1Cr';
                      return `₹${v / 100000}L`;
                    }}
                  />
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload as InvestmentTrendPoint;
                        return (
                          <div className="bg-white p-4 border border-slate-200 rounded-xl shadow-xl text-sm">
                            <p className="font-bold text-slate-900 mb-1">
                              {data.year}{data.isPartialYear ? ' (partial year)' : ''}
                            </p>
                            <p className="text-slate-600">
                              Net Invested: {formatCurrency(data.netInvested)}
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar dataKey="netInvested" fill="#01696f" radius={[4, 4, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
