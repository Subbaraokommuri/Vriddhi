import React from 'react';
import { cn } from '../lib/utils';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
  navItems: any[];
}

export function Sidebar({ activeTab, setActiveTab, navItems }: SidebarProps) {
  return (
    <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
      <div className="p-6">
        <div className="flex flex-col gap-0.5 text-[#01696f]">
          <img src="/vriddhi-logo.svg" alt="Vriddhi" className="w-44 h-auto object-contain" />
          <p className="text-[10px] font-medium text-slate-400 text-center leading-tight mt-1">
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
      </nav>
    </aside>
  );
}
