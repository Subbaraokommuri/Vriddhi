import React, { useState, useRef } from 'react';
import { 
  Upload, 
  Eye, 
  EyeOff, 
  CheckCircle, 
  AlertTriangle, 
  ArrowLeft, 
  Loader2,
  FileText,
  Database,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { refreshAmfiCodes, backfillNavHistory } from '../lib/api';

type State = 'IDLE' | 'LOADING' | 'PREVIEW' | 'ERROR' | 'SUCCESS';

interface CasImportProps {
  onImportSuccess?: () => void;
}

export function CasImport({ onImportSuccess }: CasImportProps) {
  const [state, setState] = useState<State>('IDLE');
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{ html: string; stats: any; ok: boolean } | null>(null);
  const [importResult, setImportResult] = useState<{
    message: string;
    new_transactions: number;
    skipped_transactions: number;
    schemes_updated: number;
    import_id: string;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [refreshingCodes, setRefreshingCodes] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [maintenanceSuccess, setMaintenanceSuccess] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setError(null);
    } else if (selectedFile) {
      setError('Please select a valid PDF file.');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.type === 'application/pdf') {
      setFile(droppedFile);
      setError(null);
    } else if (droppedFile) {
      setError('Please drop a valid PDF file.');
    }
  };

  const handleParse = async () => {
    if (!file) return;

    setState('LOADING');
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('password', password);

    try {
      const response = await fetch('/api/cas/preview', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to parse CAS PDF');
      }

      setPreviewData(data);
      setState('PREVIEW');
    } catch (err: any) {
      setError(err.message);
      setState('ERROR');
    }
  };

  const reset = () => {
    setState('IDLE');
    setPreviewData(null);
    setError(null);
  };

  const handleConfirmImport = async () => {
    if (!file) return;

    setState('LOADING');
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('password', password);

    try {
      const response = await fetch('/api/cas/confirm', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Import failed');
      }

      setImportResult(result);
      setState('SUCCESS');
      if (onImportSuccess) onImportSuccess();
    } catch (err: any) {
      setError(err.message);
      setState('ERROR');
    }
  };

  const handleRefreshCodes = async () => {
    setMaintenanceError(null);
    setMaintenanceSuccess(null);
    setRefreshingCodes(true);
    try {
      const result = await refreshAmfiCodes();
      setMaintenanceSuccess(`AMFI Refresh Complete: ${result.updated} updated, ${result.notFound} not found, ${result.failedCount} failed.`);
      if (onImportSuccess) onImportSuccess();
    } catch (error: any) {
      console.error('Failed to refresh AMFI codes:', error);
      setMaintenanceError(error.message || String(error));
    } finally {
      setRefreshingCodes(false);
    }
  };

  const handleBackfill = async () => {
    setMaintenanceError(null);
    setMaintenanceSuccess(null);
    setBackfilling(true);
    try {
      const result = await backfillNavHistory();
      setMaintenanceSuccess(`Backfill complete: ${result.full_backfill} new, ${result.incremental} updated, ${result.up_to_date} current.`);
      if (onImportSuccess) onImportSuccess();
    } catch (error: any) {
      console.error('Failed to backfill NAV history:', error);
      setMaintenanceError(error.message || String(error));
    } finally {
      setBackfilling(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="max-w-4xl mx-auto">
      <AnimatePresence mode="wait">
        {state === 'IDLE' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-3xl p-12 text-center cursor-pointer transition-all",
                isDragging ? "border-[#01696f] bg-[#01696f]/5" : "border-slate-200 hover:border-[#01696f] hover:bg-[#01696f]/5",
                file ? "bg-slate-50" : ""
              )}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".pdf"
                className="hidden"
              />
              <div className="w-16 h-16 bg-[#01696f]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Upload className="w-8 h-8 text-[#01696f]" />
              </div>
              {file ? (
                <div>
                  <p className="text-lg font-bold text-slate-900">{file.name}</p>
                  <p className="text-sm text-slate-500">{formatSize(file.size)}</p>
                </div>
              ) : (
                <div>
                  <p className="text-lg font-bold text-slate-900">Drop your CAS PDF here or click to browse</p>
                  <p className="text-sm text-slate-500 mt-1">Accepts Consolidated Account Statement PDFs only</p>
                </div>
              )}
            </div>

            <div className="max-w-md mx-auto space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase ml-1">
                  CAS Password (leave blank if none)
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter PDF password"
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-[#01696f]/20 focus:border-[#01696f] transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <button
                onClick={handleParse}
                disabled={!file}
                className={cn(
                  "w-full py-4 rounded-xl font-bold text-white transition-all shadow-lg shadow-[#01696f]/20",
                  file ? "bg-[#01696f] hover:bg-[#014f53]" : "bg-slate-300 cursor-not-allowed shadow-none"
                )}
              >
                Parse & Preview
              </button>
            </div>

            {error && (
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-700 text-sm font-medium">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </motion.div>
        )}

        {state === 'LOADING' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-24 space-y-4"
          >
            <Loader2 className="w-12 h-12 text-[#01696f] animate-spin" />
            <div className="text-center">
              <p className="text-xl font-bold text-slate-900">Parsing 3,000+ transactions...</p>
              <p className="text-slate-500">This usually takes less than 5 seconds</p>
            </div>
          </motion.div>
        )}

        {state === 'PREVIEW' && previewData && (
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            <div className={cn(
              "p-4 rounded-2xl border flex items-center gap-3 font-bold",
              previewData.ok 
                ? "bg-emerald-50 border-emerald-100 text-emerald-700" 
                : "bg-amber-50 border-amber-100 text-amber-700"
            )}>
              {previewData.ok ? (
                <>
                  <CheckCircle className="w-6 h-6" />
                  <span>All 8 checks pass — safe to import</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-6 h-6" />
                  <span>Some checks failed — review before importing</span>
                </>
              )}
            </div>

            <div className="grid grid-cols-5 gap-4">
              {[
                { label: 'Schemes', value: previewData.stats.total_schemes },
                { label: 'Transactions', value: previewData.stats.total_transactions },
                { label: 'Active', value: previewData.stats.active_schemes },
                { label: 'Direct', value: previewData.stats.direct_schemes },
                { label: 'Regular', value: previewData.stats.regular_schemes },
              ].map((stat, i) => (
                <div key={i} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                  <p className="text-2xl font-bold text-[#01696f]">{stat.value}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{stat.label}</p>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-xl">
              <iframe
                srcDoc={previewData.html}
                className="w-full h-[600px] border-none"
                title="CAS Reconciliation Report"
              />
            </div>

            <div className="flex gap-4">
              <button
                onClick={reset}
                className="flex-1 py-4 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-5 h-5" />
                Upload Different File
              </button>
              <div className="flex-1 relative group">
                <button
                  onClick={handleConfirmImport}
                  disabled={!previewData.ok}
                  className={cn(
                    "w-full py-4 rounded-xl font-bold text-white transition-all shadow-lg",
                    previewData.ok 
                      ? "bg-[#01696f] hover:bg-[#014f53] shadow-[#01696f]/20" 
                      : "bg-slate-300 cursor-not-allowed shadow-none"
                  )}
                >
                  Confirm & Import →
                </button>
                {!previewData.ok && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    Fix reconciliation issues before importing
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {state === 'ERROR' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="max-w-md mx-auto text-center space-y-6 py-12"
          >
            <div className="w-20 h-20 bg-rose-50 rounded-3xl flex items-center justify-center mx-auto">
              <AlertTriangle className="w-10 h-10 text-rose-600" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-slate-900">Import Failed</h3>
              <p className="text-slate-500">
                {error?.toLowerCase().includes("password") 
                  ? "Incorrect PDF password. Please try again."
                  : error?.toLowerCase().includes("pdftotext")
                  ? "pdftotext not installed. Run: brew install poppler"
                  : error}
              </p>
            </div>
            <button
              onClick={() => setState('IDLE')}
              className="w-full py-4 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-5 h-5" />
              Try Again
            </button>
          </motion.div>
        )}

        {state === 'SUCCESS' && importResult && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="max-w-md mx-auto text-center space-y-8 py-12"
          >
            <div className="w-24 h-24 bg-emerald-50 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle className="w-12 h-12 text-[#01696f]" />
            </div>
            
            <div className="space-y-2">
              <h3 className="text-3xl font-bold text-slate-900">Import Complete</h3>
              <p className="text-slate-500">Your portfolio has been updated</p>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500 font-medium">New Transactions</span>
                <span className="text-lg font-bold text-emerald-600">+{importResult.new_transactions}</span>
              </div>
              <div className="w-full h-px bg-slate-50" />
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500 font-medium">Skipped (Duplicates)</span>
                <span className="text-lg font-bold text-slate-400">{importResult.skipped_transactions}</span>
              </div>
            </div>

            <button
              onClick={reset}
              className="w-full py-4 rounded-2xl font-bold text-white bg-[#01696f] hover:bg-[#014f53] transition-all shadow-lg shadow-[#01696f]/20"
            >
              Import Another File
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6 border border-slate-200 rounded-2xl p-5 space-y-3">
        <div className="space-y-1">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Data Maintenance</p>
          <p className="text-xs text-slate-400">Run these after importing a new CAS file</p>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={handleBackfill}
            disabled={backfilling}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
          >
            <Database className={cn("w-4 h-4", backfilling && "animate-pulse")} />
            Backfill NAV History
          </button>
          <button 
            onClick={handleRefreshCodes}
            disabled={refreshingCodes}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", refreshingCodes && "animate-pulse")} />
            Refresh AMFI Codes
          </button>
        </div>

        {backfilling && (
          <p className="text-xs text-slate-400 italic animate-pulse">
            Fetching history — this may take 2-3 minutes
          </p>
        )}

        {maintenanceSuccess && (
          <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs font-medium text-emerald-700">
            {maintenanceSuccess}
          </div>
        )}

        {maintenanceError && (
          <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-xs font-medium text-rose-700">
            {maintenanceError}
          </div>
        )}
      </div>
    </div>
  );
}
