import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Receipt, 
  Download, 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp,
  Loader2,
  Calendar,
  Wallet,
  TrendingUp,
  ArrowRight,
  Info,
  FileSpreadsheet,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, formatDate } from '../lib/utils.ts';
import { 
  getTaxPans, 
  getCapitalGains, 
  downloadCapitalGainsCsv, 
  downloadAuditCsv,
  downloadCapitalGainsExcel,
  downloadItrSummary,
  getUnrealizedGains,
  getHarvestingReport,
  simulateRedemption,
  fetchFolios,
  getAdvanceTaxEstimate,
  downloadAdvanceTaxExcel
} from '../lib/api.ts';
import { 
  PanCapitalGainsSummary, 
  UnrealizedGainsSummary, 
  TaxPan,
  FolioCapitalGains,
  MatchedLot,
  HarvestingReport,
  SimulationResult,
  Folio,
  AdvanceTaxEstimate,
  AdvanceTaxInstallment
} from '../lib/types.ts';

type TaxTab = 'capital-gains' | 'unrealized' | 'harvesting' | 'simulator' | 'advance';

function isCurrentOrPreviousFy(
  fyType: 'current' | 'previous' | 'historical'
): boolean {
  return fyType === 'current' || fyType === 'previous';
}

function calc234CInterest(
  shortfall: number,
  installmentNumber: number
): number {
  if (shortfall <= 0) return 0;
  const months = installmentNumber <= 3 ? 3 : 1;
  return Math.round(shortfall * 0.01 * months * 100) / 100;
}

function calc234BInterest(
  fullYearTax: number,
  totalPaid: number,
  selfAssessmentDate: string,
  fyEndYear: number
): { applicable: boolean; shortfall: number; interest: number } {
  const assessed = fullYearTax;
  const ninetyPct = assessed * 0.9;
  if (totalPaid >= ninetyPct) return { applicable: false, shortfall: 0, interest: 0 };
  const shortfall = assessed - totalPaid;
  const april1 = new Date(`${fyEndYear}-04-01`);
  const saDate = new Date(selfAssessmentDate);
  const diffMs = saDate.getTime() - april1.getTime();
  const months = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 30)));
  return {
    applicable: true,
    shortfall,
    interest: Math.round(shortfall * 0.01 * months * 100) / 100
  };
}

