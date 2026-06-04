import { 
  Summary, 
  Folio, 
  Portfolio, 
  Transaction, 
  Fund, 
  TagTheme, 
  FolioTagDetail,
  RelativePerformanceResult,
  InvestmentTrendPoint,
  DashboardStats,
  TransactionFilters,
  FolioXirr,
  FundGroupXirr,
  PanCapitalGainsSummary,
  UnrealizedGainsSummary,
  HarvestingReport,
  SimulationResult,
  TaxPan,
  BenchmarkXirrResponse,
  AdvanceTaxEstimate,
  OverallXirrResult
} from './types.ts';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text();
    let errorMsg = errorText;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed.error) errorMsg = parsed.error;
    } catch (e) {}
    throw new Error(errorMsg || `Request failed with status ${response.status}`);
  }
  if (response.status === 204) return {} as T;
  return response.json();
}

export async function fetchRelativePerformance(
  themeId: string,
  tag: string,
  benchmarkSymbol: string
): Promise<RelativePerformanceResult> {
  const res = await fetch(
    `/api/relative-performance?theme_id=${encodeURIComponent(themeId)}&tag=${encodeURIComponent(tag)}&benchmark_symbol=${encodeURIComponent(benchmarkSymbol)}`
  );
  return handleResponse<RelativePerformanceResult>(res);
}

export async function getDashboardPerformance(
  benchmarkSymbol: string
): Promise<RelativePerformanceResult | null> {
  try {
    const res = await fetch(
      `/api/relative-performance?theme_id=seed-portfolio-theme` +
      `&tag=${encodeURIComponent('All MF')}` +
      `&benchmark_symbol=${encodeURIComponent(benchmarkSymbol)}`
    );
    return handleResponse<RelativePerformanceResult>(res);
  } catch {
    return null;
  }
}

export async function fetchSummary(): Promise<Summary> {
  const res = await fetch('/api/summary');
  return handleResponse<Summary>(res);
}

export async function fetchFunds(): Promise<Fund[]> {
  const res = await fetch('/api/funds');
  return handleResponse<Fund[]>(res);
}

export async function fetchFolios(): Promise<Folio[]> {
  const res = await fetch('/api/folios');
  return handleResponse<Folio[]>(res);
}

export async function fetchPortfolios(): Promise<Portfolio[]> {
  const res = await fetch('/api/portfolios');
  return handleResponse<Portfolio[]>(res);
}


export async function getTransactions(filters?: TransactionFilters): Promise<Transaction[]> {
  const params = new URLSearchParams();
  if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters?.dateTo) params.set('dateTo', filters.dateTo);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.fundId) params.set('fundId', filters.fundId);
  if (filters?.folio) params.set('folio', filters.folio);
  if (filters?.amountMin != null) params.set('amountMin', String(filters.amountMin));
  if (filters?.amountMax != null) params.set('amountMax', String(filters.amountMax));
  const query = params.toString();
  const res = await fetch(`/api/transactions${query ? '?' + query : ''}`);
  if (!res.ok) throw new Error('Failed to fetch transactions');
  return res.json();
}

export async function getTransactionFundsList(): Promise<{ id: string; name: string }[]> {
  const res = await fetch('/api/transactions/funds-list');
  if (!res.ok) throw new Error('Failed to fetch funds list');
  const data = await res.json();
  return data.funds;
}

export async function fetchBenchmarks(): Promise<any[]> {
  const res = await fetch('/api/user-benchmarks');
  return handleResponse<any[]>(res);
}

export const getUserBenchmarks = fetchBenchmarks;

export async function addUserBenchmark(data: { 
  symbol: string; 
  name: string; 
  source: string; 
  category: string; 
  color: string;
  benchmark_type?: string;
  amfi_code?: string;
}): Promise<{ id: string }> {
  const res = await fetch('/api/user-benchmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to add benchmark');
  return res.json();
}

export async function searchAmfiMetadata(q: string): Promise<{ results: { amfi_code: string; name: string; fundHouse: string }[]; total: number }> {
  const res = await fetch(`/api/amfi-search?q=${encodeURIComponent(q)}`);
  return handleResponse<{ results: { amfi_code: string; name: string; fundHouse: string }[]; total: number }>(res);
}

export async function refreshAmfiMetadata(): Promise<{ success: boolean; count: number }> {
  const res = await fetch('/api/amfi-metadata/refresh', { method: 'POST' });
  return handleResponse<{ success: boolean; count: number }>(res);
}

