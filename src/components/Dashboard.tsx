import React, { useState, useEffect } from 'react';
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
  Pie
} from 'recharts';
import { cn, formatCurrency, formatIndianNumber, formatPercent } from '../lib/utils';
import { Summary, Folio } from '../lib/types';
import { 
  fetchSummary, 
  fetchFolios, 
  fetchBenchmarks, 
  fetchBenchmarkXirr, 
  fetchPortfolioGrowth 
} from '../lib/api';

export function Dashboard() {
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
      </div>
    </motion.div>
  );
}
