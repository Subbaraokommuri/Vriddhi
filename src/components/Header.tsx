import React from 'react';
import { Folio } from '../lib/types';

interface HeaderProps {
  activeTab: string;
  folios: Folio[];
}

export function Header({ 
  activeTab, 
  folios
}: HeaderProps) {
  const displayTabName = activeTab === 'fundsxirr' ? 'Funds & Folios' : activeTab.replace(/([A-Z])/g, ' $1').trim().replace('-', ' ');

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-10">
      <h1 className="text-xl font-semibold capitalize whitespace-nowrap overflow-hidden text-ellipsis">
        {displayTabName}
      </h1>
      <div className="flex items-center gap-8">
        {activeTab === 'fundsxirr' && (
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium text-slate-400">
              {folios.filter(f => f.currentUnits > 0).length} active folios monitored
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
