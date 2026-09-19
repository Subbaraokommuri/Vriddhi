import express from 'express';
import { db } from '../lib/db.ts';
import { log } from '../lib/logger.ts';
import { CONFIG } from '../lib/config.ts';

const router = express.Router();

function deriveSimpleName(cleanName: string): string {
  if (!cleanName) return '';
  let s = cleanName.trim();
  // Remove parenthetical qualifiers
  s = s.replace(/\s*\(\s*(?:erstwhile|formerly\s+known\s+as|direct)\b[^)]*\)/gi, '');
  // Strip from first dash + plan/option keyword
  s = s.replace(/\s*-+\s*(?:direct|regular|eco|growth|idcw|cumulative|payout)\b.*$/gi, '');
  // Strip space-separated plan/option without dash
  s = s.replace(/\s+(?:direct|regular)\s+(?:plan|growth).*$/gi, '');
  // Cleanup trailing dashes and whitespace
  s = s.replace(/[-–\s]+$/, '').trim();
  return s;
}

/**
 * Shared function to refresh the ISIN -> AMFI scheme-code map from NAVAll.txt.
 * Only reads SchemeCode/ISINGrowth/ISINReinvest (parts[0..2]) — these are
 * stable regardless of AMFI's trailing column layout (NAV/Date/Plan/Option
 * have shifted before and will again; per-fund NAV/history comes from
 * MFAPI via runNavBackfill() instead, never from this parse).
 */
