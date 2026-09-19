import React, { useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '../lib/utils';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: any) => void;
  navItems: any[];
}

export function Sidebar({ activeTab, setActiveTab, navItems }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "bg-white border-r border-slate-200 flex flex-col shrink-0 transition-[width] duration-200",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className={cn("flex", collapsed ? "justify-center p-3" : "justify-end px-3 pt-3")}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
      </div>
      {!collapsed && (
        <div className="px-6 pb-6">
          <div className="flex flex-col gap-0.5 text-[#01696f]">
            <img src="/Vriddi-Logo.png" alt="Vriddhi" className="w-44 h-auto object-contain" />
            <p className="text-[10px] font-medium text-slate-400 text-center leading-tight mt-1">
              Personal Finance App<br />
              Developed by Subbarao Kommuri
            </p>
          </div>
        </div>
      )}
      <nav className={cn("flex-1 space-y-1 overflow-y-auto", collapsed ? "px-2" : "px-4")}>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            title={collapsed ? item.label : undefined}
            className={cn(
              "w-full flex items-center rounded-lg text-sm font-medium transition-colors",
              collapsed ? "justify-center p-3" : "gap-3 px-4 py-3",
              activeTab === item.id
                ? "bg-[#01696f]/10 text-[#01696f]"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            )}
          >
            <item.icon className="w-5 h-5 shrink-0" />
            {!collapsed && item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
