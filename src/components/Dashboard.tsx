import React, { useState, useEffect, useMemo } from 'react';
import { 
  PieChart, 
  Briefcase, 
  Plus, 
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

  // Dynamic colors from theme
  const [chartColors, setChartColors] = useState({
    primary: '#01696f',
    gold: '#fbbf24',
    orange: '#f97316'
  });

  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setChartColors({
      primary: style.getPropertyValue('--color-primary').trim() || '#01696f',
      gold: style.getPropertyValue('--color-gold').trim() || '#fbbf24',
      orange: style.getPropertyValue('--color-orange').trim() || '#f97316'
    });
  }, []);

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
    { label: 'Yearly Invested', value: summary?.yearlyInvested, sub: `In ${new Date().getFullYear()}`, icon: Plus, color: 'text-amber-600' },
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

  const categoryDistribution = Object.entries(folios.reduce((acc, f) => {
    const cat = f.category || 'Uncategorized';
    acc[cat] = (acc[cat] || 0) + f.currentValue;
    return acc;
  }, {} as Record<string, number>)).map(([name, value]) => ({ name, value }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie
                  data={folios.filter(f => f.currentValue > 0)}
                  dataKey="currentValue"
                  nameKey="fund_name"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                >
                  {folios.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={`hsl(${index * 45}, 70%, 45%)`} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
              </RePieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold mb-6">Category Distribution</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryDistribution}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => formatIndianNumber(v)} />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                <Bar dataKey="value" fill="#01696f" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
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
                    yAxisId="left"
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
                  <YAxis 
                    yAxisId="right"
                    orientation="right"
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    domain={[-100, 300]}
                    ticks={[-100, -50, 0, 50, 100, 150, 200, 250, 300]}
                    tickFormatter={(v) => `${Math.round(v)}%`}
                  />
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload as InvestmentTrendPoint;
                        return (
                          <div className="bg-white p-4 border border-slate-200 rounded-xl shadow-xl">
                            <p className="font-bold text-slate-900 mb-2">
                              {data.year}{data.isPartialYear ? ' (partial)' : ''}
                            </p>
                            <div className="space-y-1">
                              <div className="text-sm flex justify-between gap-4">
                                <span className="text-slate-500">Net Invested:</span>
                                <span className="font-medium">{formatCurrency(data.netInvested)}</span>
                              </div>
                              <div className="text-sm flex justify-between gap-4">
                                <span className="text-slate-500">YoY Growth:</span>
                                <span className={cn("font-medium", data.yoyGrowth !== null && data.yoyGrowth > 0 ? "text-emerald-600" : data.yoyGrowth !== null && data.yoyGrowth < 0 ? "text-rose-600" : "text-slate-900")}>
                                  {data.yoyGrowth !== null ? `${data.yoyGrowth > 0 ? '+' : ''}${data.yoyGrowth.toFixed(0)}%${(data.yoyGrowth < -100 || data.yoyGrowth > 300) ? ' (off-chart)' : ''}` : '—'}
                                </span>
                              </div>
                              <div className="text-sm flex justify-between gap-4">
                                <span className="text-slate-500">Rolling Avg (3y):</span>
                                <span className={cn("font-medium", data.rollingAvgGrowth !== null && data.rollingAvgGrowth > 0 ? "text-emerald-600" : data.rollingAvgGrowth !== null && data.rollingAvgGrowth < 0 ? "text-rose-600" : "text-slate-900")}>
                                  {data.rollingAvgGrowth !== null ? `${data.rollingAvgGrowth > 0 ? '+' : ''}${data.rollingAvgGrowth.toFixed(0)}%${(data.rollingAvgGrowth < -100 || data.rollingAvgGrowth > 300) ? ' (off-chart)' : ''}` : '—'}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Legend verticalAlign="top" height={36} formatter={(value) => {
                    if (value === 'netInvested') return 'Net Invested';
                    if (value === 'yoyGrowth') return 'YoY Growth %';
                    if (value === 'rollingAvgGrowth') return '3-yr Rolling Avg %';
                    return value;
                  }} />
                  <ReferenceLine y={0} yAxisId="right" stroke="#e2e8f0" />
                  <Bar yAxisId="left" dataKey="netInvested" fill={chartColors.primary} radius={[4, 4, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="yoyGrowth"
                    stroke={chartColors.gold}
                    strokeDasharray="5 5"
                    dot={true}
                    connectNulls={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="rollingAvgGrowth"
                    stroke={chartColors.orange}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
