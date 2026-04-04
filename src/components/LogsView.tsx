import React, { useState, useEffect } from 'react';
import { Calendar, Download, RefreshCw, FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import { fetchLogs } from '../lib/api';

export function LogsView() {
  const [type, setType] = useState<'app' | 'import' | 'benchmark' | 'nav'>('app');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logTypes = [
    { id: 'app', label: 'App' },
    { id: 'import', label: 'Import' },
    { id: 'benchmark', label: 'Benchmark' },
    { id: 'nav', label: 'NAV Updates' }
  ] as const;

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const text = await fetchLogs(type, date);
      setContent(text);
    } catch (e) {
      console.error('Failed to fetch logs:', e);
      setContent(`No logs found for ${type} on ${date}`);
      setError(e instanceof Error ? e.message : 'Log file not found');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
    const interval = setInterval(loadLogs, 5000);
    return () => clearInterval(interval);
  }, [type, date]);

  const downloadLogs = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}-${date}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex bg-slate-100 p-1 rounded-xl">
          {logTypes.map((t) => (
            <button
              key={t.id}
              onClick={() => setType(t.id as any)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap",
                type === t.id ? "bg-white text-[#01696f] shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#01696f]/20"
            />
          </div>
          <button
            onClick={downloadLogs}
            className="flex items-center gap-2 px-4 py-2 bg-[#01696f] text-white rounded-xl text-sm font-bold hover:bg-[#015a5f] transition-colors"
          >
            <Download className="w-4 h-4" />
            Download
          </button>
        </div>
      </div>

      <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-rose-500" />
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="ml-2 text-xs font-mono text-slate-500 uppercase tracking-widest">{type}-{date}.log</span>
          </div>
          {loading && <RefreshCw className="w-4 h-4 text-slate-500 animate-spin" />}
        </div>
        <textarea
          readOnly
          value={content}
          className="w-full h-[600px] bg-transparent text-slate-300 font-mono text-sm resize-none focus:outline-none"
        />
      </div>
    </div>
  );
}
