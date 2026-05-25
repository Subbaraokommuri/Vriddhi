import React from 'react';
import { FundGroupXirr, FolioXirr, GroupBenchmarkXirrResult, FolioBenchmarkXirrResult } from '../lib/types';
import { FundRow } from './FundRow';
import { formatCurrency, formatPercent, formatDate, cn } from '../lib/utils';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';

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

interface FundGroupRowProps {
  group: FundGroupXirr;
  visibleFolios: FolioXirr[];
  isExpanded: boolean;
  onToggle: () => void;
  themes: any[];
  onTagsChanged: () => void;
  benchmarkResult?: GroupBenchmarkXirrResult;
  foliosBenchmarkMap?: Map<string, FolioBenchmarkXirrResult>;
  benchmarkLoading?: boolean;
  isBenchmarkActive?: boolean;
}

export const FundGroupRow: React.FC<FundGroupRowProps> = ({
  group,
  visibleFolios,
  isExpanded,
  onToggle,
  themes,
  onTagsChanged,
  benchmarkResult,
  foliosBenchmarkMap,
  benchmarkLoading,
  isBenchmarkActive,
}) => {
  const gainColor = group.gainAmount >= 0 ? 'text-emerald-600' : 'text-rose-600';
  const xirrColor = group.groupXirr !== null ? (group.groupXirr >= 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-400';
  const benchmarkXirrColor = benchmarkResult && benchmarkResult.benchmarkXirr !== null
    ? (benchmarkResult.benchmarkXirr >= 0 ? 'text-emerald-600' : 'text-rose-600')
    : 'text-slate-400';
  const alphaColor = benchmarkResult && benchmarkResult.alpha !== null
    ? (benchmarkResult.alpha > 0 ? 'text-emerald-600' : benchmarkResult.alpha < 0 ? 'text-rose-600' : 'text-slate-500')
    : 'text-slate-400';

  return (
    <>
      <tr
        className="transition-colors border-b border-slate-200 bg-slate-50/70 font-medium cursor-pointer hover:bg-slate-100/80"
        onClick={onToggle}
      >
        <td className="px-6 py-4">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="mt-1 text-slate-500 focus:outline-none hover:text-slate-700 transition-colors shrink-0"
              title="View folio details"
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-slate-800 truncate max-w-[280px]" title={group.clean_name || group.fundName}>
                  {group.simple_name || group.clean_name || group.fundName}
                </span>
                <span className="text-xs font-medium text-gray-400 shrink-0">
                  (Folios: {group.folioCount})
                </span>
              </div>
            </div>
          </div>
        </td>
        <td className={cn(
          "px-6 py-4 text-right tabular-nums text-sm font-medium",
          isNavStale(group.folios[0]?.navDate) ? "text-red-500" : "text-slate-600"
        )}>
          {group.folios[0]?.nav ? formatCurrency(group.folios[0].nav) : '—'}
        </td>
        <td className="px-6 py-4 text-right tabular-nums text-sm font-medium text-slate-600">
          {group.totalUnits.toFixed(2)}
        </td>
        <td className="px-6 py-4 text-right tabular-nums text-sm font-medium text-slate-600">
          {formatCurrency(group.totalInvested)}
        </td>
        <td className="px-6 py-4 text-right tabular-nums text-sm font-bold text-slate-800">
          {formatCurrency(group.totalCurrentValue)}
        </td>
        <td className={cn("px-6 py-4 text-right tabular-nums text-sm font-bold", gainColor)}>
          {formatCurrency(group.gainAmount)}
        </td>
        <td className={cn("px-6 py-4 text-right tabular-nums text-sm font-bold", gainColor)}>
          {formatPercent(group.gainPercent / 100)}
        </td>
        <td className={cn("px-6 py-4 text-right tabular-nums text-sm font-bold", xirrColor)}>
          <div className="flex items-center justify-end gap-1">
            {group.groupXirr === null ? '--' : formatPercent(group.groupXirr)}
            {group.groupXirrWarning && (
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
      {isExpanded &&
        visibleFolios.map((folio) => (
          <FundRow
            key={folio.folioId}
            folio={folio}
            themes={themes}
            onTagsChanged={onTagsChanged}
            isSubRow={true}
            benchmarkResult={foliosBenchmarkMap?.get(folio.folioId)}
            benchmarkLoading={benchmarkLoading}
            isBenchmarkActive={isBenchmarkActive}
          />
        ))}
    </>
  );
};
