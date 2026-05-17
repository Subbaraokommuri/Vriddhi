/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  LayoutDashboard, 
  PieChart, 
  Database, 
  History, 
  Upload, 
  TrendingUp, 
  FileText,
  Tag,
  BarChart2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Sidebar } from './components/Sidebar.tsx';
import { Header } from './components/Header.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { XirrReport } from './components/XirrReport.tsx';
import { FundsList } from './components/FundsList.tsx';
import { TransactionsList } from './components/TransactionsList.tsx';
import { BenchmarksManager } from './components/BenchmarksManager.tsx';
import { LogsView } from './components/LogsView.tsx';
import { CasImport } from './components/CasImport.tsx';
import { TagManager } from './components/TagManager.tsx';
import { RelativePerformance } from './components/RelativePerformance.tsx';
import { Summary, Folio, Transaction, TagTheme, UserBenchmark, InvestmentTrendPoint, RelativePerformanceResult, DashboardStats } from './lib/types.ts';
import { 
  fetchSummary, 
  fetchFolios, 
  getTransactions,
  fetchBenchmarks,
  getTagThemes,
  getUnassignedTags,
  createTagTheme,
  renameTagTheme,
  deleteTagTheme,
  addTagToTheme,
  renameTag,
  deleteTag,
  deleteUnassignedTag,
  assignAllMfTag,
  getUserBenchmarks,
  getInvestmentTrend,
  getDashboardPerformance,
  getDashboardStats
} from './lib/api.ts';