export async function getAmfiMetadataStatus(): Promise<{ exists: boolean; count: number }> {
  const res = await fetch('/api/amfi-metadata/status');
  return handleResponse<{ exists: boolean; count: number }>(res);
}

export async function getAmfiFundHouses(): Promise<{ fundHouses: string[] }> {
  const res = await fetch('/api/amfi-metadata/fund-houses');
  return handleResponse<{ fundHouses: string[] }>(res);
}

export async function deleteUserBenchmark(id: string): Promise<void> {
  const res = await fetch(`/api/user-benchmarks/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete benchmark');
}

export async function importBenchmarkCsv(benchmarkId: string, file: File): Promise<{ inserted: number; skipped: number; total: number }> {
  const formData = new FormData();
  formData.append('benchmarkId', benchmarkId);
  formData.append('file', file);

  const res = await fetch('/api/benchmarks/import-csv', {
    method: 'POST',
    body: formData
  });
  return handleResponse<{ inserted: number; skipped: number; total: number }>(res);
}

export async function getBenchmarkDataSummary(id: string): Promise<{ oldest: string; latest: string; count: number } | null> {
  const res = await fetch(`/api/benchmarks/${id}/data-summary`);
  return handleResponse<{ oldest: string; latest: string; count: number } | null>(res);
}

export async function fetchBenchmarkData(id: string): Promise<{ inserted: number; total: number }> {
  const res = await fetch(`/api/benchmarks/${id}/fetch`, { method: 'POST' });
  return handleResponse<{ inserted: number; total: number }>(res);
}

export async function fetchBenchmarkXirr(params: { folioId?: string; portfolioId?: string; benchmarkIds: string[] }): Promise<any> {
  const query = new URLSearchParams();
  if (params.folioId) query.append('folio_id', params.folioId);
  if (params.portfolioId) query.append('portfolio_id', params.portfolioId);
  params.benchmarkIds.forEach(id => query.append('benchmark_ids', id));
  
  const res = await fetch(`/api/benchmark-xirr?${query.toString()}`);
  return handleResponse<any>(res);
}

export async function fetchPortfolioGrowth(benchmarkSymbol: string): Promise<any[]> {
  const res = await fetch(`/api/portfolio-growth-vs-benchmark?benchmark_symbol=${benchmarkSymbol}`);
  return handleResponse<any[]>(res);
}

export async function importCas(csvData: string): Promise<{ added: number; skipped: number; errors: number }> {
  const res = await fetch('/api/import-cas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ csvData }),
  });
  return handleResponse<{ added: number; skipped: number; errors: number }>(res);
}

export async function updateNavs(): Promise<{ updated: number; errors?: { fundId: string; name: string; error: string }[] }> {
  const res = await fetch('/api/fetch-nav', { method: 'POST' });
  return handleResponse<{ updated: number; errors?: { fundId: string; name: string; error: string }[] }>(res);
}

export async function refreshAmfiCodes(): Promise<{ updated: number; notFound: number; failedCount: number }> {
  const res = await fetch('/api/nav/refresh-amfi-codes', { method: 'POST' });
  return handleResponse<{ updated: number; notFound: number; failedCount: number }>(res);
}

export async function backfillNavHistory(): Promise<{ full_backfill: number; incremental: number; up_to_date: number; failed: any[] }> {
  const res = await fetch('/api/nav/backfill', { method: 'POST' });
  return handleResponse<{ full_backfill: number; incremental: number; up_to_date: number; failed: any[] }>(res);
}

export async function fetchLogs(type: string, date: string): Promise<string> {
  const res = await fetch(`/api/logs?type=${type}&date=${date}`);
  if (!res.ok) {
    throw new Error(`No logs found for ${type} on ${date}`);
  }
  return res.text();
}

// TAG MANAGEMENT API

export async function getTagThemes(): Promise<TagTheme[]> {
  const res = await fetch('/api/tags/themes');
  return handleResponse<TagTheme[]>(res);
}

export async function createTagTheme(name: string): Promise<void> {
  const res = await fetch('/api/tags/themes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return handleResponse<void>(res);
}

export async function renameTagTheme(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/tags/themes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return handleResponse<void>(res);
}

export async function deleteTagTheme(id: string): Promise<void> {
  const res = await fetch(`/api/tags/themes/${id}`, { method: 'DELETE' });
  return handleResponse<void>(res);
}

export async function addTagToTheme(themeId: string, tag: string): Promise<void> {
  const res = await fetch(`/api/tags/themes/${themeId}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag }),
  });
  return handleResponse<void>(res);
}

