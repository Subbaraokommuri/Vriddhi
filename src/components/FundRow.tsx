import React from 'react';
import { FolioXirr, FolioBenchmarkXirrResult } from '../lib/types';
import { formatCurrency, formatPercent, formatDate, cn } from '../lib/utils';
import { FolioTagChips } from './FolioTagChips.tsx';
import { AlertTriangle } from 'lucide-react';

function isNavStale(navDateStr: string | null | undefined): boolean {
  if (!navDateStr) return false;
  const nav = new Date(navDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  nav.setHours(0, 0, 0, 0);
  let businessDays = 0;
  const cursor = new Date(nav);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= today) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) businessDays++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return businessDays > 1;
}

interface FundRowProps {
  folio: FolioXirr;
  themes: any[];
  onTagsChanged: () => void;
  isSubRow?: boolean;
  benchmarkResult?: FolioBenchmarkXirrResult;
  benchmarkLoading?: boolean;
  isBenchmarkActive?: boolean;
}

export const FundRow: React.FC<FundRowProps> = ({ 
  folio, 
  themes, 
  onTagsChanged, 
  isSubRow = false,
  benchmarkResult,
  benchmarkLoading,
  isBenchmarkActive
}) => {
  const gainColor = folio.gainAmount >= 0 ? 'text-emerald-600' : 'text-rose-600';
  const xirrColor = folio.xirr !== null ? (folio.xirr >= 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-400';
  const benchmarkXirrColor = benchmarkResult && benchmarkResult.benchmarkXirr !== null
    ? (benchmarkResult.benchmarkXirr >= 0 ? 'text-emerald-600' : 'text-rose-600')
    : 'text-slate-400';
  const alphaColor = benchmarkResult && benchmarkResult.alpha !== null
    ? (benchmarkResult.alpha > 0 ? 'text-green-600' : benchmarkResult.alpha < 0 ? 'text-red-500' : 'text-slate-500')
    : 'text-slate-400';

  return (
    <tr className={cn(
      "hover:bg-slate-50 transition-colors border-b border-slate-100",
      isSubRow && "bg-slate-50/40 border-t border-slate-200/50",
      !folio.isActive && "opacity-50"
    )}>
      <td className={cn("px-6 py-4", isSubRow && "pl-12")}>
        <div className="flex flex-col gap-1">
          <p 
            className="font-semibold text-sm text-slate-800 truncate max-w-[280px]" 
            title={folio.clean_name || folio.fundName}
          >
            {folio.simple_name || folio.clean_name || folio.fundName}
          </p>
          {((folio.plan && folio.plan !== 'Unknown') || (folio.fundOption && folio.fundOption !== 'Unknown')) && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {folio.plan && folio.plan !== 'Unknown'
                ? `${folio.plan}${folio.fundOption && folio.fundOption !== 'Unknown'
                    ? ` · ${folio.fundOption}` : ''}`
                : folio.fundOption && folio.fundOption !== 'Unknown'
                    ? folio.fundOption
                    : null
              }
            </p>
          )}
          <p className="text-xs text-slate-400 font-medium">Folio: {folio.folioNumber}</p>
          <FolioTagChips 
            folioId={folio.folioId} 
            themes={themes} 
            onUpdate={onTagsChanged}
          />
        </div>
      </td>
      <td className="px-6 py-4 text-right tabular-nums">
        <div className="flex flex-col items-end">
          <span className={cn(
            "text-sm font-medium",
            isNavStale(folio.navDate) ? "text-red-500" : "text-slate-600"
          )}>
            {folio.nav ? formatCurrency(folio.nav) : '—'}
          </span>
          {folio.navDate && (
            <span className="text-xs text-gray-400 font-normal">
              {formatDate(folio.navDate)}
            </span>
          )}
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
      {isBenchmarkActive && (
        <>
          <td className="px-6 py-4 text-right tabular-nums text-sm font-bold">
            {benchmarkLoading && !benchmarkResult ? (
              <span className="text-slate-400 animate-pulse">…</span>
            ) : benchmarkResult ? (
              <div className="flex items-center justify-end gap-1">
                <span className={benchmarkXirrColor}>
                  {benchmarkResult.benchmarkXirr === null ? '--' : formatPercent(benchmarkResult.benchmarkXirr)}
                </span>
                {benchmarkResult.benchmarkXirrWarning && (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" title="Benchmark XIRR may be unreliable" />
                )}
              </div>
            ) : (
              <span className="text-slate-400 font-normal">—</span>
            )}
          </td>
          <td className={cn("px-6 py-4 text-right tabular-nums text-sm font-bold", alphaColor)}>
            {benchmarkLoading && !benchmarkResult ? (
              <span className="text-slate-400 animate-pulse">…</span>
            ) : benchmarkResult ? (
              <span>
                {benchmarkResult.alpha === null ? '--' : `${benchmarkResult.alpha > 0 ? '+' : ''}${formatPercent(benchmarkResult.alpha)}`}
              </span>
            ) : (
              <span className="text-slate-400 font-normal">—</span>
            )}
          </td>
        </>
      )}
    </tr>
  );
}
