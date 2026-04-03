import React, { useState } from 'react';
import { PieChart, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { updateNavs } from '../lib/api';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
  navItems: any[];
}

export function Sidebar({ activeTab, setActiveTab, navItems }: SidebarProps) {
  const [loading, setLoading] = useState(false);

  const handleUpdateNavs = async () => {
    setLoading(true);
    try {
      await updateNavs();
      window.location.reload();
    } catch (error) {
      console.error('Failed to update NAVs:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
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
      </nav>
      <div className="p-4 border-t border-slate-200">
        <button 
          onClick={handleUpdateNavs}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          Update NAVs
        </button>
      </div>
    </aside>
  );
}