export async function renameTag(themeId: string, oldTag: string, newTag: string): Promise<void> {
  const res = await fetch(`/api/tags/themes/${themeId}/tags/${encodeURIComponent(oldTag)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newTag }),
  });
  return handleResponse<void>(res);
}

export async function deleteTag(themeId: string, tag: string): Promise<void> {
  const res = await fetch(`/api/tags/themes/${themeId}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
  return handleResponse<void>(res);
}

export async function getUnassignedTags(): Promise<string[]> {
  const res = await fetch('/api/tags/unassigned');
  return handleResponse<string[]>(res);
}

export async function getThemeTags(themeId: string): Promise<string[]> {
  const res = await fetch(`/api/tags/themes/${encodeURIComponent(themeId)}/tags`);
  return handleResponse<string[]>(res);
}

export async function deleteUnassignedTag(tag: string): Promise<void> {
  const res = await fetch(`/api/tags/unassigned/${encodeURIComponent(tag)}`, { method: 'DELETE' });
  return handleResponse<void>(res);
}

// Folio-level Tag API

export async function getFolioTags(folioId: string): Promise<FolioTagDetail[]> {
  const res = await fetch(`/api/folios/${folioId}/tags`);
  return handleResponse<FolioTagDetail[]>(res);
}

export async function assignTagToFolio(folioId: string, tag: string, themeId: string | null): Promise<void> {
  const res = await fetch(`/api/folios/${folioId}/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag, theme_id: themeId }),
  });
  return handleResponse<void>(res);
}

export async function removeTagFromFolio(folioId: string, tag: string): Promise<void> {
  const res = await fetch(`/api/folios/${folioId}/tags/${encodeURIComponent(tag)}`, {
    method: 'DELETE',
  });
  return handleResponse<void>(res);
}

export async function assignAllMfTag(): Promise<{ assigned: number; skipped: number; total: number }> {
  const res = await fetch('/api/tags/assign-all-mf', { method: 'POST' });
  return handleResponse<{ assigned: number; skipped: number; total: number }>(res);
}

export async function getInvestmentTrend(): Promise<{ data: InvestmentTrendPoint[] }> {
  const res = await fetch('/api/investment-trend');
  return handleResponse<{ data: InvestmentTrendPoint[] }>(res);
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const res = await fetch('/api/dashboard-stats');
  if (!res.ok) throw new Error('Failed to fetch dashboard stats');
  return res.json();
}

export interface FolioXirrFilters {
  activeOnly?: boolean;
  fundHouse?: string;
  category?: string;
  subCategory?: string;
  plan?: string;
  fundOption?: string;
  tag?: string;
  themeId?: string;
  search?: string;
  pan?: string;
}

export async function getFoliosXirr(filters?: FolioXirrFilters): Promise<FolioXirr[]> {
  const params = new URLSearchParams();
  if (filters?.activeOnly) params.set('activeOnly', '1');
  if (filters?.fundHouse) params.set('fundHouse', filters.fundHouse);
  if (filters?.category) params.set('category', filters.category);
  if (filters?.plan) params.set('plan', filters.plan);
  if (filters?.fundOption) params.set('fundOption', filters.fundOption);
  if (filters?.tag) params.set('tag', filters.tag);
  if (filters?.search) params.set('search', filters.search);
  const query = params.toString();
  const res = await fetch(`/api/folios-xirr${query ? '?' + query : ''}`);
  if (!res.ok) throw new Error('Failed to fetch folios XIRR data');
  const data = await res.json();
  return data.folios;
}

export async function getFundsXirrGrouped(): Promise<FundGroupXirr[]> {
  const res = await fetch('/api/funds-xirr-grouped');
  if (!res.ok) throw new Error(`Failed to fetch grouped funds: ${res.statusText}`);
  return res.json();
}

export function downloadFundsGroupedCsv(filters: {
  search?: string;
  fundHouse?: string;
  category?: string;
  plan?: string;
  fundOption?: string;
  activeOnly?: boolean;
} = {}): void {
  const params = new URLSearchParams();
  if (filters.search)     params.set('search',     filters.search);
  if (filters.fundHouse)  params.set('fundHouse',  filters.fundHouse);
  if (filters.category)   params.set('category',   filters.category);
  if (filters.plan)       params.set('plan',        filters.plan);
  if (filters.fundOption) params.set('fundOption',  filters.fundOption);
  if (filters.activeOnly !== undefined)
    params.set('activeOnly', String(filters.activeOnly));
  window.location.href = `/api/export-funds-grouped-csv?${params.toString()}`;
}

export async function getFoliosBenchmarkXirr(
  folioIds: string[],
  benchmarkSymbol: string
): Promise<BenchmarkXirrResponse> {
  const res = await fetch('/api/folios-benchmark-xirr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folioIds, benchmarkSymbol }),
  });
  if (!res.ok) throw new Error(`Benchmark XIRR failed: ${res.statusText}`);
  return res.json();
}

export async function getTaxPans(): Promise<TaxPan[]> {
  const res = await fetch('/api/tax/pans');
  if (!res.ok) throw new Error('Failed to fetch PANs');
  const data = await res.json();
  return data.pans;
}

export async function getCapitalGains(
  pan: string,
  fy?: string
): Promise<PanCapitalGainsSummary> {
  const params = new URLSearchParams({ pan });
  if (fy) params.set('fy', fy);
  const res = await fetch(`/api/tax/capital-gains?${params}`);
  if (!res.ok) throw new Error('Failed to fetch capital gains');
  return res.json();
}

export function downloadCapitalGainsCsv(
  pan: string,
  fy: string,
  format: 'cleartax' | 'quicko'
): void {
  const params = new URLSearchParams({ pan, fy, format });
  window.location.href = `/api/tax/capital-gains/export?${params}`;
}

export function downloadAuditCsv(pan: string, fy: string): void {
  const params = new URLSearchParams({ pan, fy });
  window.location.href = `/api/tax/capital-gains-audit-csv?${params}`;
}

export async function getUnrealizedGains(
  pan: string
): Promise<UnrealizedGainsSummary> {
  const params = new URLSearchParams({ pan });
  const res = await fetch(`/api/tax/unrealized?${params}`);
  if (!res.ok) throw new Error('Failed to fetch unrealized gains');
  return res.json();
}

export async function getHarvestingReport(
  pan: string,
  fy?: string
): Promise<HarvestingReport> {
  const params = new URLSearchParams({ pan });
  if (fy) params.set('fy', fy);
  const res = await fetch(`/api/tax/harvesting?${params}`);
  if (!res.ok) throw new Error('Failed to fetch harvesting report');
  return res.json();
}

export async function simulateRedemption(
  folioId: string,
  units?: number,
  amount?: number
): Promise<SimulationResult> {
  const params = new URLSearchParams({ folioId });
  if (units !== undefined) params.set('units', units.toString());
  if (amount !== undefined) params.set('amount', amount.toString());
  const res = await fetch(`/api/tax/simulate?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || 'Failed to simulate redemption');
  }
  return res.json();
}

