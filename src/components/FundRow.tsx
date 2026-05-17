import React from 'react';
import { FolioXirr } from '../lib/types';
import { formatCurrency, formatPercent, formatDate, cn, formatFundName } from '../lib/utils';
import { FolioTagChips } from './FolioTagChips.tsx';
import { AlertTriangle } from 'lucide-react';

interface FundRowProps {
  folio: FolioXirr;
  themes: any[];
  onTagsChanged: () => void;
}

export const FundRow: React.FC<FundRowProps> = ({ folio, themes, onTagsChanged }) => {
  const gainColor = folio.gainAmount >= 0 ? 'text-emerald-600' : 'text-rose-600';
  const xirrColor = folio.xirr !== null ? (folio.xirr >= 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-400';

  return (
    <tr className={cn(
      "hover:bg-slate-50 transition-colors border-b border-slate-100",
      !folio.isActive && "opacity-50"
    )}>
      <td className="px-6 py-4">
        <div className="flex flex-col">
          <p 
            className="font-semibold text-sm text-slate-800 truncate max-w-[280px]" 
            title={folio.fundName}
          >
            {formatFundName(folio.fundName)}
          </p>
          <p className="text-xs text-slate-400 font-medium">Folio: {folio.folioNumber}</p>
        </div>
      </td>
      <td className="px-6 py-4 text-right tabular-nums text-sm font-medium text-slate-600">
        {folio.units.toFixed(3)}
      </td>
      <td className="px-6 py-4 text-right tabular-nums text-sm font-medium text-slate-600">
        {formatCurrency(folio.investedAmount)}
      </td>
      <td className="px-6 py-4 text-right tabular-nums text-sm font-bold text-slate-800">
        {formatCurrency(folio.currentValue)}
      </td>
      <td className={cn("px-6 py-4 text-right tabular-nums text-sm font-bold", gainColor)}>
        {formatCurrency(folio.gainAmount)}
      </td>
      <td className={cn("px-6 py-4 text-right tabular-nums text-sm font-bold", gainColor)}>
        {folio.gainPercent !== null ? formatPercent(folio.gainPercent / 100) : '—'}
      </td>
      <td className={cn("px-6 py-4 text-right tabular-nums text-sm font-bold", xirrColor)}>
        <div className="flex items-center justify-end gap-1">
          {folio.xirr !== null ? formatPercent(folio.xirr) : '—'}
          {folio.xirrWarning && (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" title="XIRR may be unreliable" />
          )}
        </div>
      </td>
      <td className="px-6 py-4 text-right tabular-nums text-sm font-medium text-slate-600">
        {folio.nav ? formatCurrency(folio.nav) : '—'}
      </td>
      <td className="px-6 py-4 text-right tabular-nums text-[10px] font-bold text-slate-400 uppercase tracking-tight">
        {folio.navDate ? formatDate(folio.navDate) : '—'}
      </td>
      <td className="px-6 py-4">
        <FolioTagChips 
          folioId={folio.folioId} 
          themes={themes} 
          onUpdate={onTagsChanged}
        />
      </td>
    </tr>
  );
}
