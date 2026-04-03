import React, { useState } from 'react';
import { Upload, RefreshCw, Plus, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { importCas } from '../lib/api';

interface CasImporterProps {
  onImportSuccess: () => void;
}

export function CasImporter({ onImportSuccess }: CasImporterProps) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; skipped: number; errors: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const csvData = event.target?.result as string;
      try {
        const result = await importCas(csvData);
        setImportResult(result);
        onImportSuccess();
      } catch (err) {
        console.error('Import failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to process statement');
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-2xl mx-auto text-center py-12">
      <div className="w-20 h-20 bg-[#01696f]/10 rounded-3xl flex items-center justify-center mx-auto mb-8">
        <Upload className="w-10 h-10 text-[#01696f]" />
      </div>
      <h3 className="text-2xl font-bold mb-4">Import CAS Data</h3>
      <p className="text-slate-500 mb-8 max-w-md mx-auto">
        Upload your Consolidated Account Statement (CAS) in CSV format. 
        We support the format exported by the cams2csv tool.
      </p>
      
      <div className="relative group">
        <input
          type="file"
          accept=".csv"
          onChange={handleImport}
          disabled={importing}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        <div className={cn(
          "border-2 border-dashed border-slate-200 rounded-2xl p-8 transition-all group-hover:border-[#01696f] group-hover:bg-[#01696f]/5",
          importing && "opacity-50 cursor-not-allowed"
        )}>
          {importing ? (
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 text-[#01696f] animate-spin" />
              <span className="font-bold text-[#01696f]">Processing Statement...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Plus className="w-8 h-8 text-slate-400 group-hover:text-[#01696f]" />
              <span className="font-bold text-slate-600 group-hover:text-[#01696f]">Click or drag CSV file here</span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-6 p-4 bg-rose-50 rounded-2xl border border-rose-100 flex items-center gap-3 text-rose-700 text-sm font-medium">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {importResult && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-8 p-6 bg-emerald-50 rounded-2xl border border-emerald-100 flex items-center justify-center gap-8"
        >
          <div className="text-center">
            <p className="text-xs font-bold text-emerald-600 uppercase mb-1">Added</p>
            <p className="text-2xl font-bold text-emerald-700">{importResult.added}</p>
          </div>
          <div className="w-px h-8 bg-emerald-200" />
          <div className="text-center">
            <p className="text-xs font-bold text-slate-500 uppercase mb-1">Skipped</p>
            <p className="text-2xl font-bold text-slate-600">{importResult.skipped}</p>
          </div>
        </motion.div>
      )}

      <div className="mt-12 flex items-start gap-4 p-6 bg-amber-50 rounded-2xl text-left">
        <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
        <div>
          <h4 className="font-bold text-amber-900 text-sm mb-1">Privacy Notice</h4>
          <p className="text-amber-800 text-xs leading-relaxed">
            Your data is stored locally in this application's database. 
            No financial data is sent to external servers except for fetching 
            public NAV and benchmark prices.
          </p>
        </div>
      </div>
    </div>
  );
}