export async function getAdvanceTaxEstimate(
  pan: string,
  fy?: string,
  paidSoFar?: number
): Promise<AdvanceTaxEstimate> {
  const params = new URLSearchParams({ pan });
  if (fy) {
    params.set('fy', fy);
  }
  if (paidSoFar !== undefined) {
    params.set('paidSoFar', String(paidSoFar));
  }
  const res = await fetch(`/api/tax/advance-tax?${params.toString()}`);
  if (!res.ok) throw new Error(`Advance tax estimate failed: ${res.statusText}`);
  return res.json();
}

export async function getOverallXirr(folioIds: string[]): Promise<OverallXirrResult> {
  const res = await fetch('/api/funds/overall-xirr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folioIds })
  });
  return handleResponse<OverallXirrResult>(res);
}


export function exportTransactionsCsv(filters: TransactionFilters = {}): void {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.type) params.set('type', filters.type);
  if (filters.fundId) params.set('fundId', filters.fundId);
  if (filters.folio) params.set('folio', filters.folio);
  if (filters.amountMin != null) params.set('amountMin', String(filters.amountMin));
  if (filters.amountMax != null) params.set('amountMax', String(filters.amountMax));
  window.location.href = `/api/transactions/export-csv?${params.toString()}`;
}

export async function downloadImportLog(date: string): Promise<void> {
  const url = `/api/logs?type=import&date=${date}&download=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Import log not found for this date');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `import-${date}.log`;
  a.click();
  URL.revokeObjectURL(a.href);
}


