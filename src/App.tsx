/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  PieChart, 
  Briefcase, 
  Database, 
  History, 
  Upload, 
  TrendingUp, 
  TrendingDown, 
  Plus, 
  RefreshCw,
  Search,
  Filter,
  ChevronRight,
  AlertCircle,
  FileText,
  Download,
  Calendar
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
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
import { cn, formatCurrency, formatIndianNumber, formatPercent } from './lib/utils';
import { Summary, Folio, Portfolio, Transaction, Fund } from './lib/types';
import { BenchmarkXirrCell } from './components/BenchmarkXirrCell';
import { LogsView } from './components/LogsView';
import { CasImporter } from './components/CasImporter';
import { FundsList } from './components/FundsList';

type Tab = 'dashboard' | 'xirr' | 'portfolios' | 'funds' | 'transactions' | 'benchmarks' | 'logs' | 'import';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [activeOnlyFunds, setActiveOnlyFunds] = useState(false);
  const [activeOnlyXirr, setActiveOnlyXirr] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [folios, setFolios] = useState<Folio[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [userBenchmarks, setUserBenchmarks] = useState<any[]>([]);
  const [selectedBenchmarkIds, setSelectedBenchmarkIds] = useState<string[]>([]);
  const [overallBenchmarkData, setOverallBenchmarkData] = useState<any>(null);
  const [growthData, setGrowthData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [summaryRes, foliosRes, portfoliosRes, txnsRes, fundsRes, benchmarksRes] = await Promise.all([
        fetch('/api/summary').then(r => r.json()),
        fetch('/api/folios').then(r => r.json()),
        fetch('/api/portfolios').then(r => r.json()),
        fetch('/api/transactions').then(r => r.json()),
        fetch('/api/funds').then(r => r.json()),
        fetch('/api/user-benchmarks').then(r => r.json()),
      ]);
      setSummary(summaryRes);
      setFolios(foliosRes);
      setPortfolios(portfoliosRes);
      setTransactions(txnsRes);
      setFunds(fundsRes);
      setUserBenchmarks(benchmarksRes);

      // Fetch overall benchmark comparison (Nifty 50)
      const nifty = benchmarksRes.find((b: any) => b.symbol === '^NSEI');
      if (nifty) {
        const res = await fetch(`/api/benchmark-xirr?portfolio_id=all&benchmark_ids=${nifty.id}`);
        const result = await res.json();
        setOverallBenchmarkData(result);

        const growthRes = await fetch('/api/portfolio-growth-vs-benchmark?benchmark_symbol=^NSEI');
        const growthResult = await growthRes.json();
        setGrowthData(growthResult);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchLatestNav = async () => {
    setLoading(true);
    try {
      await fetch('/api/fetch-nav', { method: 'POST' });
      fetchData();
    } catch (error) {
      console.error('Failed to fetch NAV:', error);
    } finally {
      setLoading(false);
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'xirr', label: 'XIRR Report', icon: TrendingUp },
    { id: 'portfolios', label: 'Portfolios', icon: Briefcase },
    { id: 'funds', label: 'Funds', icon: Database },
    { id: 'transactions', label: 'Transactions', icon: History },
    { id: 'benchmarks', label: 'Benchmarks', icon: PieChart },
    { id: 'logs', label: 'Logs', icon: FileText },
    { id: 'import', label: 'Import CAS', icon: Upload },
  ];

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6">
          <div className="flex items-center gap-2 text-[#01696f] font-bold text-xl">
            <PieChart className="w-8 h-8" />
            <span>FolioTracker</span>
          </div>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as Tab)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                activeTab === item.id 
                  ? "bg-[#01696f]/10 text-[#01696f]" 
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-200">
          <button 
            onClick={fetchLatestNav}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Update NAVs
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-10">
          <h1 className="text-xl font-semibold capitalize">{activeTab.replace('-', ' ')}</h1>
          <div className="flex items-center gap-8">
            {(activeTab === 'funds' || activeTab === 'xirr') && (
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-400">
                  Showing {folios.filter(f => f.currentUnits > 0).length} of {folios.length} folios
                </span>
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Only</span>
                <button
                  onClick={() => activeTab === 'funds' ? setActiveOnlyFunds(!activeOnlyFunds) : setActiveOnlyXirr(!activeOnlyXirr)}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none",
                    (activeTab === 'funds' ? activeOnlyFunds : activeOnlyXirr) ? "bg-[#01696f]" : "bg-slate-200"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                      (activeTab === 'funds' ? activeOnlyFunds : activeOnlyXirr) ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>
            )}
            <div className="text-right">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Net Worth</p>
              <p className="text-lg font-bold text-[#01696f] tabular-nums">
                {summary ? formatCurrency(summary.currentValue) : '₹0'}
              </p>
            </div>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {[
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
                  ].map((card, i) => (
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
                        <BarChart data={Object.entries(folios.reduce((acc, f) => {
                          const cat = f.category || 'Uncategorized';
                          acc[cat] = (acc[cat] || 0) + f.currentValue;
                          return acc;
                        }, {} as Record<string, number>)).map(([name, value]) => ({ name, value }))}>
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
            )}

            {activeTab === 'xirr' && (
              <motion.div
                key="xirr"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
              >
                <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-lg font-bold">Fund-wise Performance</h3>
                  <div className="flex gap-2">
                    <button className="p-2 hover:bg-slate-100 rounded-lg"><Filter className="w-5 h-5 text-slate-500" /></button>
                    <button className="p-2 hover:bg-slate-100 rounded-lg"><Search className="w-5 h-5 text-slate-500" /></button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Fund Name</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Invested</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Current Value</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Gain</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Your XIRR</th>
                        {selectedBenchmarkIds.map(id => (
                          <th key={id} className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">
                            {userBenchmarks.find(b => b.id === id)?.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {folios.filter(f => !activeOnlyXirr || f.currentUnits > 0).map((folio) => (
                        <tr key={folio.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4">
                            <p className="font-semibold text-sm">{folio.fund_name}</p>
                            <p className="text-xs text-slate-500">Folio: {folio.folio_number}</p>
                          </td>
                          <td className="px-6 py-4 text-right tabular-nums text-sm font-medium">
                            {formatCurrency(folio.investedAmount)}
                          </td>
                          <td className="px-6 py-4 text-right tabular-nums text-sm font-bold text-[#01696f]">
                            {formatCurrency(folio.currentValue)}
                          </td>
                          <td className={cn(
                            "px-6 py-4 text-right tabular-nums text-sm font-semibold",
                            folio.currentValue - folio.investedAmount >= 0 ? "text-emerald-600" : "text-rose-600"
                          )}>
                            {formatCurrency(folio.currentValue - folio.investedAmount)}
                          </td>
                          <td className={cn(
                            "px-6 py-4 text-right tabular-nums text-sm font-bold",
                            folio.xirr && folio.xirr >= 0 ? "text-emerald-600" : "text-rose-600"
                          )}>
                            {formatPercent(folio.xirr)}
                          </td>
                          <BenchmarkXirrCell folioId={folio.id} benchmarkIds={selectedBenchmarkIds} actualXirr={folio.xirr} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {activeTab === 'portfolios' && (
              <motion.div
                key="portfolios"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold">Your Portfolios</h3>
                  <button className="flex items-center gap-2 px-4 py-2 bg-[#01696f] text-white rounded-xl text-sm font-bold hover:bg-[#015a5f] transition-colors">
                    <Plus className="w-4 h-4" />
                    New Portfolio
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {portfolios.map((p) => (
                    <div key={p.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                      <div className="p-6 flex items-start justify-between" style={{ borderTop: `4px solid ${p.color}` }}>
                        <div>
                          <h4 className="text-lg font-bold">{p.name}</h4>
                          <p className="text-sm text-slate-500">{p.description}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-slate-400 uppercase">XIRR</p>
                          <p className="text-xl font-bold text-emerald-600">{formatPercent(p.xirr)}</p>
                        </div>
                      </div>
                      <div className="px-6 py-4 bg-slate-50 border-y border-slate-100 flex justify-between">
                        <div>
                          <p className="text-xs text-slate-500 font-bold uppercase">Current Value</p>
                          <p className="text-lg font-bold tabular-nums">{formatCurrency(p.currentValue)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500 font-bold uppercase">Invested</p>
                          <p className="text-lg font-bold tabular-nums">{formatCurrency(p.investedAmount)}</p>
                        </div>
                      </div>
                      <div className="p-4">
                        <p className="text-xs font-bold text-slate-400 uppercase px-2 mb-2">Folios ({p.folios.length})</p>
                        <div className="space-y-1">
                          {p.folios.map(f => (
                            <div key={f.id} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg group">
                              <span className="text-sm font-medium text-slate-700 truncate">{f.fund_name}</span>
                              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'funds' && (
              <motion.div
                key="funds"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <FundsList folios={folios} activeOnly={activeOnlyFunds} />
              </motion.div>
            )}

            {activeTab === 'transactions' && (
              <motion.div
                key="transactions"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
              >
                <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                  <h3 className="text-lg font-bold">Transaction History</h3>
                  <div className="flex gap-2">
                    <button className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-bold transition-colors">
                      <Filter className="w-4 h-4" />
                      Filter
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
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
                            <p className="font-semibold text-sm">{t.fund_name}</p>
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
                </div>
              </motion.div>
            )}

            {activeTab === 'benchmarks' && (
              <motion.div
                key="benchmarks"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold">Benchmark Management</h3>
                  <div className="flex gap-3">
                    <button 
                      onClick={async () => {
                        setLoading(true);
                        await fetch('/api/fetch-all-benchmarks', { method: 'POST' });
                        fetchData();
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-bold transition-colors"
                    >
                      <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                      Refresh All Prices
                    </button>
                    <button className="flex items-center gap-2 px-4 py-2 bg-[#01696f] text-white rounded-xl text-sm font-bold hover:bg-[#015a5f] transition-colors">
                      <Plus className="w-4 h-4" />
                      Add Benchmark
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Benchmark Name</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Symbol / AMFI</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Source</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Category</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Status</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {userBenchmarks.map((b) => (
                          <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: b.color || '#01696f' }} />
                                <span className="font-semibold text-sm">{b.name}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm font-mono text-slate-500">{b.symbol}</td>
                            <td className="px-6 py-4">
                              <span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold uppercase text-slate-600">
                                {b.source}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-600 capitalize">{b.category?.replace('_', ' ')}</td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                b.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                              )}>
                                {b.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button 
                                onClick={() => {
                                  if (selectedBenchmarkIds.includes(b.id)) {
                                    setSelectedBenchmarkIds(selectedBenchmarkIds.filter(id => id !== b.id));
                                  } else if (selectedBenchmarkIds.length < 3) {
                                    setSelectedBenchmarkIds([...selectedBenchmarkIds, b.id]);
                                  }
                                }}
                                className={cn(
                                  "text-xs font-bold px-3 py-1 rounded-lg transition-colors",
                                  selectedBenchmarkIds.includes(b.id) 
                                    ? "bg-[#01696f] text-white" 
                                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                )}
                              >
                                {selectedBenchmarkIds.includes(b.id) ? 'Comparing' : 'Compare'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className="text-xs text-slate-400 italic">
                  Note: TRI (Total Return Index) data includes dividends reinvested and is more accurate for comparison with growth mutual funds.
                </p>
              </motion.div>
            )}

            {activeTab === 'logs' && (
              <motion.div
                key="logs"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <LogsView />
              </motion.div>
            )}

            {activeTab === 'import' && (
              <motion.div
                key="import"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <CasImporter onImportSuccess={fetchData} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
