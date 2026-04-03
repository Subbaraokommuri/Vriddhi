import React, { useState, useEffect } from 'react';
import { formatCurrency } from '../lib/utils';
import { Summary, Folio } from '../lib/types';
import { fetchSummary, fetchFolios } from '../lib/api';

interface HeaderProps {
  activeTab: string;
  summary: Summary | null;
  folios: Folio[];
  activeOnlyFunds: boolean;
  setActiveOnlyFunds: (val: boolean) => void;
  activeOnlyXirr: boolean;
  setActiveOnlyXirr: (val: boolean) => void;
}

export function Header({ 
  activeTab, 
  summary, 
  folios, 
  activeOnlyFunds, 
  setActiveOnlyFunds, 
  activeOnlyXirr, 
  setActiveOnlyXirr 
}: HeaderProps) {
  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-10">
      <h1 className="text-xl font-semibold capitalize">{activeTab.replace('-', ' ')}</h1>
      <div className="flex items-center gap-8">
        {activeTab === 'funds' && (
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={activeOnlyFunds} 
                onChange={(e) => setActiveOnlyFunds(e.target.checked)}
                className="rounded border-slate-300 text-[#01696f] focus:ring-[#01696f]"
              />
              <span className="text-xs font-medium text-slate-600">Active Only</span>
            </label>
            <span className="text-xs font-medium text-slate-400">
              Showing {folios.filter(f => f.currentUnits > 0).length} of {folios.length} folios
            </span>
          </div>
        )}
        {activeTab === 'xirr' && (
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input 
                type="checkbox" 
                checked={activeOnlyXirr} 
                onChange={(e) => setActiveOnlyXirr(e.target.checked)}
                className="rounded border-slate-300 text-[#01696f] focus:ring-[#01696f]"
              />
              <span className="text-xs font-medium text-slate-600">Active Only</span>
            </label>
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
  );
}
