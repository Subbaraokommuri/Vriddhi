import React from 'react';
import { Search, Filter } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';
import { Folio } from '../lib/types';

interface FundsListProps {
  folios: Folio[];
  activeOnly: boolean;
}

export function FundsList({ folios, activeOnly }: FundsListProps) {
  const filteredFolios = activeOnly ? folios.filter(f => f.currentUnits > 0) : folios;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-200 flex items-center justify-between">
        <h3 className="text-lg font-bold">Funds & Folios</h3>
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
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Units</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">NAV</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Current Value</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Category</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredFolios.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                  No funds found.
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
                    {folio.currentUnits.toFixed(3)}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-medium">
                    ₹{folio.nav.toFixed(4)}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums text-sm font-bold text-[#01696f]">
                    {formatCurrency(folio.currentValue)}
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-slate-100 rounded text-[10px] font-bold uppercase text-slate-600">
                      {folio.category || 'Mutual Fund'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