export function TaxReport() {
  const [activeTab, setActiveTab] = useState<TaxTab>('capital-gains');
  const [pans, setPans] = useState<TaxPan[]>([]);
  const [selectedPan, setSelectedPan] = useState<string>('');
  const [selectedFy, setSelectedFy] = useState<string>('');
  const [pansLoading, setPansLoading] = useState(true);
  const [pansError, setPansError] = useState<string | null>(null);

  const [fyDropdownOpen, setFyDropdownOpen] = useState(false);
  const fyDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fyDropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (fyDropdownRef.current && !fyDropdownRef.current.contains(e.target as Node)) {
        setFyDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [fyDropdownOpen]);

  // Advance Tax State
  const currentInProgressFy = useMemo(() => {
    const today = new Date();
    const year  = today.getFullYear();
    const month = today.getMonth() + 1; // 1-indexed
    if (month >= 4) {
      return `${year}-${String(year + 1).slice(-2)}`;
    }
    return `${year - 1}-${String(year).slice(-2)}`;
  }, []);

  const [advanceTaxFy, setAdvanceTaxFy] = useState<string>(currentInProgressFy);

  const advanceTaxFyOptions = useMemo(() => {
    const [startYearStr] = currentInProgressFy.split('-');
    const startYear = parseInt(startYearStr);
    const options = [
      { value: currentInProgressFy, label: `${currentInProgressFy} (In Progress)` }
    ];
    for (let i = 1; i <= startYear - 2010; i++) {
      const yr = startYear - i;
      const endShort = (yr + 1).toString().slice(-2);
      options.push({ value: `${yr}-${endShort}`, label: `FY ${yr}-${endShort}` });
    }
    return options;
  }, [currentInProgressFy]);

  const [advanceTaxResult, setAdvanceTaxResult] = useState<AdvanceTaxEstimate | null>(null);
  const [advanceTaxLoading, setAdvanceTaxLoading] = useState(false);
  const [advanceTaxError, setAdvanceTaxError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [cgExcelLoading, setCgExcelLoading] = useState(false);
  const [cgExcelError, setCgExcelError]     = useState<string | null>(null);
  const [itrLoading,    setItrLoading]       = useState(false);
  const [itrError,      setItrError]         = useState<string | null>(null);

  // New Advance Tax state variables
  const [paidAmounts, setPaidAmounts] = useState<Record<number, string>>({});
  const [selfAssessmentDate, setSelfAssessmentDate] = useState<string>('');
  const [showHistoricalInterest, setShowHistoricalInterest] = useState<boolean>(false);
  const [historicalPaidAmounts, setHistoricalPaidAmounts] = useState<Record<number, string>>({});
  const [historicalSelfAssessmentDate, setHistoricalSelfAssessmentDate] = useState<string>('');
  const [historicalInterestCalculated, setHistoricalInterestCalculated] = useState<boolean>(false);
  const [redemptionBreakdownOpen, setRedemptionBreakdownOpen] = useState<boolean>(false);

  // CG State
  const [cgData, setCgData] = useState<PanCapitalGainsSummary | null>(null);
  const [cgLoading, setCgLoading] = useState(false);
  const [cgError, setCgError] = useState<string | null>(null);

  // Unrealized State
  const [unrealizedData, setUnrealizedData] = useState<UnrealizedGainsSummary | null>(null);
  const [unrealizedLoading, setUnrealizedLoading] = useState(false);
  const [unrealizedError, setUnrealizedError] = useState<string | null>(null);

  // Expanded folios for CG
  const [expandedFolios, setExpandedFolios] = useState<Record<string, boolean>>({});

  const mergerWarnings = useMemo(() => {
    if (!cgData || !cgData.folios) return [];
    return cgData.folios.flatMap(f => f.warnings || []).filter(w => w.toLowerCase().includes('merger'));
  }, [cgData]);

  // Harvesting State
  const [harvestingData, setHarvestingData] = useState<HarvestingReport | null>(null);
  const [harvestingLoading, setHarvestingLoading] = useState(false);
  const [harvestingError, setHarvestingError] = useState<string | null>(null);

  // Simulator State
  const [folios, setFolios] = useState<Folio[]>([]);
  const [foliosLoading, setFoliosLoading] = useState(false);
  const [selectedFolioId, setSelectedFolioId] = useState('');
  const [simUnits, setSimUnits] = useState('');
  const [simAmount, setSimAmount] = useState('');
  const [simInputMode, setSimInputMode] = useState<'units' | 'amount'>('units');
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const [panList, folioList] = await Promise.all([
          getTaxPans(),
          fetchFolios()
        ]);
        
        setPans(panList);
        setFolios(folioList);
        
        if (panList.length > 0) {
          setSelectedPan(panList[0].pan);
        }

        // Derive default FY
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth(); // 0 is January, 3 is April
        
        let completedFY = '';
        if (month >= 3) { // April or later
          completedFY = `${year - 1}-${year.toString().slice(-2)}`;
        } else {
          completedFY = `${year - 2}-${(year - 1).toString().slice(-2)}`;
        }
        setSelectedFy(completedFY);
      } catch (err: any) {
        setPansError(err.message);
      } finally {
        setPansLoading(false);
      }
    }
    init();
  }, []);

  const handlePanChange = (pan: string) => {
    setSelectedPan(pan);
    setCgData(null);
    setUnrealizedData(null);
    setHarvestingData(null);
    setSimResult(null);
    setSelectedFolioId('');
    setCgError(null);
    setUnrealizedError(null);
    setHarvestingError(null);
    setAdvanceTaxResult(null);
    setAdvanceTaxError(null);
    setExportError(null);
    setCgExcelLoading(false);
    setCgExcelError(null);
    setItrLoading(false);
    setItrError(null);
    
    // Reset all advance tax state
    setPaidAmounts({});
    setSelfAssessmentDate('');
    setShowHistoricalInterest(false);
    setHistoricalPaidAmounts({});
    setHistoricalSelfAssessmentDate('');
    setHistoricalInterestCalculated(false);
    setRedemptionBreakdownOpen(false);
  };

  const handleFyChange = (fy: string) => {
    setSelectedFy(fy);
    setCgData(null);
    setCgError(null);
    setCgExcelLoading(false);
    setCgExcelError(null);
    setItrLoading(false);
    setItrError(null);
  };

  const handleAdvanceTaxFyChange = (fy: string) => {
    setAdvanceTaxFy(fy);
    setAdvanceTaxResult(null);
    setAdvanceTaxError(null);
    setExportError(null);
    setPaidAmounts({});
    setSelfAssessmentDate('');
    setShowHistoricalInterest(false);
    setHistoricalPaidAmounts({});
    setHistoricalSelfAssessmentDate('');
    setHistoricalInterestCalculated(false);
    setRedemptionBreakdownOpen(false);
  };

  const calculateAdvanceTax = async () => {
    if (!selectedPan) return;
    setAdvanceTaxLoading(true);
    setAdvanceTaxError(null);
    try {
      const data = await getAdvanceTaxEstimate(selectedPan, advanceTaxFy);
      setAdvanceTaxResult(data);
    } catch (err: any) {
      setAdvanceTaxError(err.message);
    } finally {
      setAdvanceTaxLoading(false);
    }
  };

  const handleAdvanceTaxExport = async () => {
    if (!advanceTaxResult || !selectedPan) return;
    setExportLoading(true);
    setExportError(null);
    try {
      const fyType = advanceTaxResult.fyType;
      const isInterest = isCurrentOrPreviousFy(fyType)
        || historicalInterestCalculated;

      const opts: Parameters<typeof downloadAdvanceTaxExcel>[2] = {
        showInterest: isInterest
      };

      if (isCurrentOrPreviousFy(fyType)) {
        // Use main paid amounts
        opts.paid1 = parseFloat(paidAmounts[1] || '0') || 0;
        opts.paid2 = parseFloat(paidAmounts[2] || '0') || 0;
        opts.paid3 = parseFloat(paidAmounts[3] || '0') || 0;
        opts.paid4 = parseFloat(paidAmounts[4] || '0') || 0;
        opts.saDate = selfAssessmentDate ||
          (advanceTaxResult
            ? `${parseInt(advanceTaxResult.currentFy.split('-')[0]) + 1}-07-31`
            : undefined);
      } else if (historicalInterestCalculated) {
        // Use historical paid amounts
        opts.histPaid1 = parseFloat(historicalPaidAmounts[1] || '0') || 0;
        opts.histPaid2 = parseFloat(historicalPaidAmounts[2] || '0') || 0;
        opts.histPaid3 = parseFloat(historicalPaidAmounts[3] || '0') || 0;
        opts.histPaid4 = parseFloat(historicalPaidAmounts[4] || '0') || 0;
        opts.histSaDate = historicalSelfAssessmentDate ||
          (advanceTaxResult
            ? `${parseInt(advanceTaxResult.currentFy.split('-')[0]) + 1}-07-31`
            : undefined);
      }

      await downloadAdvanceTaxExcel(selectedPan, advanceTaxFy, opts);
    } catch (err: any) {
      setExportError(err.message);
    } finally {
      setExportLoading(false);
    }
  };

  const calculateCg = async () => {
    if (!selectedPan || !selectedFy) return;
    setCgLoading(true);
    setCgError(null);
    try {
      const data = await getCapitalGains(selectedPan, selectedFy);
      setCgData(data);
    } catch (err: any) {
      setCgError(err.message);
    } finally {
      setCgLoading(false);
    }
  };

  async function handleDownloadCgExcel() {
    setCgExcelLoading(true); setCgExcelError(null);
    try { await downloadCapitalGainsExcel(selectedPan, selectedFy); }
    catch (e: any) { setCgExcelError(e.message || 'Export failed'); }
    finally { setCgExcelLoading(false); }
  }

  async function handleDownloadItrSummary() {
    setItrLoading(true); setItrError(null);
    try { await downloadItrSummary(selectedPan, selectedFy); }
    catch (e: any) { setItrError(e.message || 'Export failed'); }
    finally { setItrLoading(false); }
  }

  const calculateUnrealized = async () => {
    if (!selectedPan) return;
    setUnrealizedLoading(true);
    setUnrealizedError(null);
    try {
      const data = await getUnrealizedGains(selectedPan);
      setUnrealizedData(data);
    } catch (err: any) {
      setUnrealizedError(err.message);
    } finally {
      setUnrealizedLoading(false);
    }
  };

  const calculateHarvesting = async () => {
    if (!selectedPan || !selectedFy) return;
    setHarvestingLoading(true);
    setHarvestingError(null);
    try {
      const data = await getHarvestingReport(selectedPan, selectedFy);
      setHarvestingData(data);
    } catch (err: any) {
      setHarvestingError(err.message);
    } finally {
      setHarvestingLoading(false);
    }
  };

  const runSimulation = async () => {
    if (!selectedFolioId) return;
    if (simInputMode === 'units' && !simUnits) return;
    if (simInputMode === 'amount' && !simAmount) return;
    
    setSimLoading(true);
    setSimError(null);
    try {
      const result = await simulateRedemption(
        selectedFolioId,
        simInputMode === 'units' ? parseFloat(simUnits) : undefined,
        simInputMode === 'amount' ? parseFloat(simAmount) : undefined
      );
      setSimResult(result);
    } catch (err: any) {
      setSimError(err.message);
    } finally {
      setSimLoading(false);
    }
  };

  const toggleFolio = (folioId: string) => {
    setExpandedFolios(prev => ({ ...prev, [folioId]: !prev[folioId] }));
  };

  // Generate FY Options
  const fyOptions: string[] = [];
  {
    const [startYearStr] = currentInProgressFy.split('-');
    const maxStartYear = parseInt(startYearStr);
    for (let yr = maxStartYear; yr >= 2010; yr--) {
      const endShort = (yr + 1).toString().slice(-2);
      fyOptions.push(`${yr}-${endShort}`);
    }
  }

  const fyEndYear = useMemo(() => {
    if (!advanceTaxResult) return null;
    return parseInt(advanceTaxResult.currentFy.split('-')[0]) + 1;
  }, [advanceTaxResult]);

  const installmentPaidAmounts = useMemo(() => {
    return advanceTaxResult?.installments.map(
      (inst) => parseFloat(paidAmounts[inst.installmentNumber] || '0') || 0
    ) ?? [];
  }, [advanceTaxResult, paidAmounts]);

  // cumulative paid up to each installment:
  const cumulativePaid = useMemo(() => {
    return installmentPaidAmounts.reduce<number[]>(
      (acc, val, i) => { acc.push((acc[i - 1] ?? 0) + val); return acc; }, []
    );
  }, [installmentPaidAmounts]);

  const shortfalls = useMemo(() => {
    return advanceTaxResult?.installments.map((inst, i) =>
      Math.max(0, inst.cumulativeObligation - (cumulativePaid[i] ?? 0))
    ) ?? [];
  }, [advanceTaxResult, cumulativePaid]);

  const total234CInterest = useMemo(() => {
    return shortfalls.reduce(
      (sum, s, i) => sum + calc234CInterest(s, i + 1), 0
    );
  }, [shortfalls]);

  const totalPaid = useMemo(() => {
    return installmentPaidAmounts.reduce((a, b) => a + b, 0);
  }, [installmentPaidAmounts]);

  const defaultSADate = useMemo(() => {
    if (!advanceTaxFy) return '';
    const startYr = parseInt(advanceTaxFy.split('-')[0]);
    if (isNaN(startYr)) return '';
    return `${startYr + 1}-07-31`;
  }, [advanceTaxFy]);

  const currentQuarterInfo = useMemo(() => {
    if (!advanceTaxResult || advanceTaxResult.fyType !== 'current') return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const installments = advanceTaxResult.installments;
    let currentInst = installments.find(inst => {
      const dueDate = new Date(inst.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      return today <= dueDate;
    });

    if (!currentInst) {
      currentInst = installments[installments.length - 1];
    }

    const n = currentInst.installmentNumber;
    const dueDate = new Date(currentInst.dueDate);
    dueDate.setHours(0, 0, 0, 0);
    const diffTime = dueDate.getTime() - today.getTime();
    const daysUntilDueDate = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let dueMessage = "";
    if (daysUntilDueDate > 0) {
      dueMessage = `Next installment due in ${daysUntilDueDate} days.`;
    } else if (daysUntilDueDate === 0) {
      dueMessage = "Due today.";
    } else {
      dueMessage = "Past due.";
    }

    let quarterDateRange = "";
    const startYr = parseInt(advanceTaxResult.currentFy.split('-')[0]);
    if (n === 1) {
      quarterDateRange = `Apr 1 - Jun 15, ${startYr}`;
    } else if (n === 2) {
      quarterDateRange = `Jun 16 - Sep 15, ${startYr}`;
    } else if (n === 3) {
      quarterDateRange = `Sep 16 - Dec 15, ${startYr}`;
    } else if (n === 4) {
      quarterDateRange = `Dec 16, ${startYr} - Mar 15, ${startYr + 1}`;
    }

    return {
      n,
      quarterDateRange,
      dueMessage
    };
  }, [advanceTaxResult]);

  const historicalPaidAmountsList = useMemo(() => {
    return advanceTaxResult?.installments.map(
      (inst) => parseFloat(historicalPaidAmounts[inst.installmentNumber] || '0') || 0
    ) ?? [];
  }, [advanceTaxResult, historicalPaidAmounts]);

  const historicalCumulativePaid = useMemo(() => {
    return historicalPaidAmountsList.reduce<number[]>(
      (acc, val, i) => { acc.push((acc[i - 1] ?? 0) + val); return acc; }, []
    );
  }, [historicalPaidAmountsList]);

  const historicalShortfalls = useMemo(() => {
    return advanceTaxResult?.installments.map((inst, i) =>
      Math.max(0, inst.cumulativeObligation - (historicalCumulativePaid[i] ?? 0))
    ) ?? [];
  }, [advanceTaxResult, historicalCumulativePaid]);

  const historicalTotal234CInterest = useMemo(() => {
    return historicalShortfalls.reduce(
      (sum, s, i) => sum + calc234CInterest(s, i + 1), 0
    );
  }, [historicalShortfalls]);

  const historicalTotalPaid = useMemo(() => {
    return historicalPaidAmountsList.reduce((a, b) => a + b, 0);
  }, [historicalPaidAmountsList]);

  const historicalSASelectedDate = historicalSelfAssessmentDate || defaultSADate;

  const historicalB234 = useMemo(() => {
    if (!fyEndYear || !advanceTaxResult) return null;
    return calc234BInterest(
      advanceTaxResult.fullYearTax,
      historicalTotalPaid,
      historicalSASelectedDate,
      fyEndYear
    );
  }, [fyEndYear, advanceTaxResult, historicalTotalPaid, historicalSASelectedDate]);

  if (pansLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
        <p>Loading investor profiles...</p>
      </div>
    );
  }

  if (pansError) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
        <p>Error loading tax data: {pansError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* CARD 1: Full-width tab bar */}
      <div className="bg-white p-2 rounded-2xl border border-slate-200 shadow-sm animate-fade-in">
        <div className="flex p-1 bg-slate-100 rounded-xl w-full">
          {(['capital-gains', 'advance', 'unrealized', 'harvesting', 'simulator'] as TaxTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab 
                  ? 'bg-white text-primary shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'capital-gains' ? 'Capital Gains' : 
               tab === 'advance' ? 'Advance Tax' :
               tab === 'unrealized' ? 'Unrealized' :
               tab === 'harvesting' ? 'Harvesting' : 'Simulator'}
            </button>
          ))}
        </div>
      </div>

      {/* CARD 2: Controls row (tab-specific) */}
      <div className="flex flex-wrap items-end gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm animate-fade-in">
        <div className="space-y-1.5 flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Investor PAN</label>
          <select 
            className="block w-full h-[42px] bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-[#01696f]/20 transition-all outline-none"
            value={selectedPan}
            onChange={(e) => handlePanChange(e.target.value)}
            disabled={cgLoading || unrealizedLoading || advanceTaxLoading}
          >
            {pans.map(p => (
              <option key={p.pan} value={p.pan}>{p.name} ({p.pan})</option>
            ))}
          </select>
        </div>

        {activeTab === 'capital-gains' && (
          <div className="space-y-1.5 flex-1 min-w-[200px] animate-fade-in">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Financial Year</label>
            <div className="relative" ref={fyDropdownRef}>
              <button
                type="button"
                onClick={() => { if (!cgLoading) setFyDropdownOpen(prev => !prev); }}
                disabled={cgLoading}
                className="flex items-center justify-between w-full h-[42px] bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-[#01696f]/20 transition-all outline-none disabled:opacity-50"
              >
                <span>{selectedFy ? `FY ${selectedFy}` : 'Select FY'}</span>
                <ChevronDown className="w-4 h-4 text-slate-400 ml-2 shrink-0" />
              </button>
              {fyDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-full min-w-[130px] bg-white border border-slate-200 rounded-lg shadow-md z-50 overflow-hidden">
                  <div className="max-h-48 overflow-y-auto">
                    {fyOptions.map(fy => (
                      <button
                        key={fy}
                        type="button"
                        onClick={() => { handleFyChange(fy); setFyDropdownOpen(false); }}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                          selectedFy === fy
                            ? 'bg-[#01696f]/10 text-[#01696f] font-semibold'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        FY {fy}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'advance' && (
          <div className="space-y-1.5 flex-1 min-w-[200px] animate-fade-in">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Financial Year</label>
            <select
              className="block w-full h-[42px] bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-[#01696f]/20 transition-all outline-none"
              value={advanceTaxFy}
              onChange={(e) => handleAdvanceTaxFyChange(e.target.value)}
              disabled={advanceTaxLoading}
              id="advance-tax-fy-select"
            >
              {advanceTaxFyOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {activeTab === 'advance' && advanceTaxResult && (
          <div className="flex-shrink-0 animate-fade-in">
            <button
              onClick={handleAdvanceTaxExport}
              disabled={exportLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/10 px-5 py-2.5 rounded-xl font-medium text-sm flex items-center gap-2 transition-all cursor-pointer"
            >
              {exportLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4" />
              )}
              {exportLoading ? 'Exporting...' : 'Download Excel Report'}
            </button>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'capital-gains' && (
            <div className="space-y-8">
              {!cgData && !cgLoading && (
                <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-6">
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
                    <Receipt className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800">Computation Required</h3>
                    <p className="text-slate-500 text-sm mt-1">Select a PAN and Financial Year to compute realized capital gains.</p>
                  </div>
                  <button 
                    onClick={calculateCg}
                    className="bg-primary text-white px-6 py-2.5 rounded-xl font-medium hover:bg-primary-hover transition-all shadow-lg shadow-primary/20"
                  >
                    Calculate Gains
                  </button>
                </div>
              )}

              {cgLoading && (
                <div className="flex flex-col items-center justify-center py-24 text-slate-500">
                  <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
                  <p>Computing FIFO lots and tax liability...</p>
                </div>
              )}

              {cgError && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                  <p>{cgError}</p>
                </div>
              )}

              {cgData && (
                <div className="space-y-8">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
                          <TrendingUp className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-medium text-slate-500">Short-Term CG</p>
                      </div>
                      <p className={`text-2xl font-bold ${cgData.totalSTCG >= 0 ? 'text-slate-900' : 'text-danger'}`}>
                        {formatCurrency(cgData.totalSTCG)}
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                          <TrendingUp className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-medium text-slate-500">Long-Term CG</p>
                      </div>
                      <p className={`text-2xl font-bold ${cgData.totalLTCG >= 0 ? 'text-slate-900' : 'text-danger'}`}>
                        {formatCurrency(cgData.totalLTCG)}
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-10 h-10 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center">
                          <Receipt className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-medium text-slate-500">Estimated Tax</p>
                      </div>
                      <p className="text-2xl font-bold text-slate-900">
                        {formatCurrency(cgData.estimatedSTCGTax + cgData.estimatedLTCGTax)}
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-10 h-10 bg-slate-50 text-slate-600 rounded-xl flex items-center justify-center">
                          <Wallet className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-medium text-slate-500">Debt Gains</p>
                      </div>
                      <p className="text-2xl font-bold text-slate-900">
                        {formatCurrency(cgData.totalDebtGain)}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">At income slab rate</p>
                    </div>
                  </div>

                  {/* Exemption Bar — BUG-TAX-02 + BUG-TAX-05 fixed */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-slate-900">Equity LTCG Exemption</h4>
                      <span className="text-xs text-slate-400 font-normal">(Sec 112A)</span>
                    </div>

                    {/* BE pot — shown when there is BE LTCG, or when there is no LTCG at all (default) */}
                    {cgData.ltcgAE === 0 && (
                      <div className="space-y-2">
                        {cgData.ltcgBE > 0 && cgData.ltcgAE > 0 && (
                          <p className="text-xs font-medium text-slate-500">BE pot (pre Jul 23 2024 · 10%)</p>
                        )}
                        <div className="flex items-center justify-between text-sm font-medium">
                          <span className="text-primary">{formatCurrency(cgData.ltcgExemptionUsedBE)}</span>
                          <span className="text-slate-400"> of {formatCurrency(100000)} used</span>
                        </div>
                        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all duration-1000 ease-out"
                            style={{ width: `${Math.min(100, (cgData.ltcgExemptionUsedBE / 100000) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* AE pot — shown when there is AE LTCG */}
                    {cgData.ltcgAE > 0 && (
                      <div className="space-y-2">
                        {cgData.ltcgBE > 0 && (
                          <p className="text-xs font-medium text-slate-500">AE pot (Jul 23 2024 onwards · 12.5%)</p>
                        )}
                        <div className="flex items-center justify-between text-sm font-medium">
                          <span className="text-primary">{formatCurrency(cgData.ltcgExemptionUsedAE)}</span>
                          <span className="text-slate-400"> of {formatCurrency(125000)} used</span>
                        </div>
                        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all duration-1000 ease-out"
                            style={{ width: `${Math.min(100, (cgData.ltcgExemptionUsedAE / 125000) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Split: show both pots when both are active */}
                    {cgData.ltcgBE > 0 && cgData.ltcgAE > 0 && (
                      <>
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-slate-500">BE pot (pre Jul 23 2024 · 10%)</p>
                          <div className="flex items-center justify-between text-sm font-medium">
                            <span className="text-primary">{formatCurrency(cgData.ltcgExemptionUsedBE)}</span>
                            <span className="text-slate-400"> of {formatCurrency(100000)} used</span>
                          </div>
                          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all duration-1000 ease-out"
                              style={{ width: `${Math.min(100, (cgData.ltcgExemptionUsedBE / 100000) * 100)}%` }}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-slate-500">AE pot (Jul 23 2024 onwards · 12.5%)</p>
                          <div className="flex items-center justify-between text-sm font-medium">
                            <span className="text-primary">{formatCurrency(cgData.ltcgExemptionUsedAE)}</span>
                            <span className="text-slate-400"> of {formatCurrency(125000)} used</span>
                          </div>
                          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all duration-1000 ease-out"
                              style={{ width: `${Math.min(100, (cgData.ltcgExemptionUsedAE / 125000) * 100)}%` }}
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {/* Rate note — BUG-TAX-05 fixed */}
                    {cgData.ltcgTaxable > 0 && (
                      <p className="text-xs text-slate-500 flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-primary" />
                        Net taxable LTCG: {formatCurrency(cgData.ltcgTaxable)} (
                          {cgData.ltcgBE > 0 && cgData.ltcgAE > 0
                            ? 'BE portion at 10%, AE portion at 12.5%'
                            : cgData.ltcgAE > 0
                              ? 'taxable at 12.5%'
                              : 'taxable at 10%'}
                        )
                      </p>
                    )}
                  </div>

                  {/* Grandfathering Warning */}
                  {cgData.hasGrandfatheringFlags && (
                    <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex gap-3 text-amber-800">
                      <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-semibold">Grandfathering Warning</p>
                        <p className="mt-0.5 opacity-90">One or more lots were purchased before Jan 31, 2018. FMV data was unavailable for some units — these are marked with ⚠ below. Verify manually before filing.</p>
                      </div>
                    </div>
                  )}

                  {/* Scheme Merger Warnings — FEAT-TAX-02 Phase 1 */}
                  {mergerWarnings.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex gap-3 text-amber-800">
                      <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <div className="text-sm space-y-1">
                        {mergerWarnings.map((warning, index) => (
                          <p key={index} className="opacity-90">{warning}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Download Row */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3 bg-slate-50 border border-slate-200 p-4 rounded-2xl shadow-sm animate-fade-in">
                      <button
                        onClick={() => downloadCapitalGainsCsv(selectedPan, selectedFy, 'cleartax')}
                        disabled={cgData.folios.length === 0}
                        title="ClearTax: Upload directly to ClearTax. Applies to Equity (Schedule 112A). Does not include STCG."
                        className="px-4 py-2.5 rounded-xl text-sm font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        Download ClearTax CSV
                      </button>
                      <button
                        onClick={() => downloadCapitalGainsCsv(selectedPan, selectedFy, 'quicko')}
                        disabled={cgData.folios.length === 0}
                        title="Quicko: Upload directly to Quicko. Applies to Equity (Schedule 112A). Does not include STCG."
                        className="px-4 py-2.5 rounded-xl text-sm font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        Download Quicko CSV
                      </button>
                      <button
                        onClick={() => downloadAuditCsv(selectedPan, selectedFy)}
                        disabled={cgData.folios.length === 0}
                        className="px-4 py-2.5 rounded-xl text-sm font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        Download Audit CSV
                      </button>
                      <button
                        onClick={handleDownloadCgExcel}
                        disabled={cgData.folios.length === 0 || cgExcelLoading}
                        className="px-4 py-2.5 rounded-xl text-sm font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
                      >
                        <FileSpreadsheet className="w-4 h-4" />
                        {cgExcelLoading ? 'Generating...' : 'Download Capital Gains Excel'}
                      </button>
                      <button
                        onClick={handleDownloadItrSummary}
                        disabled={cgData.folios.length === 0 || itrLoading}
                        className="px-4 py-2.5 rounded-xl text-sm font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
                      >
                        <FileText className="w-4 h-4" />
                        {itrLoading ? 'Generating...' : 'Download ITR Summary'}
                      </button>
                    </div>

                    {cgExcelError && (
                      <p className="text-sm text-danger mt-1">{cgExcelError}</p>
                    )}
                    {itrError && (
                      <p className="text-sm text-danger mt-1">{itrError}</p>
                    )}
                  </div>

                  {/* Folio Table */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-200">
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Fund Name</th>
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">STCG</th>
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">LTCG</th>
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Debt Gain</th>
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Est. Tax</th>
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Flags</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {cgData.folios.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-6 py-12 text-center text-slate-400 text-sm">No capital gains realized in this financial year.</td>
                          </tr>
                        ) : (
                          cgData.folios.map(folio => (
                            <React.Fragment key={folio.folioId}>
                              <tr 
                                className="group hover:bg-slate-50 cursor-pointer transition-colors border-b border-slate-100 last:border-0"
                                onClick={() => toggleFolio(folio.folioId)}
                              >
                                <td className="px-6 py-4">
                                  <p className="font-semibold text-slate-900">{folio.fundName}</p>
                                  <p className="text-xs text-slate-400 mt-0.5">{folio.folioNumber}</p>
                                </td>
                                <td className={`px-6 py-4 text-right font-medium ${folio.totalSTCG >= 0 ? 'text-emerald-600' : 'text-danger'}`}>
                                  {formatCurrency(folio.totalSTCG)}
                                </td>
                                <td className={`px-6 py-4 text-right font-medium ${folio.totalLTCG >= 0 ? 'text-emerald-600' : 'text-danger'}`}>
                                  {formatCurrency(folio.totalLTCG)}
                                </td>
                                <td className="px-6 py-4 text-right text-slate-600">
                                  {folio.totalDebtGain !== 0 ? formatCurrency(folio.totalDebtGain) : '—'}
                                </td>
                                <td className="px-6 py-4 text-right font-semibold text-slate-900">
                                  {formatCurrency(folio.estimatedSTCGTax + folio.estimatedLTCGTax)}
                                </td>
                                <td className="px-6 py-4 text-center">
                                  {folio.hasGrandfatheringFlags && (
                                    <div className="flex items-center justify-center text-amber-500" title="FMV data missing for some lots">
                                      <AlertTriangle className="w-4 h-4" />
                                    </div>
                                  )}
                                </td>
                                <td className="px-6 py-4">
                                  {expandedFolios[folio.folioId] ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                                </td>
                              </tr>
                              {expandedFolios[folio.folioId] && (
                                <tr className="bg-slate-50/50">
                                  <td colSpan={7} className="px-6 py-4 border-b border-slate-100">
                                    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                                      <table className="w-full text-left text-xs">
                                        <thead>
                                          <tr className="bg-slate-50 border-b border-slate-100">
                                            <th className="px-4 py-2 font-semibold text-slate-500">Buy Date</th>
                                            <th className="px-4 py-2 font-semibold text-slate-500">Sell Date</th>
                                            <th className="px-4 py-2 font-semibold text-slate-500 text-right">Units</th>
                                            <th className="px-4 py-2 font-semibold text-slate-500 text-right">Buy NAV</th>
                                            <th className="px-4 py-2 font-semibold text-slate-500 text-right">Sale NAV</th>
                                            <th className="px-4 py-2 font-semibold text-slate-500 text-right">Gain</th>
                                            <th className="px-4 py-2 font-semibold text-slate-500">Holding</th>
                                            <th className="px-4 py-2 font-semibold text-slate-500">Type</th>
                                            <th className="px-4 py-2 font-semibold text-slate-500 text-right">Tax</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {folio.matchedLots.map((lot, idx) => (
                                            <tr key={idx} className="border-b border-slate-50 last:border-0 h-10">
                                              <td className="px-4 py-2 text-slate-600">{formatDate(lot.buyDate)}</td>
                                              <td className="px-4 py-2 text-slate-600">{formatDate(lot.sellDate)}</td>
                                              <td className="px-4 py-2 text-right font-medium text-slate-900">{lot.units.toFixed(4)}</td>
                                              <td className="px-4 py-2 text-right text-slate-600">{lot.buyNav.toFixed(4)}</td>
                                              <td className="px-4 py-2 text-right text-slate-600">{lot.saleNav.toFixed(4)}</td>
                                              <td className={`px-4 py-2 text-right font-medium ${lot.gain >= 0 ? 'text-emerald-600' : 'text-danger'}`}>
                                                {formatCurrency(lot.gain)}
                                                {lot.fmvMissing && <span className="ml-1 text-amber-500" title="FMV on Jan 31 2018 unavailable">⚠</span>}
                                              </td>
                                              <td className="px-4 py-2 text-slate-400">{lot.holdingDays}d</td>
                                              <td className="px-4 py-2">
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                  lot.gainType === 'LTCG' ? 'bg-emerald-100 text-emerald-700' :
                                                  lot.gainType === 'STCG' ? 'bg-amber-100 text-amber-700' :
                                                  'bg-blue-100 text-blue-700'
                                                }`}>
                                                  {lot.gainType}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2 text-right font-medium text-slate-900">
                                                {lot.taxRate !== null ? formatCurrency(lot.estimatedTax || 0) : '—'}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    {folio.warnings.length > 0 && (
                                      <div className="mt-3 space-y-1">
                                        {folio.warnings.map((w, i) => (
                                          <p key={i} className="text-[10px] text-amber-600 italic">⚠ {w}</p>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'unrealized' && (
            <div className="space-y-8">
              {!unrealizedData && !unrealizedLoading && (
                <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-6">
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
                    <TrendingUp className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800">Unrealized Performance</h3>
                    <p className="text-slate-500 text-sm mt-1">Estimate capital gains if your entire portfolio was sold today.</p>
                  </div>
                  <button 
                    onClick={calculateUnrealized}
                    className="bg-primary text-white px-6 py-2.5 rounded-xl font-medium hover:bg-primary-hover transition-all shadow-lg shadow-primary/20"
                  >
                    Calculate Unrealized
                  </button>
                </div>
              )}

              {unrealizedLoading && (
                <div className="flex flex-col items-center justify-center py-24 text-slate-500">
                  <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
                  <p>Processing complete history to build shadow lots...</p>
                </div>
              )}

              {unrealizedError && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                  <p>{unrealizedError}</p>
                </div>
              )}

              {unrealizedData && (
                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-slate-900">Unrealized Portfolio Gains</h3>
                    <p className="text-sm text-slate-400">Estimated value as of {formatDate(unrealizedData.asOfDate)}</p>
                  </div>

                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
                          <TrendingUp className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-medium text-slate-500">Unrealized STCG</p>
                      </div>
                      <p className={`text-2xl font-bold ${unrealizedData.totalSTCG >= 0 ? 'text-slate-900' : 'text-danger'}`}>
                        {formatCurrency(unrealizedData.totalSTCG)}
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                          <TrendingUp className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-medium text-slate-500">Unrealized LTCG</p>
                      </div>
                      <p className={`text-2xl font-bold ${unrealizedData.totalLTCG >= 0 ? 'text-slate-900' : 'text-danger'}`}>
                        {formatCurrency(unrealizedData.totalLTCG)}
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-10 h-10 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center">
                          <Receipt className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-medium text-slate-500">Est. Tax Liability</p>
                      </div>
                      <p className="text-2xl font-bold text-slate-900">
                        {formatCurrency(unrealizedData.estimatedSTCGTax + unrealizedData.estimatedLTCGTax)}
                      </p>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-10 h-10 bg-slate-50 text-slate-600 rounded-xl flex items-center justify-center">
                          <Wallet className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-medium text-slate-500">Debt Gains</p>
                      </div>
                      <p className="text-2xl font-bold text-slate-900">
                        {formatCurrency(unrealizedData.totalDebtGain)}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">At income slab rate</p>
                    </div>
                  </div>

                  {/* Exemption Bar */}
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-slate-900">Projected Equity LTCG Exemption</h4>
                      </div>
                      <p className="text-sm font-medium">
                        <span className="text-primary">{formatCurrency(unrealizedData.ltcgExemptionUsed)}</span>
                        <span className="text-slate-400"> of {formatCurrency(125000)} simulated</span>
                      </p>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary transition-all duration-1000 ease-out"
                        style={{ width: `${Math.min(100, (unrealizedData.ltcgExemptionUsed / 125000) * 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Folio Table */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-200">
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Fund Name</th>
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">ST Gain</th>
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">LT Gain</th>
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Debt Gain</th>
                          <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Est. Liability</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unrealizedData.folios.map(folio => (
                          <tr key={folio.folioId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4">
                              <p className="font-semibold text-slate-900">{folio.fundName}</p>
                              <p className="text-xs text-slate-400 mt-0.5">{folio.folioNumber}</p>
                            </td>
                            <td className={`px-6 py-4 text-right font-medium ${folio.totalSTCG >= 0 ? 'text-emerald-600' : 'text-danger'}`}>
                              {formatCurrency(folio.totalSTCG)}
                            </td>
                            <td className={`px-6 py-4 text-right font-medium ${folio.totalLTCG >= 0 ? 'text-emerald-600' : 'text-danger'}`}>
                              {formatCurrency(folio.totalLTCG)}
                            </td>
                            <td className="px-6 py-4 text-right text-slate-600">
                              {folio.totalDebtGain !== 0 ? formatCurrency(folio.totalDebtGain) : '—'}
                            </td>
                            <td className="px-6 py-4 text-right font-semibold text-slate-900">
                              {formatCurrency(folio.estimatedSTCGTax + folio.estimatedLTCGTax)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center gap-2 text-slate-400 text-sm">
                    <AlertTriangle className="w-4 h-4" />
                    <p>This is a hypothetical estimate assuming full redemption at today's NAV. Actual tax depends on redemption date, exit loads, and your income slab.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'harvesting' && (
            <div className="space-y-8">
              {!harvestingData && !harvestingLoading && (
                <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-6">
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
                    <TrendingUp className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800">Tax Harvesting Report</h3>
                    <p className="text-slate-500 text-sm mt-1">Identify opportunities to save tax by booking losses or utilizing LTCG exemption.</p>
                  </div>
                  <button 
                    onClick={calculateHarvesting}
                    className="bg-primary text-white px-6 py-2.5 rounded-xl font-medium hover:bg-primary-hover transition-all shadow-lg shadow-primary/20"
                  >
                    Find Opportunities
                  </button>
                </div>
              )}

              {harvestingLoading && (
                <div className="flex flex-col items-center justify-center py-24 text-slate-500">
                  <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
                  <p>Analyzing folios for harvesting opportunities...</p>
                </div>
              )}

              {harvestingError && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                  <p>{harvestingError}</p>
                </div>
              )}

              {harvestingData && (
                <div className="space-y-8">
                  {/* Harvesting Header */}
                  <div className="flex flex-wrap gap-4">
                    <div className="flex-1 min-w-[200px] bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                      <p className="text-sm text-slate-500 font-medium">Realised LTCG this FY</p>
                      <p className="text-lg font-bold text-slate-900">{formatCurrency(harvestingData.realisedLTCG)}</p>
                    </div>
                    <div className="flex-1 min-w-[200px] bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                      <p className="text-sm text-slate-500 font-medium">Remaining Exemption</p>
                      <p className={`text-lg font-bold ${harvestingData.remainingLtcgExemption > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {formatCurrency(harvestingData.remainingLtcgExemption)}
                      </p>
                    </div>
                  </div>

                  {/* Section 1: Gain Harvesting */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">📈</span>
                      <div>
                        <h4 className="font-semibold text-slate-900">Book Tax-Free Gains</h4>
                        <p className="text-xs text-slate-500">These folios have unrealised LTCG within your remaining ₹1.25L exemption.</p>
                      </div>
                    </div>
                    
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-slate-50/50 border-b border-slate-200">
                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Fund Name</th>
                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Folio</th>
                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Unrealised LTCG</th>
                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Suggested Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {harvestingData.gainHarvesting.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-6 py-8 text-center text-slate-400 text-sm italic">No gain harvesting opportunities — exemption fully used or no eligible LTCG.</td>
                            </tr>
                          ) : (
                            harvestingData.gainHarvesting.map((opt, i) => (
                              <tr key={i} className="border-b border-slate-100 last:border-0">
                                <td className="px-6 py-4 font-medium text-slate-800">{opt.fundName}</td>
                                <td className="px-6 py-4 text-slate-500 text-sm">{opt.folioNumber}</td>
                                <td className="px-6 py-4 text-right font-bold text-emerald-600">{formatCurrency(opt.unrealisedLTCG || 0)}</td>
                                <td className="px-6 py-4 text-sm text-primary font-medium">{opt.suggestedAction}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-8" />

                  {/* Section 2: Loss Harvesting */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">📉</span>
                      <div>
                        <h4 className="font-semibold text-slate-900">Harvest Tax Losses</h4>
                        <p className="text-xs text-slate-500">These folios have unrealised short-term losses that can offset STCG.</p>
                      </div>
                    </div>
                    
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-slate-50/50 border-b border-slate-200">
                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Fund Name</th>
                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Folio</th>
                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Unrealised STCG Loss</th>
                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Est. Tax Saving</th>
                            <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase">Suggested Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {harvestingData.lossHarvesting.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-6 py-8 text-center text-slate-400 text-sm italic">No short-term losses to harvest currently.</td>
                            </tr>
                          ) : (
                            harvestingData.lossHarvesting.map((opt, i) => (
                              <tr key={i} className="border-b border-slate-100 last:border-0">
                                <td className="px-6 py-4 font-medium text-slate-800">{opt.fundName}</td>
                                <td className="px-6 py-4 text-slate-500 text-sm">{opt.folioNumber}</td>
                                <td className="px-6 py-4 text-right font-bold text-danger">{formatCurrency(opt.unrealisedSTCGLoss || 0)}</td>
                                <td className="px-6 py-4 text-right font-bold text-emerald-600">{formatCurrency(opt.estimatedTaxSaving || 0)}</td>
                                <td className="px-6 py-4 text-sm text-primary font-medium">{opt.suggestedAction}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-4 rounded-xl flex gap-3 text-slate-500 text-xs italic">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <p>Harvesting calculations are estimates based on current NAVs and FIFO lot matching. Consult a tax advisor before acting. Re-buying units immediately after selling to harvest losses is legal in India — there is no wash sale rule.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'simulator' && (
            <div className="space-y-8">
              {/* Simulator Inputs Card */}
              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm space-y-8">
                <div className="max-w-md mx-auto space-y-6">
                  <div className="text-center space-y-2">
                    <h3 className="text-xl font-bold text-slate-900">Redemption Tax Simulator</h3>
                    <p className="text-sm text-slate-500">Calculate exact tax liability before placing a redemption order.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase">Select Folio</label>
                    <select
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      value={selectedFolioId}
                      onChange={(e) => {
                        setSelectedFolioId(e.target.value);
                        setSimResult(null);
                        setSimError(null);
                      }}
                    >
                      <option value="">Choose a fund folio...</option>
                      {folios.filter(f => f.currentUnits > 0).map(f => (
                        <option key={f.id} value={f.id}>{f.fundName} — {f.folioNumber}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-4">
                    <div className="flex p-1 bg-slate-100 rounded-xl">
                      <button
                        onClick={() => {
                          setSimInputMode('units');
                          setSimAmount('');
                          setSimResult(null);
                        }}
                        className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                          simInputMode === 'units' ? 'bg-white text-primary shadow-sm' : 'text-slate-500'
                        }`}
                      >
                        By Units
                      </button>
                      <button
                        onClick={() => {
                          setSimInputMode('amount');
                          setSimUnits('');
                          setSimResult(null);
                        }}
                        className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                          simInputMode === 'amount' ? 'bg-white text-primary shadow-sm' : 'text-slate-500'
                        }`}
                      >
                        By Amount ₹
                      </button>
                    </div>

                    {simInputMode === 'units' ? (
                      <input
                        type="number"
                        placeholder="Units to redeem"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        value={simUnits}
                        onChange={(e) => setSimUnits(e.target.value)}
                      />
                    ) : (
                      <input
                        type="number"
                        placeholder="Amount (₹) to redeem"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        value={simAmount}
                        onChange={(e) => setSimAmount(e.target.value)}
                      />
                    )}
                  </div>

                  <button
                    onClick={runSimulation}
                    disabled={!selectedFolioId || (simInputMode === 'units' ? !simUnits : !simAmount) || simLoading}
                    className="w-full bg-primary text-white py-3 rounded-xl font-semibold shadow-lg shadow-primary/20 hover:bg-primary-hover transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                  >
                    {simLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Receipt className="w-5 h-5" />}
                    Simulate Redemption
                  </button>

                  {simError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-xs flex gap-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      <p>{simError}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Simulation Result */}
              {simResult && (
                <div className="space-y-8">
                  {/* Result Summary */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <p className="text-xs font-medium text-slate-500 uppercase mb-4">Simulated Amount</p>
                      <p className="text-2xl font-bold text-slate-900">{formatCurrency(simResult.simulatedAmount)}</p>
                    </div>
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <p className="text-xs font-medium text-slate-500 uppercase mb-4">Total STCG</p>
                      <p className={`text-2xl font-bold ${simResult.totalSTCG >= 0 ? 'text-emerald-600' : 'text-danger'}`}>
                        {formatCurrency(simResult.totalSTCG)}
                      </p>
                    </div>
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <p className="text-xs font-medium text-slate-500 uppercase mb-4">Total LTCG</p>
                      <p className={`text-2xl font-bold ${simResult.totalLTCG >= 0 ? 'text-emerald-600' : 'text-danger'}`}>
                        {formatCurrency(simResult.totalLTCG)}
                      </p>
                    </div>
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <p className="text-xs font-medium text-slate-500 uppercase mb-4">Estimated Tax</p>
                      <p className="text-2xl font-bold text-rose-600">
                        {formatCurrency(simResult.estimatedSTCGTax + simResult.estimatedLTCGTax)}
                      </p>
                    </div>
                  </div>

                  {/* Lot Breakdown Table */}
                  <div className="space-y-4">
                    <h4 className="font-semibold text-slate-900">FIFO Lot Breakdown</h4>
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-slate-50/50 border-b border-slate-200 text-xs text-slate-500 uppercase font-semibold">
                            <th className="px-6 py-4">Buy Date</th>
                            <th className="px-6 py-4 text-right">Units</th>
                            <th className="px-6 py-4 text-right">Buy NAV</th>
                            <th className="px-6 py-4 text-right">Sale NAV</th>
                            <th className="px-6 py-4 text-right">Gain</th>
                            <th className="px-6 py-4">Holding</th>
                            <th className="px-6 py-4">Type</th>
                            <th className="px-6 py-4 text-right">Tax</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm">
                          {simResult.matchedLots.map((lot, i) => (
                            <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                              <td className="px-6 py-4 text-slate-600 font-mono">{formatDate(lot.buyDate)}</td>
                              <td className="px-6 py-4 text-right font-medium text-slate-900">{lot.units.toFixed(4)}</td>
                              <td className="px-6 py-4 text-right text-slate-500">{lot.buyNav.toFixed(4)}</td>
                              <td className="px-6 py-4 text-right text-slate-500">{lot.saleNav.toFixed(4)}</td>
                              <td className={`px-6 py-4 text-right font-bold ${lot.gain >= 0 ? 'text-emerald-600' : 'text-danger'}`}>
                                {formatCurrency(lot.gain)}
                                {lot.fmvMissing && <span className="ml-1 text-amber-500" title="FMV on Jan 31 2018 unavailable">⚠</span>}
                              </td>
                              <td className="px-6 py-4 text-slate-500">{lot.holdingDays}d</td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  lot.gainType === 'LTCG' ? 'bg-emerald-100 text-emerald-700' :
                                  lot.gainType === 'STCG' ? 'bg-amber-100 text-amber-700' :
                                  'bg-blue-100 text-blue-700'
                                }`}>
                                  {lot.gainType}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right font-medium text-slate-900">
                                {lot.estimatedTax !== null ? formatCurrency(lot.estimatedTax) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {simResult.warnings.length > 0 && (
                    <div className="space-y-1">
                      {simResult.warnings.map((w, i) => (
                        <p key={i} className="text-xs text-amber-600 italic">⚠ {w}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'advance' && (
            <div className="space-y-8" id="advance-tax-tab-content">
              {advanceTaxError && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center gap-3 animate-fade-in">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                  <p>{advanceTaxError}</p>
                </div>
              )}
              {exportError && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center gap-3 animate-fade-in">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                  <p>{exportError}</p>
                </div>
              )}

              {!advanceTaxResult && !advanceTaxLoading && (
                <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center space-y-6">
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
                    <Receipt className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800">Computation Required</h3>
                    <p className="text-slate-500 text-sm mt-1">Select an Investor and Financial Year in the controls panel to compute estimated advance installments.</p>
                  </div>
                  <button 
                    onClick={calculateAdvanceTax}
                    disabled={!selectedPan}
                    className="bg-primary text-white px-6 py-2.5 rounded-xl font-medium hover:bg-primary-hover transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
                  >
                    Calculate Advance Tax
                  </button>
                </div>
              )}

              {/* LOADING STATE */}
              {advanceTaxLoading ? (
                <div className="flex flex-col items-center justify-center py-24 text-slate-500" id="advance-tax-loading-spinner">
                  <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
                  <p>Calculating advance tax estimates and installment schedules...</p>
                </div>
              ) : (
                advanceTaxResult && (
                  <>
                    {/* SECTION 2 — Current quarter indicator */}
                    {advanceTaxResult.fyType === 'current' && currentQuarterInfo && (
                      <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex gap-3 text-amber-800 items-center shadow-sm font-medium flex-1" id="current-quarter-indicator">
                        <Info className="w-5 h-5 flex-shrink-0 text-amber-600" />
                        <div className="text-sm">
                          You are in Q{currentQuarterInfo.n} ({currentQuarterInfo.quarterDateRange}). {currentQuarterInfo.dueMessage}
                        </div>
                      </div>
                    )}

                    {/* SECTION 3 — Mode A Installment Table */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" id="advance-tax-installments">
                      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <h4 className="font-semibold text-slate-900">Installment Schedule</h4>
                          {advanceTaxFy !== currentInProgressFy && (
                            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded font-medium italic">
                              Historical FY — all installments are past due.
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse" id="advance-tax-installments-table">
                          <thead>
                            <tr className="bg-slate-50/20 border-b border-slate-200 font-semibold text-xs text-slate-500 uppercase">
                              <th className="px-6 py-4">Installment</th>
                              <th className="px-6 py-4">Due Date</th>
                              <th className="px-6 py-4">Gains This Quarter</th>
                              <th className="px-6 py-4 text-right">Cumulative Tax</th>
                              <th className="px-6 py-4 text-right">Cumulative Obligation</th>
                              <th className="px-6 py-4 text-right">This Installment Due</th>
                              {isCurrentOrPreviousFy(advanceTaxResult.fyType) && (
                                <>
                                  <th className="px-6 py-4 text-center w-28">Paid</th>
                                  <th className="px-6 py-4 text-right">Shortfall</th>
                                  <th className="px-6 py-4 text-right">234C Interest</th>
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {advanceTaxResult.installments.map((inst, i) => {
                              const isCurrentOrPrev = isCurrentOrPreviousFy(advanceTaxResult.fyType);
                              
                              let rowClass = "border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors";
                              if (inst.isPastDue) {
                                rowClass += " opacity-60 bg-slate-50/30";
                              } else if (inst.isCurrentInstallment) {
                                rowClass += " ring-2 ring-primary ring-inset bg-primary/5 font-semibold";
                              }

                              return (
                                <tr key={inst.installmentNumber} className={rowClass} id={`adv-tax-row-inst-${inst.installmentNumber}`}>
                                  <td className="px-6 py-4">
                                    <span className="font-medium">Installment {inst.installmentNumber}</span>
                                    <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-100 text-slate-600">
                                      Q{inst.installmentNumber}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 text-slate-600 font-mono text-sm">
                                    {formatDate(inst.dueDate)}
                                  </td>
                                  <td className="px-6 py-4 text-xs font-mono text-slate-600 leading-relaxed">
                                    <div className="text-slate-850">{formatCurrency(inst.quarterSTCG)} STCG</div>
                                    <div className="text-slate-500">{formatCurrency(inst.quarterLTCG)} LTCG</div>
                                  </td>
                                  <td className="px-6 py-4 text-right font-mono text-slate-600">
                                    {formatCurrency(inst.cumulativeTaxUpToCutoff)}
                                  </td>
                                  <td className="px-6 py-4 text-right font-mono text-slate-600 font-medium">
                                    {formatCurrency(inst.cumulativeObligation)} ({inst.cumulativePercent}%)
                                  </td>
                                  <td className="px-6 py-4 text-right font-bold text-slate-900 font-mono">
                                    {formatCurrency(inst.dueAmount)}
                                  </td>
                                  {isCurrentOrPrev && (
                                    <>
                                      <td className="px-6 py-4 text-center">
                                        <input
                                          type="number"
                                          placeholder="0"
                                          value={paidAmounts[inst.installmentNumber] ?? ''}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setPaidAmounts(prev => ({
                                              ...prev,
                                              [inst.installmentNumber]: val
                                            }));
                                          }}
                                          className="w-24 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-center focus:ring-1 focus:ring-primary outline-none"
                                        />
                                      </td>
                                      <td className={`px-6 py-4 text-right font-mono font-medium ${shortfalls[i] > 0 ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>
                                        {formatCurrency(shortfalls[i])}
                                      </td>
                                      <td className={`px-6 py-4 text-right font-mono font-bold ${calc234CInterest(shortfalls[i], inst.installmentNumber) > 0 ? 'text-rose-600 font-extrabold' : 'text-slate-500'}`}>
                                        {formatCurrency(calc234CInterest(shortfalls[i], inst.installmentNumber))}
                                      </td>
                                    </>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* SECTION 4 — Summary row */}
                    {isCurrentOrPreviousFy(advanceTaxResult.fyType) && (
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4" id="advance-tax-summary-row">
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Obligation</p>
                          <p className="text-lg font-bold text-slate-900 mt-1 font-mono">
                            {formatCurrency(advanceTaxResult.installments[3]?.cumulativeObligation ?? 0)}
                          </p>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Paid</p>
                          <p className="text-lg font-bold text-slate-900 mt-1 font-mono">
                            {formatCurrency(totalPaid)}
                          </p>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Shortfall</p>
                          <p className={`text-lg font-bold mt-1 font-mono ${
                            Math.max(0, (advanceTaxResult.installments[3]?.cumulativeObligation ?? 0) - totalPaid) > 0 
                              ? 'text-rose-500' 
                              : 'text-emerald-600'
                          }`}>
                            {formatCurrency(Math.max(0, (advanceTaxResult.installments[3]?.cumulativeObligation ?? 0) - totalPaid))}
                          </p>
                        </div>
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm animate-fade-in">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-medium">Estimated 234C Interest</p>
                          <p className={`text-lg font-extrabold mt-1 font-mono ${total234CInterest > 0 ? 'text-rose-500' : 'text-slate-900'}`}>
                            {formatCurrency(total234CInterest)}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* SECTION 5 — 234B warning */}
                    {isCurrentOrPreviousFy(advanceTaxResult.fyType) && fyEndYear && (
                      (() => {
                        const b234 = calc234BInterest(
                          advanceTaxResult.fullYearTax,
                          totalPaid,
                          selfAssessmentDate || defaultSADate,
                          fyEndYear
                        );

                        if (!b234.applicable) return null;

                        return (
                          <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl flex flex-col md:flex-row gap-6 text-amber-900 shadow-sm" id="section-234b-warning">
                            <div className="w-10 h-10 bg-amber-100/60 text-amber-600 rounded-xl flex items-center justify-center shrink-0">
                              <AlertTriangle className="w-5 h-5" />
                            </div>
                            <div className="space-y-4 flex-1">
                              <div>
                                <p className="font-semibold text-amber-950">Section 234B Interest Applicable</p>
                                <p className="text-sm mt-1 leading-relaxed text-amber-800">
                                  If your total advance tax paid ({formatCurrency(totalPaid)}) is below 90% of your annual tax liability ({formatCurrency(advanceTaxResult.fullYearTax)}), Section 234B interest applies from April 1 at 1% per month.
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-amber-900">Estimated 234B interest:</span>
                                <span className="text-base font-extrabold text-amber-950 bg-amber-100 px-2 py-0.5 rounded font-mono">
                                  {formatCurrency(b234.interest)}
                                </span>
                              </div>
                              <div className="border-t border-amber-200/60 pt-4 flex flex-col sm:flex-row sm:items-center gap-4">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Self-assessment payment date</label>
                                  <input
                                    type="date"
                                    value={selfAssessmentDate || defaultSADate}
                                    onChange={(e) => setSelfAssessmentDate(e.target.value)}
                                    className="bg-white border border-amber-305 rounded-lg px-2.5 py-1 text-sm text-slate-800 outline-none focus:ring-1 focus:ring-amber-500 font-medium font-mono"
                                  />
                                </div>
                                <p className="text-xs text-amber-700 italic max-w-sm">
                                  Assumes self-assessment paid by {formatDate(selfAssessmentDate || defaultSADate)}. Edit to match your actual payment date.
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })()
                    )}

                    {/* SECTION 6 — Quarter-wise redemption breakdown */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" id="section-redemption-breakdown">
                      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
                        <div className="space-y-0.5">
                          <h4 className="font-semibold text-slate-900">Quarter-wise Redemption Breakdown</h4>
                          <p className="text-xs text-slate-500">View redemptions that accrued capital gains during this Financial Year.</p>
                        </div>
                        <button
                          onClick={() => setRedemptionBreakdownOpen(!redemptionBreakdownOpen)}
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 transition-all text-slate-600 outline-none cursor-pointer"
                        >
                          {redemptionBreakdownOpen ? (
                            <>
                              Hide Breakdown
                              <ChevronUp className="w-3.5 h-3.5" />
                            </>
                          ) : (
                            <>
                              Show Redemption Breakdown
                              <ChevronDown className="w-3.5 h-3.5" />
                            </>
                          )}
                        </button>
                      </div>

                      {redemptionBreakdownOpen && (
                        <div className="p-6 space-y-6 animate-fade-in">
                          {(() => {
                            const hasAnyRedemptions = advanceTaxResult.installments.some(
                              inst => inst.quarterRedemptions && inst.quarterRedemptions.length > 0
                            );

                            if (!hasAnyRedemptions) {
                              return (
                                <p className="text-sm text-slate-400 italic text-center py-4">No redemptions in this FY.</p>
                              );
                            }

                            return advanceTaxResult.installments.map(inst => {
                              const redemptions = inst.quarterRedemptions;
                              if (!redemptions || redemptions.length === 0) return null;

                              return (
                                <div key={inst.installmentNumber} className="space-y-2 border border-slate-100 rounded-xl p-4 bg-slate-50/30">
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-sm text-slate-800">Quarter Q{inst.installmentNumber}</span>
                                    <span className="text-xs text-slate-400">Before due date {formatDate(inst.dueDate)}</span>
                                  </div>
                                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                                    <table className="w-full text-left border-collapse text-xs">
                                      <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-500 uppercase">
                                          <th className="px-4 py-2.5">Date</th>
                                          <th className="px-4 py-2.5">Fund</th>
                                          <th className="px-4 py-2.5">Folio</th>
                                          <th className="px-4 py-2.5 text-right font-mono">Units</th>
                                          <th className="px-4 py-2.5 text-right font-mono">Amount</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {redemptions.map((red, idx) => (
                                          <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors">
                                            <td className="px-4 py-2 text-slate-600 font-mono">{formatDate(red.date)}</td>
                                            <td className="px-4 py-2 text-slate-800 font-medium">{red.fundName}</td>
                                            <td className="px-4 py-2 text-slate-500 font-mono">{red.folioNumber}</td>
                                            <td className="px-4 py-2 text-right text-slate-950 font-mono">{red.units.toFixed(4)}</td>
                                            <td className="px-4 py-2 text-right font-bold text-slate-700 font-mono">{formatCurrency(red.amount)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      )}
                    </div>

                    {/* SECTION 7 — Historical interest calculation */}
                    {advanceTaxResult.fyType === 'historical' && fyEndYear && (
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-fade-in" id="section-historical-interest-card">
                        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
                          <div className="space-y-0.5">
                            <h4 className="font-semibold text-slate-900">Check 234C / 234B Interest (Historical)</h4>
                            <p className="text-xs text-slate-500">For verifying past compliance or IT notices.</p>
                          </div>
                          <button
                            onClick={() => {
                              setShowHistoricalInterest(!showHistoricalInterest);
                              if (!showHistoricalInterest) {
                                setHistoricalInterestCalculated(false);
                              }
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium bg-white hover:bg-slate-50 transition-all text-slate-600 outline-none cursor-pointer"
                          >
                            {showHistoricalInterest ? (
                              <>
                                Collapse Tool
                                <ChevronUp className="w-3.5 h-3.5" />
                              </>
                            ) : (
                              <>
                                Expand Tool
                                <ChevronDown className="w-3.5 h-3.5" />
                              </>
                            )}
                          </button>
                        </div>

                        {showHistoricalInterest && (
                          <div className="p-6 space-y-6 animate-fade-in" id="historical-interest-tool-content">
                            <div className="bg-slate-50 p-4 rounded-xl space-y-4">
                              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Historical Enter Payments</p>
                              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                                {[1, 2, 3, 4].map(n => (
                                  <div key={n} className="space-y-1">
                                    <label className="text-xs text-slate-600 font-medium font-mono">Paid Q{n} (₹)</label>
                                    <input
                                      type="number"
                                      placeholder="0"
                                      value={historicalPaidAmounts[n] ?? ''}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setHistoricalPaidAmounts(prev => ({ ...prev, [n]: val }));
                                      }}
                                      className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-sm text-center outline-none focus:ring-1 focus:ring-primary font-medium font-mono"
                                    />
                                  </div>
                                ))}
                              </div>

                              <div className="flex flex-col sm:flex-row sm:items-end gap-4 border-t border-slate-200/60 pt-4">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Self-assessment payment date</label>
                                  <input
                                    type="date"
                                    value={historicalSelfAssessmentDate || defaultSADate}
                                    onChange={(e) => setHistoricalSelfAssessmentDate(e.target.value)}
                                    className="bg-white border border-slate-200 rounded px-3 py-1.5 text-sm text-slate-850 outline-none focus:ring-1 focus:ring-primary font-medium font-mono"
                                  />
                                </div>
                                <button
                                  onClick={() => setHistoricalInterestCalculated(true)}
                                  className="bg-primary text-white px-5 py-2 rounded-lg font-medium hover:bg-primary-hover transition-all text-sm h-[38px] cursor-pointer"
                                >
                                  Calculate Interest
                                </button>
                              </div>
                            </div>

                            {historicalInterestCalculated && (
                              <div className="space-y-6 border-t border-slate-100 pt-6 animate-fade-in">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4" id="historical-summary-results">
                                  <div className="bg-slate-50 p-4 rounded-xl">
                                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Obligation</p>
                                    <p className="text-lg font-bold text-slate-900 mt-1 font-mono">
                                      {formatCurrency(advanceTaxResult.installments[3]?.cumulativeObligation ?? 0)}
                                    </p>
                                  </div>
                                  <div className="bg-slate-50 p-4 rounded-xl">
                                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Paid</p>
                                    <p className="text-lg font-bold text-slate-900 mt-1 font-mono">
                                      {formatCurrency(historicalTotalPaid)}
                                    </p>
                                  </div>
                                  <div className="bg-slate-50 p-4 rounded-xl">
                                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Shortfall</p>
                                    <p className={`text-lg font-bold mt-1 font-mono ${
                                      Math.max(0, (advanceTaxResult.installments[3]?.cumulativeObligation ?? 0) - historicalTotalPaid) > 0 
                                        ? 'text-rose-500' 
                                        : 'text-emerald-600'
                                    }`}>
                                      {formatCurrency(Math.max(0, (advanceTaxResult.installments[3]?.cumulativeObligation ?? 0) - historicalTotalPaid))}
                                    </p>
                                  </div>
                                  <div className="bg-slate-50 p-4 rounded-xl">
                                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-medium">Estimated 234C Interest</p>
                                    <p className={`text-lg font-extrabold mt-1 font-mono ${historicalTotal234CInterest > 0 ? 'text-rose-500' : 'text-slate-900'}`}>
                                      {formatCurrency(historicalTotal234CInterest)}
                                    </p>
                                  </div>
                                </div>

                                {historicalB234 && historicalB234.applicable && (
                                  <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex gap-3 text-amber-900" id="historical-234b-result">
                                    <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600" />
                                    <div className="text-sm space-y-1">
                                      <p className="font-semibold text-amber-950">Section 234B Interest Applicable</p>
                                      <p className="text-amber-800">
                                        Section 234B interest is applicable since total paid ({formatCurrency(historicalTotalPaid)}) is below 90% of the annual tax liability ({formatCurrency(advanceTaxResult.fullYearTax)}).
                                      </p>
                                      <p className="font-bold text-amber-950">
                                        Estimated 234B interest (up to {formatDate(historicalSASelectedDate)}): {formatCurrency(historicalB234.interest)}
                                      </p>
                                    </div>
                                  </div>
                                )}
                                
                                {historicalB234 && !historicalB234.applicable && (
                                  <div className="bg-emerald-50 border border-emerald-110 p-4 rounded-xl text-sm text-emerald-800 font-medium">
                                    ✓ No Section 234B interest applicable (paid amount is at least 90% of annual tax).
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )
              )}

              {/* SECTION 8 — Disclaimer */}
              <div className="flex items-center gap-2 text-slate-400 text-xs italic" id="advance-tax-disclaimer">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <p>Estimate based on realised gains only. Does not include gains from other asset classes. Consult a tax advisor for your final advance tax liability.</p>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
