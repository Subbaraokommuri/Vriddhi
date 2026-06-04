import React, { useState, useEffect, useMemo } from 'react';
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
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, formatDate } from '../lib/utils.ts';
import { 
  getTaxPans, 
  getCapitalGains, 
  downloadCapitalGainsCsv, 
  downloadAuditCsv,
  getUnrealizedGains,
  getHarvestingReport,
  simulateRedemption,
  fetchFolios,
  getAdvanceTaxEstimate
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

export function TaxReport() {
  const [activeTab, setActiveTab] = useState<TaxTab>('capital-gains');
  const [pans, setPans] = useState<TaxPan[]>([]);
  const [selectedPan, setSelectedPan] = useState<string>('');
  const [selectedFy, setSelectedFy] = useState<string>('');
  const [pansLoading, setPansLoading] = useState(true);
  const [pansError, setPansError] = useState<string | null>(null);

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
    for (let i = 1; i <= 5; i++) {
      const yr = startYear - i;
      const endShort = (yr + 1).toString().slice(-2);
      options.push({ value: `${yr}-${endShort}`, label: `FY ${yr}-${endShort}` });
    }
    return options;
  }, [currentInProgressFy]);

  const [advanceTaxResult, setAdvanceTaxResult] = useState<AdvanceTaxEstimate | null>(null);
  const [advanceTaxLoading, setAdvanceTaxLoading] = useState(false);
  const [advanceTaxError, setAdvanceTaxError] = useState<string | null>(null);
  const [paidSoFar, setPaidSoFar] = useState<string>('');

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
  };

  const handleFyChange = (fy: string) => {
    setSelectedFy(fy);
    setCgData(null);
    setCgError(null);
  };

  const calculateAdvanceTax = async () => {
    if (!selectedPan) return;
    setAdvanceTaxLoading(true);
    setAdvanceTaxError(null);
    try {
      const paidSoFarValue = parseFloat(paidSoFar) || 0;
      const data = await getAdvanceTaxEstimate(selectedPan, advanceTaxFy, paidSoFarValue);
      setAdvanceTaxResult(data);
    } catch (err: any) {
      setAdvanceTaxError(err.message);
    } finally {
      setAdvanceTaxLoading(false);
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
  if (selectedFy) {
    const [startYearStr] = selectedFy.split('-');
    const maxStartYear = parseInt(startYearStr);
    for (let yr = maxStartYear; yr >= 2010; yr--) {
      const endShort = (yr + 1).toString().slice(-2);
      fyOptions.push(`${yr}-${endShort}`);
    }
  }

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
      {/* Top Controls */}
      <div className="flex flex-wrap items-center gap-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Investor PAN</label>
          <select 
            className="block w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-primary/20 transition-all outline-none"
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
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Financial Year</label>
            <select 
              className="block w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-primary/20 transition-all outline-none"
              value={selectedFy}
              onChange={(e) => handleFyChange(e.target.value)}
              disabled={cgLoading}
            >
              {fyOptions.map(fy => (
                <option key={fy} value={fy}>FY {fy}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex-1" />

        <div className="flex p-1 bg-slate-100 rounded-xl">
          {(['capital-gains', 'unrealized', 'harvesting', 'simulator', 'advance'] as TaxTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab 
                  ? 'bg-white text-primary shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'capital-gains' ? 'Capital Gains' : 
               tab === 'unrealized' ? 'Unrealized' :
               tab === 'harvesting' ? 'Harvesting' :
               tab === 'simulator' ? 'Simulator' : 'Advance Tax'}
            </button>
          ))}
        </div>
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

                  {/* STCG Warning — BUG-TAX-04 */}
                  {cgData.totalSTCG !== 0 && (
                    <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex gap-3 text-amber-800">
                      <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-semibold">ClearTax and Quicko CSVs cover LTCG only (Schedule 112A)</p>
                        <p className="mt-0.5 opacity-90">
                          Your STCG of {formatCurrency(cgData.totalSTCG)} is not included in these files.
                          Report it separately in your ITR under Short Term Capital Gains from Equity MF.
                          Use the Audit CSV for a complete per-lot breakdown covering both STCG and LTCG.
                        </p>
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
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => downloadCapitalGainsCsv(selectedPan, selectedFy, 'cleartax')}
                      disabled={cgData.folios.length === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-all disabled:opacity-50"
                    >
                      <Download className="w-4 h-4" />
                      Download ClearTax CSV
                    </button>
                    <button
                      onClick={() => downloadCapitalGainsCsv(selectedPan, selectedFy, 'quicko')}
                      disabled={cgData.folios.length === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-all disabled:opacity-50"
                    >
                      <Download className="w-4 h-4" />
                      Download Quicko CSV
                    </button>
                    <button
                      onClick={() => downloadAuditCsv(selectedPan, selectedFy)}
                      disabled={cgData.folios.length === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-all disabled:opacity-50"
                    >
                      <Download className="w-4 h-4" />
                      Download Audit CSV
                    </button>
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
              {/* SECTION 1 - Controls row */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4" id="advance-tax-controls-card">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Financial Year
                    </label>
                    <select
                      className="block w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                      value={advanceTaxFy}
                      onChange={(e) => setAdvanceTaxFy(e.target.value)}
                      disabled={advanceTaxLoading}
                      id="advance-tax-fy-select"
                    >
                      {advanceTaxFyOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Already paid this FY (₹)
                    </label>
                    <div className="flex gap-4">
                      <input
                        className="block flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        value={paidSoFar}
                        onChange={e => setPaidSoFar(e.target.value)}
                        placeholder="0"
                        type="number" 
                        min="0"
                        id="advance-tax-paid-so-far"
                      />
                      <button
                        id="advance-tax-calculate-btn"
                        onClick={calculateAdvanceTax}
                        disabled={advanceTaxLoading || !selectedPan}
                        className="bg-primary text-white px-6 py-2.5 rounded-xl font-medium hover:bg-primary-hover transition-all shadow-lg shadow-primary/20 disabled:opacity-50 h-[42px] flex items-center justify-center gap-2"
                      >
                        {advanceTaxLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                        Calculate
                      </button>
                    </div>
                  </div>
                </div>
                {advanceTaxError && (
                  <p className="text-sm font-medium text-rose-600 animate-pulse" id="advance-tax-error-msg">
                    {advanceTaxError}
                  </p>
                )}
              </div>

              {/* LOADING STATE vs RESULTS */}
              {advanceTaxLoading ? (
                <div className="flex flex-col items-center justify-center py-24 text-slate-500" id="advance-tax-loading-spinner">
                  <Loader2 className="w-8 h-8 animate-spin mb-4 text-primary" />
                  <p>Calculating advance tax estimates and installment schedules...</p>
                </div>
              ) : (
                advanceTaxResult && (
                  <>
                    {/* SECTION 2 - Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4" id="advance-tax-summary-cards">
                      {/* Card A */}
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm" id="adv-tax-card-est-annual">
                        <p className="text-sm font-medium text-slate-500 mb-2">Estimated Annual Tax</p>
                        <p className="text-2xl font-bold text-slate-900">
                          {formatCurrency(advanceTaxResult.estimatedAnnualTax)}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          Based on realised gains in FY {advanceTaxResult.currentFy} so far
                        </p>
                      </div>

                      {/* Card B */}
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm" id="adv-tax-card-paid">
                        <p className="text-sm font-medium text-slate-500 mb-2">Already Paid</p>
                        <p className="text-2xl font-bold text-slate-900">
                          {formatCurrency(advanceTaxResult.paidSoFar)}
                        </p>
                      </div>

                      {/* Card C */}
                      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm" id="adv-tax-card-still-due">
                        <p className="text-sm font-medium text-slate-500 mb-2">Still Due</p>
                        <p className={`text-2xl font-bold ${
                          advanceTaxResult.totalStillDue > 0 ? "text-rose-600" : "text-emerald-600"
                        }`}>
                          {formatCurrency(advanceTaxResult.totalStillDue)}
                        </p>
                      </div>
                    </div>

                    {/* SECTION 3 - Tax Breakdown */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm" id="advance-tax-breakdown">
                      <h4 className="font-semibold text-slate-900 mb-4 h-5">Tax Breakdown</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3 bg-slate-50 p-4 rounded-xl" id="adv-tax-stcg-col">
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500 font-medium">Net STCG</span>
                            <span className="font-semibold text-slate-900">
                              {formatCurrency(advanceTaxResult.realisedTax.netSTCG)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-sm border-t border-slate-200/60 pt-2">
                            <span className="text-slate-500 font-medium">STCG Tax</span>
                            <span className="font-bold text-slate-900">
                              {formatCurrency(advanceTaxResult.realisedTax.estimatedSTCGTax)}
                            </span>
                          </div>
                        </div>
                        <div className="space-y-3 bg-slate-50 p-4 rounded-xl" id="adv-tax-ltcg-col">
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500 font-medium">Net LTCG</span>
                            <span className="font-semibold text-slate-900">
                              {formatCurrency(advanceTaxResult.realisedTax.netLTCG)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-sm border-t border-slate-200/60 pt-2">
                            <span className="text-slate-500 font-medium">LTCG Tax</span>
                            <span className="font-bold text-slate-900">
                              {formatCurrency(advanceTaxResult.realisedTax.estimatedLTCGTax)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* SECTION 4 - Installment Schedule Table */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" id="advance-tax-installments">
                      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/50">
                        <h4 className="font-semibold text-slate-900">Installment Schedule</h4>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse" id="advance-tax-installments-table">
                          <thead>
                            <tr className="bg-slate-50/20 border-b border-slate-200 font-semibold text-xs text-slate-500 uppercase">
                              <th className="px-6 py-4">Installment</th>
                              <th className="px-6 py-4">Due Date</th>
                              <th className="px-6 py-4 text-right">Cumulative %</th>
                              <th className="px-6 py-4 text-right">This Installment</th>
                              <th className="px-6 py-4 text-right">Cumulative Due</th>
                              <th className="px-6 py-4 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {advanceTaxResult.installments.map((inst) => {
                              let rowClass = "border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors";
                              if (inst.isPastDue) {
                                rowClass += " opacity-60 bg-slate-50/30";
                              } else if (inst.isCurrentInstallment) {
                                rowClass += " ring-2 ring-primary ring-inset bg-primary/5 font-semibold";
                              }

                              let statusBg = "bg-slate-100 text-slate-600";
                              let statusText = "Upcoming";
                              if (inst.isPastDue) {
                                statusBg = "bg-slate-200 text-slate-500";
                                statusText = "Past due";
                              } else if (inst.isCurrentInstallment) {
                                statusBg = "bg-amber-100 text-amber-800";
                                statusText = "Due next";
                              }

                              return (
                                <tr key={inst.installmentNumber} className={rowClass} id={`adv-tax-row-inst-${inst.installmentNumber}`}>
                                  <td className="px-6 py-4">
                                    Installment {inst.installmentNumber}
                                  </td>
                                  <td className="px-6 py-4 font-mono font-medium text-slate-600">
                                    {formatDate(inst.dueDate)}
                                  </td>
                                  <td className="px-6 py-4 text-right font-mono text-slate-600">
                                    {inst.cumulativePercent}%
                                  </td>
                                  <td className="px-6 py-4 text-right font-bold text-slate-900 font-mono">
                                    {formatCurrency(inst.dueAmount)}
                                  </td>
                                  <td className="px-6 py-4 text-right font-semibold text-slate-900 font-mono">
                                    {formatCurrency(inst.cumulativeAmount)}
                                  </td>
                                  <td className="px-6 py-4 text-center">
                                    <div className="flex items-center justify-center gap-1.5">
                                      <span className={`px-2 py-1 rounded text-xs font-bold ${statusBg}`}>
                                        {statusText}
                                      </span>
                                      {inst.isCurrentInstallment && (
                                        <span className="px-2 py-1 rounded text-xs font-bold bg-primary text-white animate-pulse">
                                          Pay now
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {advanceTaxFy !== currentInProgressFy && (
                        <div className="px-6 py-3 bg-amber-50/60 border-t border-slate-200/60 text-xs text-amber-700 font-medium italic animate-fade-in" id="historical-fy-note">
                          Historical FY — all installments are past due.
                        </div>
                      )}
                    </div>
                  </>
                )
              )}

              {/* SECTION 5 - Disclaimer */}
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
