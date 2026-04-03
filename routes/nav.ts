import express from 'express';
import { db, log } from '../lib/db.ts';
import { CONFIG } from '../lib/config.ts';

const router = express.Router();

router.post('/fetch-nav', async (req, res) => {
  const funds = db.prepare('SELECT id, amfi_code FROM funds WHERE amfi_code IS NOT NULL').all() as any[];
  let updated = 0;

  for (const fund of funds) {
    try {
      const response = await fetch(`${CONFIG.APIS.MF_DATA}${fund.amfi_code}`);
      const data = await response.json() as any;
      if (data && data.data && data.data.length > 0) {
        const latest = data.data[0];
        // Date format in mfapi is DD-MM-YYYY, convert to YYYY-MM-DD
        const [d, m, y] = latest.date.split('-');
        const isoDate = `${y}-${m}-${d}`;
        db.prepare('INSERT OR REPLACE INTO nav_history (fund_id, date, nav) VALUES (?, ?, ?)').run(fund.id, isoDate, parseFloat(latest.nav));
        updated++;
      }
    } catch (e) {
      log('app', 'ERROR', 'NAV', `Failed to fetch NAV for ${fund.id}: ${String(e)}`);
      console.error(`Failed to fetch NAV for ${fund.id}`, e);
    }
  }
  log('app', 'INFO', 'NAV', `NAV update complete: ${updated} funds updated`);
  res.json({ updated });
});

export default router;
