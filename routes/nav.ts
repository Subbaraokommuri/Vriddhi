import express from 'express';
import { db, appendLog } from '../lib/db.ts';
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
    
    appendLog('amfi-refresh.log', 'INFO', 'Source: NAVAll.txt (portal.amfiindia.com)');
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
    appendLog('amfi-refresh.log', 'WARN', `Primary AMFI fetch failed: ${String(primaryError)}. Trying MFAPI fallback...`);
    try {
      // Fallback Source: api.mfapi.in
      const response = await fetch('https://api.mfapi.in/mf', {
        headers: { 'User-Agent': 'Mozilla/5.0 FolioTracker/1.0' }
      });
      if (!response.ok) {
        throw new Error(`MFAPI fallback failed: ${response.statusText}`);
      }
      
      appendLog('amfi-refresh.log', 'WARN', 'Source: MFAPI fallback (no NAV data)');
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
      appendLog('amfi-refresh.log', 'ERROR', `refreshAmfiCodes failed (both sources): ${msg}`);
      throw fallbackError;
    }
  }

  const funds = db.prepare('SELECT id, name, isin FROM funds WHERE isin IS NOT NULL').all() as any[];

  for (const fund of funds) {
    try {
      const match = isinMap.get(fund.isin);
      if (match) {
        db.prepare('UPDATE funds SET amfi_code = ? WHERE id = ?').run(match.schemeCode, fund.id);
        
        if (!isFallback && match.nav !== undefined && match.navDate) {
          db.prepare('INSERT OR REPLACE INTO nav_history (isin, nav_date, nav) VALUES (?, ?, ?)').run(fund.isin, match.navDate, match.nav);
          appendLog('amfi-refresh.log', 'INFO', `Updated ${fund.name}: code=${match.schemeCode}, nav=${match.nav}, date=${match.navDate}`);
        } else {
          appendLog('amfi-refresh.log', 'INFO', `Updated ${fund.name}: code=${match.schemeCode} (No NAV update)`);
        }
        updated++;
      } else {
        appendLog('amfi-refresh.log', 'WARN', `ISIN not found: ${fund.isin} (${fund.name})`);
        notFound++;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ name: fund.name, isin: fund.isin, reason });
      appendLog('amfi-refresh.log', 'ERROR', `Failed updating ${fund.name}: ${reason}`);
    }
  }

  return { updated, notFound, failed };
}

router.post('/refresh-amfi-codes', async (req, res) => {
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

export default router;