export async function refreshAmfiCodes() {
  let updated = 0;
  let notFound = 0;
  const failed: { name: string; isin: string; reason: string }[] = [];
  const isinMap = new Map<string, any>();

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
      // Format: SchemeCode;ISINGrowth;ISINReinvest;... (trailing columns vary by era, unused here)
      if (parts.length >= 3) {
        const schemeCode = parts[0];
        const isinGrowth = parts[1];
        const isinReinvest = parts[2];

        if (schemeCode && (isinGrowth || isinReinvest)) {
          const data = { schemeCode };
          if (isinGrowth && isinGrowth !== '-') isinMap.set(isinGrowth, data);
          if (isinReinvest && isinReinvest !== '-') isinMap.set(isinReinvest, data);
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
        log('nav', 'INFO', 'NAV', `Updated ${fund.name} (${fund.isin}): amfi_code=${match.schemeCode}`);
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

/**
 * Incremental NAV history + metadata sync via MFAPI, per fund with an amfi_code.
 * Skips any fund whose last NAV is <=1 day old and already has clean_name/simple_name.
 */
export async function runNavBackfill() {
  const funds = db.prepare(`
    SELECT f.id, f.name, f.isin, f.amfi_code, f.nav_history_fetched,
           f.clean_name, f.simple_name,
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
        
        if (gap <= 1 && fund.clean_name && fund.simple_name) {
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

        // Metadata update block
        let assetClass = '';
        let schemeSubCat = '';
        if (data.meta?.scheme_category) {
          const rawCat = data.meta.scheme_category.trim();
          const parts = rawCat.split(' - ');
          if (parts.length > 0) {
            assetClass = parts[0].replace(/ Scheme\s*$/i, '').trim();
          }
          if (parts.length > 1) {
            schemeSubCat = parts.slice(1).join(' - ').trim();
          }
        }

        db.prepare(`
          UPDATE funds SET
            fund_house      = COALESCE(NULLIF(fund_house, ''),      ?),
            scheme_type     = COALESCE(NULLIF(scheme_type, ''),     ?),
            scheme_sub_cat  = COALESCE(NULLIF(scheme_sub_cat, ''),  ?),
            asset_class     = COALESCE(NULLIF(asset_class, ''),     ?),
            isin_idcw       = COALESCE(NULLIF(isin_idcw, ''),       ?),
            clean_name      = COALESCE(NULLIF(clean_name, ''),      ?),
            scheme_category = COALESCE(NULLIF(scheme_category, ''), ?),
            isin            = COALESCE(NULLIF(isin, ''),            ?),
            simple_name     = COALESCE(NULLIF(simple_name, ''),     ?)
          WHERE id = ?
        `).run(
          data.meta?.fund_house        ?? '',
          data.meta?.scheme_type       ?? '',
          schemeSubCat,
          assetClass,
          data.meta?.isin_div_reinvestment ?? '',
          data.meta?.scheme_name       ?? '',
          data.meta?.scheme_category   ?? '',
          data.meta?.isin_growth       ?? '',
          deriveSimpleName(data.meta?.scheme_name ?? ''),
          fund.id
        );

        log('nav', 'INFO', 'BACKFILL',
          `Metadata ${fund.name}: house=${data.meta?.fund_house ?? ''} ` +
          `asset_class=${assetClass} category=${schemeSubCat}`
        );

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
  return { full_backfill, incremental, up_to_date, failed };
}

/**
 * Tops up NAV history for mf_nav benchmarks. runNavBackfill only covers funds in the funds
 * table (funds you hold), so a benchmark fund you don't hold would never refresh. Rows are
 * stored under the benchmark's amfi_code — the key relative-performance and
 * folios-benchmark-xirr read. Per-benchmark failures are collected, never thrown.
 */
export async function refreshMfBenchmarks() {
  const benchmarks = db.prepare(`
    SELECT id, name, amfi_code FROM user_benchmarks
    WHERE benchmark_type = 'mf_nav' AND amfi_code IS NOT NULL AND amfi_code != ''
  `).all() as { id: string; name: string; amfi_code: string }[];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const insert = db.prepare('INSERT OR IGNORE INTO nav_history (isin, nav_date, nav) VALUES (?, ?, ?)');
  let updated = 0;
  let upToDate = 0;
  let rowsAdded = 0;
  const failed: { name: string; reason: string }[] = [];

  for (const b of benchmarks) {
    try {
      const last = db.prepare('SELECT MAX(nav_date) AS d FROM nav_history WHERE isin = ?').get(b.amfi_code) as { d: string | null };
      if (last?.d) {
        const lastDate = new Date(last.d);
        lastDate.setHours(0, 0, 0, 0);
        const gap = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        if (gap <= 1) {
          upToDate++;
          continue;
        }
      }

      const response = await fetch(`https://api.mfapi.in/mf/${b.amfi_code}`);
      if (!response.ok) throw new Error(`MFAPI request failed: ${response.statusText}`);
      const data = await response.json() as any;
      if (!data?.data || !Array.isArray(data.data)) throw new Error('Invalid NAV data received from MFAPI');
      if (data.data.length === 0) throw new Error(`No NAV data found for AMFI code ${b.amfi_code}`);

      let inserted = 0;
      db.transaction((items: any[]) => {
        for (const item of items) {
          const parts = String(item?.date ?? '').split('-'); // DD-MM-YYYY
          const nav = parseFloat(item?.nav);
          if (parts.length !== 3 || !Number.isFinite(nav)) continue;
          const r = insert.run(b.amfi_code, `${parts[2]}-${parts[1]}-${parts[0]}`, nav);
          if (r.changes > 0) inserted++;
        }
      })(data.data);

      rowsAdded += inserted;
      if (inserted > 0) updated++; else upToDate++;
      log('nav', 'INFO', 'BENCHMARK-REFRESH', `${b.name} (${b.amfi_code}): ${inserted} new NAV rows`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push({ name: b.name, reason });
      log('nav', 'ERROR', 'BENCHMARK-REFRESH', `${b.name} (${b.amfi_code}): ${reason}`);
    }
  }

  return { total: benchmarks.length, updated, upToDate, rowsAdded, failed };
}

/**
 * Unified NAV sync: refreshes the ISIN -> amfi_code map only for funds that
 * don't have one yet (new funds from a CAS import), then runs the
 * incremental MFAPI backfill for everything — this is what fills today's
 * NAV, history, and metadata in one pass. Backs both the "Update NAVs"
 * button (FundsXirr.tsx) and "Sync Fund Data" (CasImport.tsx), plus the
 * auto-sync fired after a successful CAS import.
 */
export async function syncNavData() {
  const missing = db.prepare(`
    SELECT COUNT(*) as c FROM funds WHERE isin IS NOT NULL AND (amfi_code IS NULL OR amfi_code = '')
  `).get() as { c: number };

  let amfi: { updated: number; notFound: number; failed: { name: string; isin: string; reason: string }[] } =
    { updated: 0, notFound: 0, failed: [] };

  if (missing.c > 0) {
    log('nav', 'INFO', 'SYNC', `${missing.c} fund(s) missing amfi_code — refreshing ISIN map from AMFI`);
    amfi = await refreshAmfiCodes();
  }

  const backfill = await runNavBackfill();

  // MF benchmarks may be funds you don't hold — top them up too. Never fails the sync.
  let benchmarks: Awaited<ReturnType<typeof refreshMfBenchmarks>> | null = null;
  try {
    benchmarks = await refreshMfBenchmarks();
  } catch (err) {
    log('nav', 'ERROR', 'SYNC', `MF benchmark refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { amfi, backfill, benchmarks };
}

router.post('/nav/sync', async (req, res) => {
  try {
    const result = await syncNavData();
    res.json(result);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log('nav', 'ERROR', 'SYNC', `nav/sync failed: ${reason}`);
    res.status(503).json({ error: 'Failed to sync NAV data' });
  }
});

router.post('/nav/refresh-benchmarks', async (req, res) => {
  try {
    res.json(await refreshMfBenchmarks());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log('nav', 'ERROR', 'BENCHMARK-REFRESH', `nav/refresh-benchmarks failed: ${reason}`);
    res.status(500).json({ error: 'Failed to refresh MF benchmarks' });
  }
});

export default router;
