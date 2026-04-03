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
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { XirrReport } from './components/XirrReport';
import { Portfolios } from './components/Portfolios';
import { FundsList } from './components/FundsList';
import { TransactionsList } from './components/TransactionsList';
import { BenchmarksManager } from './components/BenchmarksManager';
import { LogsView } from './components/LogsView';
import { CasImporter } from './components/CasImporter';
import { Summary, Folio, Transaction } from './lib/types';
import { fetchSummary, fetchFolios, fetchTransactions, fetchBenchmarks } from './lib/api';

type Tab = 'dashboard' | 'xirr' | 'portfolios' | 'funds' | 'transactions' | 'benchmarks' | 'logs' | 'import';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [folios, setFolios] = useState<Folio[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [userBenchmarks, setUserBenchmarks] = useState<any[]>([]);
  const [selectedBenchmarkIds, setSelectedBenchmarkIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeOnlyFunds, setActiveOnlyFunds] = useState(false);
  const [activeOnlyXirr, setActiveOnlyXirr] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [summaryRes, foliosRes, transactionsRes, benchmarksRes] = await Promise.all([
        fetchSummary(),
        fetchFolios(),
        fetchTransactions(),
        fetchBenchmarks(),
      ]);
      setSummary(summaryRes);
      setFolios(foliosRes);
      setTransactions(transactionsRes);
      setUserBenchmarks(benchmarksRes);
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
    { id: 'logs', label: 'Logs', icon: FileText },
    { id: 'import', label: 'Import CAS', icon: Upload },
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
                  selectedBenchmarkIds={selectedBenchmarkIds} 
                  userBenchmarks={userBenchmarks} 
                />
              )}
              {activeTab === 'portfolios' && <Portfolios />}
              {activeTab === 'funds' && <FundsList folios={folios} activeOnly={activeOnlyFunds} />}
              {activeTab === 'transactions' && <TransactionsList transactions={transactions} />}
              {activeTab === 'benchmarks' && (
                <BenchmarksManager 
                  userBenchmarks={userBenchmarks} 
                  selectedBenchmarkIds={selectedBenchmarkIds} 
                  setSelectedBenchmarkIds={setSelectedBenchmarkIds}
                  onRefresh={fetchData}
                />
              )}
              {activeTab === 'logs' && <LogsView />}
              {activeTab === 'import' && <CasImporter onImportSuccess={fetchData} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
