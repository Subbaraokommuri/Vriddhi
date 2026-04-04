import { Summary, Folio, Portfolio, Transaction, Fund } from './types';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Request failed with status ${response.status}`);
  }
  return response.json();
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

export async function fetchLogs(type: string, date: string): Promise<string> {
  const res = await fetch(`/api/logs?type=${type}&date=${date}`);
  if (!res.ok) {
    throw new Error(`No logs found for ${type} on ${date}`);
  }
  return res.text();
}

export async function fetchAllBenchmarks(): Promise<{ updated: any[] }> {
  const res = await fetch('/api/fetch-all-benchmarks', { method: 'POST' });
  return handleResponse<{ updated: any[] }>(res);
}
