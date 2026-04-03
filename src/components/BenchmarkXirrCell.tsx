import React, { useState, useEffect } from 'react';
import { cn, formatPercent } from '../lib/utils';
import { fetchBenchmarkXirr } from '../lib/api';
import { AlertCircle } from 'lucide-react';

interface BenchmarkXirrCellProps {
  folioId?: string;
  portfolioId?: string;
  benchmarkIds: string[];
  actualXirr: number | null;
}

export function BenchmarkXirrCell({ folioId, portfolioId, benchmarkIds, actualXirr }: BenchmarkXirrCellProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (benchmarkIds.length === 0) {
      setData(null);
      setError(null);
      return;
    }

    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchBenchmarkXirr({ folioId, portfolioId, benchmarkIds });
        setData(result);
      } catch (e) {
        console.error('Failed to fetch benchmark XIRR:', e);
        setError(e instanceof Error ? e.message : 'Failed to load benchmark data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [folioId, portfolioId, benchmarkIds]);

  if (benchmarkIds.length === 0) return null;

  if (loading) {
    return (
      <td colSpan={benchmarkIds.length} className="px-6 py-4 text-right text-xs text-slate-400 animate-pulse">
        Calculating...
      </td>
    );
  }

  if (error) {
    return (
      <td colSpan={benchmarkIds.length} className="px-6 py-4 text-right text-xs text-rose-500">
        <div className="flex items-center justify-end gap-1">
          <AlertCircle className="w-3 h-3" />
          <span>Error</span>
        </div>
      </td>
    );
  }

  if (!data || !data.benchmarks) return null;

  return (
    <>
      {data.benchmarks.map((b: any, i: number) => (
        <td key={i} className="px-6 py-4 text-right tabular-nums text-sm">
          <p className="font-bold text-slate-700">{b.xirr !== null ? formatPercent(b.xirr) : 'N/A'}</p>
          {b.diff !== null && (
            <p className={cn("text-[10px] font-bold", b.diff >= 0 ? "text-emerald-600" : "text-rose-600")}>
              {b.diff >= 0 ? '+' : ''}{formatPercent(b.diff)} Alpha
            </p>
          )}
        </td>
      ))}
    </>
  );
}
