import React, { useState } from 'react';
import { PieChart, RefreshCw, Database } from 'lucide-react';
import { cn } from '../lib/utils';
import { updateNavs, refreshAmfiCodes, backfillNavHistory } from '../lib/api';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
  navItems: any[];
  loading: boolean;
  onUpdateNavs: () => void;
}

export function Sidebar({ activeTab, setActiveTab, navItems, loading, onUpdateNavs }: SidebarProps) {
  const [updating, setUpdating] = useState(false);
  const [refreshingCodes, setRefreshingCodes] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [errors, setErrors] = useState<{ name: string; error: string }[]>([]);

  const handleUpdateNavs = async () => {
    setUpdating(true);
    setErrors([]);
    try {
      const result = await updateNavs();
      if (result.errors && result.errors.length > 0) {
        setErrors(result.errors.map(e => ({ name: e.name, error: e.error })));
      }
      onUpdateNavs();
    } catch (error) {
      console.error('Failed to update NAVs:', error);
      setErrors([{ name: 'System', error: String(error) }]);
    } finally {
      setUpdating(false);
    }
  };

  const handleRefreshCodes = async () => {
    setRefreshingCodes(true);
    setErrors([]);
    try {
      const result = await refreshAmfiCodes();
      alert(`AMFI Refresh Complete: ${result.updated} updated, ${result.notFound} not found, ${result.failedCount} failed.`);
      onUpdateNavs();
    } catch (error) {
      console.error('Failed to refresh AMFI codes:', error);
      setErrors([{ name: 'AMFI Refresh', error: String(error) }]);
    } finally {
      setRefreshingCodes(false);
    }
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    setErrors([]);
    try {
      // The backfill can take a while, so we alert the user
      const result = await backfillNavHistory();
      alert(`Backfill complete: ${result.full_backfill} new, ${result.incremental} updated, ${result.up_to_date} current`);
      onUpdateNavs();
    } catch (error) {
      console.error('Failed to backfill NAV history:', error);
      setErrors([{ name: 'NAV Backfill', error: String(error) }]);
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
      <div className="p-6">
        <div className="flex flex-col gap-0.5 text-[#01696f]">
          <div className="flex items-center gap-2 font-bold text-2xl">
            <PieChart className="w-8 h-8" />
            <span>Vriddhi</span>
          </div>
          <p className="text-[10px] font-medium text-slate-400 pl-10 leading-tight">
            Personal Finance App<br />
            Developed by Subbarao Kommuri
          </p>
        </div>
      </div>
      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
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
        
        {errors.length > 0 && (
          <div className="mt-4 p-3 bg-rose-50 rounded-lg border border-rose-100">
            <p className="text-xs font-bold text-rose-700 mb-2 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Update Errors
            </p>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {errors.map((err, i) => (
                <div key={i} className="text-[10px] text-rose-600 leading-tight">
                  <span className="font-bold">{err.name}:</span> {err.error}
                </div>
              ))}
            </div>
            <button 
              onClick={() => setErrors([])}
              className="mt-2 text-[10px] font-bold text-rose-700 hover:underline"
            >
              Clear Errors
            </button>
          </div>
        )}
      </nav>
      <div className="p-4 border-t border-slate-200 space-y-2">
        {backfilling && (
          <div className="text-[10px] text-slate-500 text-center animate-pulse mb-2">
            Fetching history — this may take 2-3 mins
          </div>
        )}
        <button 
          onClick={handleBackfill}
          disabled={backfilling || loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Database className={cn("w-4 h-4", backfilling && "animate-pulse")} />
          Backfill NAV History
        </button>
        <button 
          onClick={handleRefreshCodes}
          disabled={refreshingCodes || loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Database className={cn("w-4 h-4", refreshingCodes && "animate-pulse")} />
          Refresh AMFI Codes
        </button>
        <button 
          onClick={handleUpdateNavs}
          disabled={updating || loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#01696f] text-white hover:bg-[#01696f]/90 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("w-4 h-4", (updating || loading) && "animate-spin")} />
          Update NAVs
        </button>
      </div>
    </aside>
  );
}
