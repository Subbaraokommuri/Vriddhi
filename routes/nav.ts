import express from 'express';
import { db, appendLog } from '../lib/db.ts';
import { CONFIG } from '../lib/config.ts';

const router = express.Router();

router.post('/fetch-nav', async (req, res) => {
  const funds = db.prepare('SELECT id, name, isin, amfi_code FROM funds').all() as any[];
  let updated = 0;
  const errors: { fundId: string; name: string; error: string }[] = [];

  for (const fund of funds) {
    try {
      let code = fund.amfi_code;

      // If amfi_code is missing, try to search by ISIN
      if (!code && fund.isin) {
        try {
          const searchRes = await fetch(`https://api.mfapi.in/mf/search?q=${fund.isin}`);
          const searchData = await searchRes.json() as any[];
          if (searchData && searchData.length > 0) {
            code = searchData[0].schemeCode;
            db.prepare('UPDATE funds SET amfi_code = ? WHERE id = ?').run(code, fund.id);
            appendLog('nav.log', 'INFO', `Mapped ISIN ${fund.isin} to AMFI code ${code} for ${fund.name}`);
          }
        } catch (searchErr) {
          console.error(`Search failed for ISIN ${fund.isin}:`, searchErr);
        }
      }

      if (!code) {
        errors.push({ fundId: fund.id, name: fund.name, error: 'Missing AMFI code and ISIN search failed' });
        continue;
      }

      const response = await fetch(`${CONFIG.APIS.MF_DATA}${code}`);
      let data = await response.json() as any;
      
      // Fallback to ISIN search if existing code fails to return data
      if ((!data || !data.data || data.data.length === 0) && fund.isin) {
        appendLog('nav.log', 'WARN', `Existing code ${code} failed for ${fund.name}, trying ISIN search`);
        const searchRes = await fetch(`https://api.mfapi.in/mf/search?q=${fund.isin}`);
        const searchData = await searchRes.json() as any[];
        if (searchData && searchData.length > 0) {
          const newCode = searchData[0].schemeCode;
          if (newCode !== code) {
            code = newCode;
            db.prepare('UPDATE funds SET amfi_code = ? WHERE id = ?').run(code, fund.id);
            appendLog('nav.log', 'INFO', `Updated stale code for ${fund.name} to ${code}`);
            
            // Retry fetch with new code
            const retryRes = await fetch(`${CONFIG.APIS.MF_DATA}${code}`);
            data = await retryRes.json() as any;
          }
        }
      }
      
      if (data && data.data && data.data.length > 0) {
        const latest = data.data[0];
        // Date format in mfapi is DD-MM-YYYY, convert to YYYY-MM-DD
        const [d, m, y] = latest.date.split('-');
        const isoDate = `${y}-${m}-${d}`;
        
        // Use the new isin-based schema
        if (fund.isin) {
          db.prepare('INSERT OR REPLACE INTO nav_history (isin, nav_date, nav) VALUES (?, ?, ?)').run(fund.isin, isoDate, parseFloat(latest.nav));
          updated++;
        } else {
          throw new Error('Fund ISIN missing, cannot store in nav_history');
        }
      } else {
        throw new Error('No NAV data returned from MFAPI');
      }
    } catch (e) {
      const errorMsg = String(e);
      appendLog('nav.log', 'ERROR', `Failed to fetch NAV for ${fund.name} (${fund.id}): ${errorMsg}`);
      errors.push({ fundId: fund.id, name: fund.name, error: errorMsg });
    }
  }
  appendLog('nav.log', 'INFO', `NAV update complete: ${updated} funds updated, ${errors.length} errors`);
  res.json({ updated, errors });
});

export default router;
