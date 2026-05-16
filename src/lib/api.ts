import { 
  Summary, 
  Folio, 
  Portfolio, 
  Transaction, 
  Fund, 
  TagTheme, 
  FolioTagDetail,
  RelativePerformanceResult,
  InvestmentTrendPoint 
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

export async function fetchTransactions(folioId?: string): Promise<Transaction[]> {
  const url = folioId ? `/api/transactions?folio_id=${folioId}` : '/api/transactions';
  const res = await fetch(url);
  return handleResponse<Transaction[]>(res);
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
