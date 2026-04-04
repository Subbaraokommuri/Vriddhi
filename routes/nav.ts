import express from 'express';
import { db, log } from '../lib/db.ts';
import { CONFIG } from '../lib/config.ts';

const router = express.Router();

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
};

/**
 * Shared function to refresh AMFI codes and latest NAV from NAVAll.txt
 */
export async function refreshAmfiCodes() {
  let updated = 0;
  let notFound = 0;
  const failed: { name: string; isin: string; reason: string }[] = [];
  const isinMap = new Map<string, any>();
  let isFallback = false;

  try {
    // Primary Source: portal.amfiindia.com
    const response = await fetch('https://portal.amfiindia.com/spages/NAVAll.txt', {
      headers: { 'User-Agent': 'Mozilla/5.0 FolioTracker/1.0' }
    });
    
    if (!response.ok) {
      throw new Error(`AMFI fetch failed: ${response.statusText}`);
    }
    
    log('nav', 'INFO', 'NAV', 'Source: NAVAll.txt (portal.amfiindia.com)');
    const text = await response.text();
    const lines = text.split('\n');
    
    for (const line of lines) {
      const parts = line.trim().split(';');
      // Format: SchemeCode;ISINGrowth;ISINReinvest;SchemeName;NAV;Date
      if (parts.length >= 6) {
        const schemeCode = parts[0];
        const isinGrowth = parts[1];
        const isinReinvest = parts[2];
        const schemeName = parts[3];
        const nav = parseFloat(parts[4]);
        const navDateRaw = parts[5];

        if (schemeCode && navDateRaw && !isNaN(nav)) {
          // Convert DD-MMM-YYYY to YYYY-MM-DD
          const dateParts = navDateRaw.split('-');
          if (dateParts.length === 3) {
            const day = dateParts[0].padStart(2, '0');
            const month = MONTH_MAP[dateParts[1]];
            const year = dateParts[2];
            if (month) {
              const isoDate = `${year}-${month}-${day}`;
              const data = { schemeCode, nav, navDate: isoDate, schemeName };
              if (isinGrowth && isinGrowth !== '-') isinMap.set(isinGrowth, data);
              if (isinReinvest && isinReinvest !== '-') isinMap.set(isinReinvest, data);
            }
          }
        }
      }
    }
  } catch (primaryError) {
    log('nav', 'WARN', 'NAV', `Primary AMFI fetch failed: ${String(primaryError)}. Trying MFAPI fallback...`);
    try {
      // Fallback Source: api.mfapi.in
      const response = await fetch('https://api.mfapi.in/mf', {
        headers: { 'User-Agent': 'Mozilla/5.0 FolioTracker/1.0' }
      });
      if (!response.ok) {
        throw new Error(`MFAPI fallback failed: ${response.statusText}`);
      }
      
      log('nav', 'WARN', 'NAV', 'Source: MFAPI fallback (no NAV data)');
      const data = await response.json() as any[];
      isFallback = true;
      
      for (const item of data) {
        const schemeCode = item.schemeCode;
        const isinGrowth = item.isinGrowth;
        const isinReinvest = item.isinDivReinvestment;
        
        if (schemeCode) {
          const entry = { schemeCode };
          if (isinGrowth && isinGrowth !== '-') isinMap.set(isinGrowth, entry);
          if (isinReinvest && isinReinvest !== '-') isinMap.set(isinReinvest, entry);
        }
      }
    } catch (fallbackError) {
      const msg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      log('nav', 'ERROR', 'NAV', `refreshAmfiCodes failed (both sources): ${msg}`);
      throw fallbackError;
    }
  }

  const funds = db.prepare('SELECT id, name, isin FROM funds WHERE isin IS NOT NULL').all() as any[];
  log('nav', 'INFO', 'NAV', `Starting AMFI refresh: ${funds.length} funds to process`);

  for (const fund of funds) {
    try {
      const match = isinMap.get(fund.isin);
      if (match) {
        db.prepare('UPDATE funds SET amfi_code = ? WHERE id = ?').run(match.schemeCode, fund.id);
        
        if (!isFallback && match.nav !== undefined && match.navDate) {
          db.prepare('INSERT OR REPLACE INTO nav_history (isin, nav_date, nav) VALUES (?, ?, ?)').run(fund.isin, match.navDate, match.nav);
          log('nav', 'INFO', 'NAV', `Updated ${fund.name} (${fund.isin}): amfi_code=${match.schemeCode} nav=${match.nav} date=${match.navDate}`);
        } else {
          log('nav', 'INFO', 'NAV', `Updated ${fund.name} (${fund.isin}): amfi_code=${match.schemeCode} (No NAV update)`);
        }
        updated++;
      } else {
        log('nav', 'WARN', 'NAV', `ISIN not found in NAVAll.txt: ${fund.isin} (${fund.name})`);
        notFound++;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ name: fund.name, isin: fund.isin, reason });
      log('nav', 'ERROR', 'NAV', `Failed ${fund.name} (${fund.isin}): ${reason}`);
    }
  }

  log('nav', 'INFO', 'NAV', `COMPLETE amfi-refresh: ${updated} updated, ${notFound} not found, ${failed.length} errors`);
  return { updated, notFound, failed };
}