type Tab = 'dashboard' | 'xirr' | 'funds' | 'transactions' | 'benchmarks' | 'logs' | 'import' | 'tags' | 'performance';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [folios, setFolios] = useState<Folio[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [userBenchmarks, setUserBenchmarks] = useState<UserBenchmark[]>([]);
  const [tagThemes, setTagThemes] = useState<TagTheme[]>([]);
  const [unassignedTags, setUnassignedTags] = useState<string[]>([]);
  const [investmentTrend, setInvestmentTrend] = useState<InvestmentTrendPoint[]>([]);
  const [dashboardPerf, setDashboardPerf] = useState<RelativePerformanceResult | null>(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeOnlyFunds, setActiveOnlyFunds] = useState(false);
  const [activeOnlyXirr, setActiveOnlyXirr] = useState(false);

  // Performance Selection State (Lifted for persistence)
  const [perfThemeId, setPerfThemeId] = useState<string>('');
  const [perfTag, setPerfTag] = useState<string>('');
  const [perfBenchmark, setPerfBenchmark] = useState<string>('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [summaryRes, foliosRes, transactionsRes, benchmarksRes, tagThemesRes, unassignedTagsRes, trendRes, statsRes] = await Promise.all([
        fetchSummary(),
        fetchFolios(),
        getTransactions(),
        fetchBenchmarks(),
        getTagThemes(),
        getUnassignedTags(),
        getInvestmentTrend(),
        getDashboardStats()
      ]);
      setSummary(summaryRes);
      setFolios(foliosRes);
      setTransactions(transactionsRes);
      setUserBenchmarks(benchmarksRes);
      setTagThemes(tagThemesRes);
      setUnassignedTags(unassignedTagsRes);
      setInvestmentTrend(trendRes.data);
      setDashboardStats(statsRes);

      // Dashbord Performance Wiring
      try {
        const nifty50 = benchmarksRes.find((b: any) => 
          b.is_active && b.symbol.toLowerCase().includes('nifty 50'));
        if (nifty50) {
          const perfRes = await getDashboardPerformance(nifty50.symbol);
          setDashboardPerf(perfRes);
        } else {
          setDashboardPerf(null);
        }
      } catch (err) {
        console.error('Error fetching dashboard performance:', err);
        setDashboardPerf(null);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshBenchmarks = useCallback(async () => {
    try {
      const data = await getUserBenchmarks();
      setUserBenchmarks(data);
    } catch (error) {
      console.error('Error refreshing benchmarks:', error);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'xirr', label: 'XIRR Report', icon: TrendingUp },
    { id: 'funds', label: 'Funds', icon: Database },
    { id: 'transactions', label: 'Transactions', icon: History },
    { id: 'benchmarks', label: 'Benchmarks', icon: PieChart },
    { id: 'tags', label: 'Tag Manager', icon: Tag },
    { id: 'performance', label: 'Performance', icon: BarChart2 },
    { id: 'logs', label: 'Logs', icon: FileText },
    { id: 'import', label: 'Import CAS PDF', icon: Upload },
  ];

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        navItems={navItems} 
      />
      
      <main className="flex-1 overflow-y-auto">
        <Header 
          activeTab={activeTab} 
          folios={folios}
          activeOnlyFunds={activeOnlyFunds}
          setActiveOnlyFunds={setActiveOnlyFunds}
          activeOnlyXirr={activeOnlyXirr}
          setActiveOnlyXirr={setActiveOnlyXirr}
        />

        <div className="p-8 max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'dashboard' && (
                <Dashboard 
                  summary={summary}
                  folios={folios}
                  dashboardPerf={dashboardPerf}
                  investmentTrend={investmentTrend} 
                  dashboardStats={dashboardStats}
                />
              )}
              {activeTab === 'xirr' && (
                <XirrReport 
                  folios={folios}
                  activeOnlyXirr={activeOnlyXirr}
                />
              )}
              {activeTab === 'funds' && (
                <FundsList 
                  themes={tagThemes} 
                  folios={folios} 
                  activeOnly={activeOnlyFunds} 
                  setActiveOnly={setActiveOnlyFunds}
                />
              )}
              {activeTab === 'transactions' && <TransactionsList transactions={transactions} />}
              {activeTab === 'benchmarks' && (
                <BenchmarksManager 
                  userBenchmarks={userBenchmarks} 
                  onRefresh={fetchData}
                  onBenchmarkAdded={refreshBenchmarks}
                />
              )}
              {activeTab === 'logs' && <LogsView />}
              {activeTab === 'import' && <CasImport onImportSuccess={fetchData} />}
              {activeTab === 'tags' && (
                <TagManager 
                  themes={tagThemes}
                  unassignedTags={unassignedTags}
                  onCreateTheme={async (name) => {
                    await createTagTheme(name);
                    fetchData();
                  }}
                  onRenameTheme={async (id, name) => {
                    await renameTagTheme(id, name);
                    fetchData();
                  }}
                  onDeleteTheme={async (id) => {
                    await deleteTagTheme(id);
                    fetchData();
                  }}
                  onAddTag={async (id, tag) => {
                    await addTagToTheme(id, tag);
                    fetchData();
                  }}
                  onRenameTag={async (id, old, newTag) => {
                    await renameTag(id, old, newTag);
                    fetchData();
                  }}
                  onDeleteTag={async (id, tag) => {
                    await deleteTag(id, tag);
                    fetchData();
                  }}
                  onDeleteUnassignedTag={async (tag) => {
                    await deleteUnassignedTag(tag);
                    fetchData();
                  }}
                  onSyncAllMf={async () => {
                    const result = await assignAllMfTag();
                    fetchData();
                    return result;
                  }}
                />
              )}
            </motion.div>
          </AnimatePresence>

          <div style={{ display: activeTab === 'performance' ? 'block' : 'none' }}>
            <RelativePerformance
              themes={tagThemes}
              benchmarks={userBenchmarks.filter(b => b.is_active).map((b: any) => ({ symbol: b.symbol, name: b.name }))}
              selectedThemeId={perfThemeId}
              selectedTag={perfTag}
              selectedBenchmark={perfBenchmark}
              onThemeChange={setPerfThemeId}
              onTagChange={setPerfTag}
              onBenchmarkChange={setPerfBenchmark}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
