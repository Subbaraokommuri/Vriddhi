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
  const displayTabName =
    activeTab === 'fundsxirr' ? 'Funds & Folios' :
    activeTab === 'performance' ? 'Relative Performance' :
    activeTab === 'tax' ? 'Income Tax' :
    activeTab.replace(/([A-Z])/g, ' $1').trim().replace('-', ' ');

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-10">
      <h1 className="text-xl font-semibold capitalize whitespace-nowrap overflow-hidden text-ellipsis">
        {displayTabName}
      </h1>
      <div className="flex items-center gap-8">
      </div>
    </header>
  );
}
