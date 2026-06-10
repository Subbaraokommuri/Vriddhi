import { db, log } from './db.ts';
import { fetchFullNiftyTRIHistory } from './benchmarks.ts';

export async function runStartupTasks(): Promise<void> {
  try {
    const row = db.prepare("SELECT COUNT(*) as count FROM benchmark_history WHERE index_name = 'Nifty 50'").get() as { count: number };
    if (row && row.count > 0) {
      // Data already exists, nothing to do
      return;
    }

    log('benchmark', 'INFO', 'STARTUP', 'Nifty 50 TRI data missing — fetching on startup');

    // Fetch the full Nifty 50 TRI price history from niftyindices.com
    let data;
    try {
      data = await fetchFullNiftyTRIHistory('Nifty 50');
    } catch (fetchErr: any) {
      log('benchmark', 'ERROR', 'STARTUP', `Failed to fetch Nifty 50 TRI on startup: ${fetchErr.message || String(fetchErr)}`);
      return;
    }

    if (!data || data.length === 0) {
      log('benchmark', 'INFO', 'STARTUP', 'Incomplete or empty history returned for Nifty 50 TRI');
      return;
    }

    // Insert all rows in a single DB transaction
    try {
      const insertStmt = db.prepare('INSERT OR IGNORE INTO benchmark_history (index_name, price_date, value) VALUES (?, ?, ?)');
      
      const transaction = db.transaction((rows: Array<{ date: string; value: number }>) => {
        for (const row of rows) {
          insertStmt.run('Nifty 50', row.date, row.value);
        }
      });

      transaction(data);

      log('benchmark', 'INFO', 'STARTUP', `Nifty 50 TRI: inserted ${data.length} rows into benchmark_history`);
    } catch (insertErr: any) {
      log('benchmark', 'ERROR', 'STARTUP', `Failed to insert benchmark history into DB: ${insertErr.message || String(insertErr)}`);
    }

  } catch (err: any) {
    // Catch-all to make absolutely sure server startup is never blocked
    log('benchmark', 'ERROR', 'STARTUP', `Unexpected error in runStartupTasks: ${err.message || String(err)}`);
  }
}
