import React from 'react';
import { Search, Filter } from 'lucide-react';
import { cn, formatCurrency, formatPercent } from '../lib/utils';
import { Folio } from '../lib/types';
import { BenchmarkXirrCell } from './BenchmarkXirrCell';

interface XirrReportProps {
  folios: Folio[];
  activeOnlyXirr: boolean;
  selectedBenchmarkIds: string[];
  userBenchmarks: any[];
}

export function XirrReport({ 
  folios, 
  activeOnlyXirr, 
  selectedBenchmarkIds, 
  userBenchmarks 
}: XirrReportProps) {
  const filteredFolios = activeOnlyXirr ? folios.filter(f => f.currentUnits > 0) : folios;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-200 flex items-center justify-between">
        <h3 className="text-lg font-bold">Fund-wise Performance</h3>
        <div className="flex gap-2">
          <button className="p-2 hover:bg-slate-100 rounded-lg"><Filter className="w-5 h-5 text-slate-500" /></button>
          <button className="p-2 hover:bg-slate-100 rounded-lg"><Search className="w-5 h-5 text-slate-500" /></button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Fund Name</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Invested</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Current Value</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Gain</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Your XIRR</th>
              {selectedBenchmarkIds.map(id => (
                <th key={id} className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">
                  {userBenchmarks.find(b => b.id === id)?.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredFolios.length === 0 ? (
              <tr>
                <td colSpan={5 + selectedBenchmarkIds.length} className="px-6 py-12 text-center text-slate-500">
                  No folios found.
                </td>
              </tr>
            ) : (
              filteredFolios.map((folio) => (
                <tr key={folio.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-sm">{folio.fund_name}</p>
                    <p className="text-xs text-slate-500">Folio: {folio.folio_number}</p>
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-medium">
                    {formatCurrency(folio.investedAmount)}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-bold text-[#01696f]">
                    {formatCurrency(folio.currentValue)}
                  </td>
                  <td className={cn(
                    "px-6 py-4 text-right tabular-nums text-sm font-semibold",
                    folio.currentValue - folio.investedAmount >= 0 ? "text-emerald-600" : "text-rose-600"
                  )}>
                    {formatCurrency(folio.currentValue - folio.investedAmount)}
                  </td>
                  <td className={cn(
                    "px-6 py-4 text-right tabular-nums text-sm font-bold",
                    folio.xirr && folio.xirr >= 0 ? "text-emerald-600" : "text-rose-600"
                  )}>
                    {formatPercent(folio.xirr)}
                  </td>
                  <BenchmarkXirrCell folioId={folio.id} benchmarkIds={selectedBenchmarkIds} actualXirr={folio.xirr} />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
