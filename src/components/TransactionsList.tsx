import React from 'react';
import { Filter } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';
import { Transaction } from '../lib/types';

interface TransactionsListProps {
  transactions: Transaction[];
}

export function TransactionsList({ transactions }: TransactionsListProps) {
  if (!transactions || transactions.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center text-slate-500">
        No transactions found.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-200 flex items-center justify-between">
        <h3 className="text-lg font-bold">Transaction History</h3>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-bold transition-colors">
            <Filter className="w-4 h-4" />
            Filter
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Date</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Fund / Folio</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Type</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Amount</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Units</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">NAV</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {transactions.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-slate-600">
                  {new Date(t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </td>
                <td className="px-6 py-4">
                  <p className="font-semibold text-sm">{t.fund_name}</p>
                  <p className="text-xs text-slate-500">Folio: {t.folio_number}</p>
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                    t.transaction_type === 'buy' ? "bg-emerald-100 text-emerald-700" : 
                    t.transaction_type === 'sell' ? "bg-rose-100 text-rose-700" : "bg-blue-100 text-blue-700"
                  )}>
                    {t.transaction_type}
                  </span>
                </td>
                <td className="px-6 py-4 text-right tabular-nums text-sm font-bold">
                  {formatCurrency(t.amount)}
                </td>
                <td className="px-6 py-4 text-right tabular-nums text-sm font-medium text-slate-600">
                  {t.units.toFixed(3)}
                </td>
                <td className="px-6 py-4 text-right tabular-nums text-sm font-medium text-slate-600">
                  ₹{t.nav.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
