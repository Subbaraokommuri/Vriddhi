import React, { useState, useEffect, useMemo } from 'react';
import { 
  PieChart, 
  Briefcase, 
  TrendingUp,
  AlertCircle,
  Eye,
  EyeOff
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
import { Summary, Folio, InvestmentTrendPoint, RelativePerformanceResult } from '../lib/types';
import { 
  // API imports removed - now prop driven
} from '../lib/api';

interface DashboardProps {
  summary: Summary | null;
  folios: Folio[];
  dashboardPerf: RelativePerformanceResult | null;
  investmentTrend: InvestmentTrendPoint[];
}

export function Dashboard({ summary, folios, dashboardPerf, investmentTrend }: DashboardProps) {
  const [privacyMode, setPrivacyMode] = useState(true);

  const blur = privacyMode ? 'blur-sm select-none' : '';

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

  const overallXirr = dashboardPerf?.portfolioXirr ?? summary?.xirr ?? null;

  const sideStats = useMemo(() => {
    const activeFolios = folios.filter(f => f.currentValue > 0);
    const directCount = activeFolios.filter(f => f.fund_name.toLowerCase().includes('direct')).length;
    return {
      totalFolios: folios.length,
      activeFolioCount: activeFolios.length,
      directCount,
      regularCount: activeFolios.length - directCount,
    };
  }, [folios]);

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
    { label: 'Overall XIRR', value: overallXirr ? formatPercent(overallXirr) : 'N/A', sub: 'Annualised', icon: TrendingUp, color: 'text-indigo-600', isRaw: true },
    { 
      label: 'vs Benchmark', 
      value: dashboardPerf?.alpha !== null && dashboardPerf?.alpha !== undefined 
        ? `${dashboardPerf.alpha >= 0 ? '+' : ''}${formatPercent(dashboardPerf.alpha)}` 
        : 'N/A', 
      sub: dashboardPerf ? `Alpha vs ${dashboardPerf.benchmarkName}` : 'Alpha (Nifty 50)', 
      icon: PieChart, 
      color: (dashboardPerf?.alpha ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600', 
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
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-bold text-slate-800">Dashboard</h2>
        <button
          onClick={() => setPrivacyMode(!privacyMode)}
          className="rounded-xl p-2 bg-white border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors"
          title={privacyMode ? "Show values" : "Hide values"}
        >
          {privacyMode ? (
            <EyeOff className="w-5 h-5 text-slate-500" />
          ) : (
            <Eye className="w-5 h-5 text-slate-500" />
          )}
        </button>
      </div>

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
            <p className={cn("text-2xl font-bold tabular-nums", blur)}>
              {card.isRaw ? card.value : formatCurrency(Number(card.value) || 0)}
            </p>
            <p className={cn("text-xs font-semibold mt-2", card.color)}>{card.sub}</p>
          </div>
        ))}
      </div>
      
      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top row: Pie + Stat Cards */}
        <div className="lg:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: Portfolio Allocation Pie */}
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
            <h3 className="text-lg font-bold mb-6">Portfolio Allocation</h3>
            <div className="h-96">
              <div className="flex items-center gap-6 h-full">
                <div className={cn("flex-shrink-0", blur)} style={{ width: '55%', height: '100%' }}>
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

          {/* Right: Stat Cards stack */}
          <div className="flex flex-col gap-4">
            {/* Card 1: FOLIOS */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-6 py-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Folios</p>
              <p className={cn("text-sm font-bold text-slate-800", blur)}>
                {sideStats.totalFolios} total · {sideStats.activeFolioCount} active
              </p>
            </div>

            {/* Card 2: PLAN MIX (ACTIVE) */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-6 py-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Plan Mix (Active)</p>
              <p className={cn("text-sm font-bold text-slate-800", blur)}>
                {sideStats.directCount} Direct · {sideStats.regularCount} Regular
              </p>
            </div>

            {/* TODO Step 7: replace placeholder with dashboardStats.highestXirrFund etc. */}
            {/* Card 3: HIGHEST XIRR FUND */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-6 py-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Highest XIRR Fund</p>
              <p className={cn("text-sm font-bold text-slate-400 italic", blur)}>—</p>
            </div>

            {/* Card 4: HIGHEST LOSS FUND */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-6 py-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Highest Loss Fund</p>
              <p className={cn("text-sm font-bold text-slate-400 italic", blur)}>—</p>
            </div>

            {/* Card 5: AVG. HOLDING AGE */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-6 py-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Avg. Holding Age</p>
              <p className={cn("text-sm font-bold text-slate-400 italic", blur)}>—</p>
              <p className="text-xs text-slate-400 mt-0.5">Active funds</p>
            </div>
          </div>
        </div>
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 lg:col-span-2">
          <h3 className="text-lg font-bold mb-6">Portfolio Growth vs Benchmark (₹)</h3>
          <div className="h-80">
            {!dashboardPerf ? (
              <div className="flex items-center justify-center h-full bg-slate-50 rounded-xl border border-dashed border-slate-200 p-8 text-center">
                <p className="text-slate-400 font-medium">
                  Portfolio growth chart requires a Nifty 50 TRI benchmark to be configured in the Benchmarks tab.
                </p>
              </div>
            ) : dashboardPerf.timeSeries.length === 0 ? (
              <div className="flex items-center justify-center h-full bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <p className="text-slate-400 font-medium">Not enough data for growth chart.</p>
              </div>
            ) : (
              <div className={cn("h-full", blur)}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dashboardPerf.timeSeries}>
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
                    tickFormatter={(v) => formatIndianNumber(v)}
                  />
                  <Tooltip 
                    formatter={(value: number) => formatCurrency(value)}
                    labelFormatter={(label) => new Date(label).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="portfolioValue" 
                    name="Your Portfolio" 
                    stroke="#01696f" 
                    strokeWidth={3} 
                    dot={false} 
                  />
                  <Line 
                    type="monotone" 
                    dataKey="investedValue" 
                    name="Amount Invested" 
                    stroke="#0891b2" 
                    strokeWidth={2} 
                    strokeDasharray="5 5" 
                    dot={false} 
                  />
                  <Line 
                    type="monotone" 
                    dataKey="benchmarkValue" 
                    name={dashboardPerf.benchmarkName} 
                    stroke="#94a3b8" 
                    strokeWidth={2} 
                    strokeDasharray="4 4" 
                    dot={false} 
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 lg:col-span-2">
          <h3 className="text-lg font-bold mb-6">Investment Trend</h3>
          {investmentTrend.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              <p className="text-slate-400 font-medium">No transaction data available</p>
            </div>
          ) : (
            <div className={cn("h-80", blur)}>
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
