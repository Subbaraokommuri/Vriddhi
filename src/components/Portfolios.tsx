import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  Plus, 
  ChevronRight,
  AlertCircle
} from 'lucide-react';
import { formatCurrency, formatPercent } from '../lib/utils';
import { Portfolio } from '../lib/types';
import { fetchPortfolios } from '../lib/api';

export function Portfolios() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPortfolios();
        setPortfolios(data);
      } catch (err) {
        console.error('Portfolios fetch failed:', err);
        setError('Failed to load portfolios. Please try again later.');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-8 h-8 border-4 border-[#01696f] border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 font-medium">Loading Portfolios...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 bg-rose-50 text-rose-700 rounded-2xl border border-rose-100 flex items-center gap-3">
        <AlertCircle className="w-6 h-6" />
        <p className="font-bold">{error}</p>
      </div>
    );
  }

  return (
    <motion.div
      key="portfolios"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold">Your Portfolios</h3>
        <button className="flex items-center gap-2 px-4 py-2 bg-[#01696f] text-white rounded-xl text-sm font-bold hover:bg-[#015a5f] transition-colors">
          <Plus className="w-4 h-4" />
          New Portfolio
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {portfolios.length === 0 ? (
          <div className="col-span-full bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center text-slate-500">
            No portfolios found. Create one to get started.
          </div>
        ) : (
          portfolios.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 flex items-start justify-between" style={{ borderTop: `4px solid ${p.color}` }}>
                <div>
                  <h4 className="text-lg font-bold">{p.name}</h4>
                  <p className="text-sm text-slate-500">{p.description}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-slate-400 uppercase">XIRR</p>
                  <p className="text-xl font-bold text-emerald-600">{formatPercent(p.xirr)}</p>
                </div>
              </div>
              <div className="px-6 py-4 bg-slate-50 border-y border-slate-100 flex justify-between">
                <div>
                  <p className="text-xs text-slate-500 font-bold uppercase">Current Value</p>
                  <p className="text-lg font-bold tabular-nums">{formatCurrency(p.currentValue)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500 font-bold uppercase">Invested</p>
                  <p className="text-lg font-bold tabular-nums">{formatCurrency(p.investedAmount)}</p>
                </div>
              </div>
              <div className="p-4">
                <p className="text-xs font-bold text-slate-400 uppercase px-2 mb-2">Folios ({p.folios.length})</p>
                <div className="space-y-1">
                  {p.folios.map(f => (
                    <div key={f.id} className="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg group cursor-pointer">
                      <span className="text-sm font-medium text-slate-700 truncate">{f.fund_name}</span>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}
