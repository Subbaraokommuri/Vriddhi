import React, { useState, useEffect } from 'react';
import { formatCurrency } from '../lib/utils';
import { Summary, Folio } from '../lib/types';
import { fetchSummary, fetchFolios } from '../lib/api';

interface HeaderProps {
  activeTab: string;
}

export function Header({ activeTab }: HeaderProps) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [folios, setFolios] = useState<Folio[]>([]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [s, f] = await Promise.all([fetchSummary(), fetchFolios()]);
        setSummary(s);
        setFolios(f);
      } catch (e) {
        console.error('Header data fetch failed:', e);
      }
    };
    loadData();
  }, [activeTab]);

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-10">
      <h1 className="text-xl font-semibold capitalize">{activeTab.replace('-', ' ')}</h1>
      <div className="flex items-center gap-8">
        {(activeTab === 'funds' || activeTab === 'xirr') && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-slate-400">
              Showing {folios.filter(f => f.currentUnits > 0).length} of {folios.length} folios
            </span>
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
