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
  FileText,
  Tag,
  BarChart2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Sidebar } from './components/Sidebar.tsx';
import { Header } from './components/Header.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { XirrReport } from './components/XirrReport.tsx';
import { Portfolios } from './components/Portfolios.tsx';
import { FundsList } from './components/FundsList.tsx';
import { TransactionsList } from './components/TransactionsList.tsx';
import { BenchmarksManager } from './components/BenchmarksManager.tsx';
import { LogsView } from './components/LogsView.tsx';
import { CasImport } from './components/CasImport.tsx';
import { TagManager } from './components/TagManager.tsx';
import { RelativePerformance } from './components/RelativePerformance.tsx';
import { Summary, Folio, Transaction, TagTheme } from './lib/types.ts';
import { 
  fetchSummary, 
  fetchFolios, 
  fetchTransactions, 
  fetchBenchmarks,
  getTagThemes,
  getUnassignedTags,
  createTagTheme,
  renameTagTheme,
  deleteTagTheme,
  addTagToTheme,
  renameTag,
  deleteTag,
  deleteUnassignedTag
} from './lib/api.ts';

type Tab = 'dashboard' | 'xirr' | 'portfolios' | 'funds' | 'transactions' | 'benchmarks' | 'logs' | 'import' | 'tags' | 'performance';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [folios, setFolios] = useState<Folio[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [userBenchmarks, setUserBenchmarks] = useState<any[]>([]);
  const [tagThemes, setTagThemes] = useState<TagTheme[]>([]);
  const [unassignedTags, setUnassignedTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeOnlyFunds, setActiveOnlyFunds] = useState(false);
  const [activeOnlyXirr, setActiveOnlyXirr] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [summaryRes, foliosRes, transactionsRes, benchmarksRes, tagThemesRes, unassignedTagsRes] = await Promise.all([
        fetchSummary(),
        fetchFolios(),
        fetchTransactions(),
        fetchBenchmarks(),
        getTagThemes(),
        getUnassignedTags()
      ]);
      setSummary(summaryRes);
      setFolios(foliosRes);
      setTransactions(transactionsRes);
      setUserBenchmarks(benchmarksRes);
      setTagThemes(tagThemesRes);
      setUnassignedTags(unassignedTagsRes);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'xirr', label: 'XIRR Report', icon: TrendingUp },
    { id: 'portfolios', label: 'Portfolios', icon: Briefcase },
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
        loading={loading}
        onUpdateNavs={fetchData}
      />
      
      <main className="flex-1 overflow-y-auto">
        <Header 
          activeTab={activeTab} 
          summary={summary}
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
              {activeTab === 'dashboard' && <Dashboard />}
              {activeTab === 'xirr' && (
                <XirrReport 
                  folios={folios}
                  activeOnlyXirr={activeOnlyXirr}
                />
              )}
              {activeTab === 'portfolios' && <Portfolios />}
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
                />
              )}
              {activeTab === 'performance' && (
                <RelativePerformance
                  themes={tagThemes}
                  benchmarks={userBenchmarks.filter(b => b.is_active).map((b: any) => ({ symbol: b.symbol, name: b.name }))}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