router.post('/nav/refresh-amfi-codes', async (req, res) => {
  try {
    const result = await refreshAmfiCodes();
    res.json({
      updated: result.updated,
      notFound: result.notFound,
      failedCount: result.failed.length
    });
  } catch (error) {
    res.status(503).json({ error: 'Failed to fetch NAVAll.txt from AMFI' });
  }
});

router.post('/fetch-nav', async (req, res) => {
  log('nav', 'INFO', 'NAV', 'Starting NAV update via NAVAll.txt');
  try {
    const result = await refreshAmfiCodes();
    log('nav', 'INFO', 'NAV', `COMPLETE nav-update: ${result.updated} updated, ${result.notFound} not found, ${result.failed.length} errors`);
    res.json({
      updated: result.updated,
      notFound: result.notFound,
      failedCount: result.failed.length
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log('nav', 'ERROR', 'NAV', `NAVAll.txt fetch failed: ${reason}`);
    res.status(503).json({ error: 'Failed to fetch NAVAll.txt from AMFI' });
  }
});

router.post('/nav/backfill', async (req, res) => {
  const funds = db.prepare(`
    SELECT f.id, f.name, f.isin, f.amfi_code, f.nav_history_fetched,
           MAX(nh.nav_date) as last_nav_date
    FROM funds f
    LEFT JOIN nav_history nh ON nh.isin = f.isin
    WHERE f.amfi_code IS NOT NULL AND f.isin IS NOT NULL
    GROUP BY f.id
  `).all() as any[];

  log('nav', 'INFO', 'BACKFILL', `Starting NAV history backfill/sync: ${funds.length} funds to process`);
  
  let full_backfill = 0;
  let incremental = 0;
  let up_to_date = 0;
  const failed: { name: string; reason: string }[] = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const fund of funds) {
    try {
      // CASE 2: Already backfilled, check gap
      if (fund.nav_history_fetched === 1 && fund.last_nav_date) {
        const lastDate = new Date(fund.last_nav_date);
        lastDate.setHours(0, 0, 0, 0);
        const gap = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (gap <= 1) {
          log('nav', 'INFO', 'BACKFILL', `Up to date: ${fund.name} (last: ${fund.last_nav_date})`);
          up_to_date++;
          continue;
        }
      }

      // Fetch from MFAPI
      const response = await fetch(`https://api.mfapi.in/mf/${fund.amfi_code}`);
      if (!response.ok) {
        throw new Error(`MFAPI request failed: ${response.statusText}`);
      }
      
      const data = await response.json() as any;
      if (data && data.data && Array.isArray(data.data)) {
        let rowsBefore = 0;
        if (fund.nav_history_fetched === 1) {
          const countRes = db.prepare('SELECT COUNT(*) as count FROM nav_history WHERE isin = ?').get(fund.isin) as any;
          rowsBefore = countRes.count;
        }

        const insert = db.prepare('INSERT OR IGNORE INTO nav_history (isin, nav_date, nav) VALUES (?, ?, ?)');
        const transaction = db.transaction((items: any[]) => {
          for (const item of items) {
            // Convert DD-MM-YYYY to YYYY-MM-DD
            const parts = item.date.split('-');
            if (parts.length === 3) {
              const isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
              insert.run(fund.isin, isoDate, parseFloat(item.nav));
            }
          }
        });
        
        transaction(data.data);

        if (fund.nav_history_fetched === 0) {
          // CASE 1: Never backfilled
          db.prepare('UPDATE funds SET nav_history_fetched = 1 WHERE id = ?').run(fund.id);
          log('nav', 'INFO', 'BACKFILL', `Full backfill ${fund.name}: ${data.data.length} days inserted`);
          full_backfill++;
        } else {
          // CASE 2: Incremental fill
          const countRes = db.prepare('SELECT COUNT(*) as count FROM nav_history WHERE isin = ?').get(fund.isin) as any;
          const rowsAfter = countRes.count;
          const newRows = rowsAfter - rowsBefore;
          
          const lastDate = new Date(fund.last_nav_date);
          lastDate.setHours(0, 0, 0, 0);
          const gap = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
          
          log('nav', 'INFO', 'BACKFILL', `Incremental fill ${fund.name}: ${newRows} new days, gap was ${gap} days`);
          incremental++;
        }
      } else {
        throw new Error('Invalid data format from MFAPI');
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log('nav', 'ERROR', 'BACKFILL', `Failed ${fund.name} (${fund.amfi_code}): ${reason}`);
      failed.push({ name: fund.name, reason });
    }
    
    // 300ms delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  log('nav', 'INFO', 'BACKFILL', `COMPLETE backfill: ${full_backfill} full, ${incremental} incremental, ${up_to_date} up-to-date, ${failed.length} errors`);
  res.json({ full_backfill, incremental, up_to_date, failed });
});

/**
 * OPERATION 3 — POST /nav/backfill (when built) → logs/nav-backfill.log
 * // START: INFO "Starting NAV history backfill: {N} funds"
 * // PER FUND: INFO "Backfilled {fund_name}: {N} days of history"
 * // END: INFO "COMPLETE nav-backfill: {N} funds, {K} errors"
 */

export default router;
