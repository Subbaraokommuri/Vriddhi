import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { parse } from 'csv-parse/sync';
import { db } from '../lib/db.ts';
import { appendLog, log } from '../lib/logger.ts';
import { CONFIG } from '../lib/config.ts';

const router = express.Router();

function sanitizeFolio(raw: string | number | undefined): string {
  if (!raw) return '';
  const s = String(raw).trim();
  // Handle scientific notation: "5.9935E+11" or "5.9935e+11"
  if (/e[+-]?\d+$/i.test(s)) {
    return BigInt(Math.round(Number(s))).toString();
  }
  return s;
}

router.post('/import-cas', (req, res) => {
  const { csvData } = req.body;
  let added = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const records = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    const insertFund = db.prepare('INSERT OR IGNORE INTO funds (id, name, isin, scheme_code) VALUES (?, ?, ?, ?)');
    const insertFolio = db.prepare('INSERT OR IGNORE INTO folios (id, folio_number, fund_id, investor_name, pan_number) VALUES (?, ?, ?, ?, ?)');
    const insertTxn = db.prepare(`
      INSERT INTO transactions (id, folio_id, date, transaction_type, amount, units, nav, balance_units, source)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'cas_import'
      WHERE NOT EXISTS (
        SELECT 1 FROM transactions 
        WHERE folio_id = ? AND date = ? AND amount = ? AND units = ? AND transaction_type = ? AND balance_units = ?
      )
    `);

    const convertDate = (dateStr: string) => {
      if (!dateStr) return '';
      if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return dateStr;
      
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = CONFIG.MONTH_MAP[parts[1].toLowerCase()];
        let year = parseInt(parts[2]);
        if (parts[2].length === 2) {
          year += year <= 30 ? 2000 : 1900;
        }
        if (month) return `${year}-${month}-${day}`;
      }
      return dateStr;
    };

    for (const rawRow of records as any[]) {
      try {
        const row = {
          folio_num: rawRow.folio_num || rawRow.Folio,
          isin: rawRow.isin || rawRow.ISIN,
          fund_name: rawRow.fund_name || rawRow.Fund_name || rawRow.Fund_Name,
          date: rawRow.date || rawRow.Date,
          transaction_type: rawRow.transaction_type || rawRow.Description,
          amount: rawRow.amount || rawRow.Amount,
          units: rawRow.units || rawRow.Units,
          nav: rawRow.nav || rawRow.Price,
          balance_units: rawRow.balance_units || rawRow.Unit_balance || rawRow.Unit_Balance,
          scheme_code: rawRow.scheme_code,
          investor_name: rawRow.Investor_Name || rawRow.investor_name || '',
          pan_number: rawRow.PAN_Number || rawRow.pan_number || '',
        };

        const cleanFolio = sanitizeFolio(row.folio_num);
        const rawIsin = (row.isin || '').trim();
        const cleanIsin = rawIsin.split(/[\s-]/)[0].trim();
        const finalIsin = cleanIsin.length === 12 ? cleanIsin : null;

        if (!row.fund_name || !row.date) continue;

        if (!finalIsin) {
          appendLog('import.log', 'WARN', `Missing/invalid ISIN for fund: ${row.fund_name}, folio: ${cleanFolio}`);
        }

        const fundId = finalIsin ?? row.fund_name;
        insertFund.run(fundId, row.fund_name, finalIsin, row.scheme_code || null);

        const folioId = `${cleanFolio}_${fundId}`;
        insertFolio.run(folioId, cleanFolio, fundId, row.investor_name, row.pan_number);

        const isoDate = convertDate(row.date);
        
        let amount = parseFloat(row.amount || '0');
        let units = parseFloat(row.units || '0');
        const nav = parseFloat(row.nav || '0');
        const balanceUnits = parseFloat(row.balance_units || '0');

        let type = 'buy';
        const rawType = (row.transaction_type || '').toLowerCase();
        
        if (amount < 0 || units < 0 || rawType.includes('redemption') || rawType.includes('switch out') || rawType.includes('swp') || rawType.includes('stp out')) {
          type = 'sell';
          amount = Math.abs(amount);
          units = Math.abs(units);
        } else if (rawType.includes('dividend')) {
          type = 'dividend';
        }

        const result = insertTxn.run(
          uuidv4(), folioId, isoDate, type, amount, units, nav, balanceUnits,
          folioId, isoDate, amount, units, type, balanceUnits
        );

        if (result.changes > 0) {
          added++;
          appendLog('import.log', 'INFO', `Processed: folio ${cleanFolio}, fund ${row.fund_name}, date ${isoDate}, amount ${amount}`);
        } else {
          skipped++;
          appendLog('import.log', 'INFO', `Skipped duplicate: folio ${cleanFolio}, date ${isoDate}, amount ${amount}`);
        }

        if (nav > 0 && isoDate && finalIsin) {
          db.prepare('INSERT OR REPLACE INTO nav_history (isin, nav_date, nav) VALUES (?, ?, ?)').run(finalIsin, isoDate, nav);
        }
      } catch (rowError) {
        const errorMsg = rowError instanceof Error ? rowError.message : String(rowError);
        appendLog('import.log', 'ERROR', `Row ${records.indexOf(rawRow) + 1} failed: ${errorMsg}`);
        errors++;
      }
    }
    
    appendLog('import.log', 'INFO', `Complete: ${added} added, ${skipped} skipped, ${errors} errors`);
    res.json({ added, skipped, errors });
  } catch (parseError) {
    appendLog('import.log', 'ERROR', `CSV Parse Error: ${String(parseError)}`);
    res.status(400).json({ error: 'Failed to parse CSV data' });
  }
});

router.get('/transactions/export-csv', (req, res) => {
  try {
    const { dateFrom, dateTo, type, fundId, folio, amountMin, amountMax } = req.query;

    const appliedFilters: Record<string, any> = {};
    if (dateFrom) appliedFilters.dateFrom = dateFrom;
    if (dateTo) appliedFilters.dateTo = dateTo;
    if (type) appliedFilters.type = type;
    if (fundId) appliedFilters.fundId = fundId;
    if (folio) appliedFilters.folio = folio;
    if (amountMin) appliedFilters.amountMin = Number(amountMin);
    if (amountMax) appliedFilters.amountMax = Number(amountMax);

    let query = `
      SELECT
        t.date,
        COALESCE(fu.fund_house, '')        AS fund_house,
        fu.name                            AS fund_name,
        COALESCE(fu.isin, '')              AS isin,
        COALESCE(fu.amfi_code, '')         AS amfi_code,
        f.folio_number,
        f.investor_name,
        f.pan,
        COALESCE(fu.asset_class, '')       AS asset_class,
        COALESCE(fu.plan, '')              AS plan,
        t.transaction_type,
        ABS(t.amount)                      AS amount,
        ABS(t.units)                       AS units,
        t.nav,
        ABS(t.balance_units)               AS balance_units,
        COALESCE(t.description, '')        AS description,
        COALESCE(t.source, '')             AS source
      FROM transactions t
      JOIN folios f ON t.folio_id = f.id
      JOIN funds fu ON f.fund_id = fu.id
      WHERE 1=1
    `;

    const params: any[] = [];

    if (dateFrom) {
      query += ' AND t.date >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ' AND t.date <= ?';
      params.push(dateTo);
    }
    if (type === 'buy' || type === 'sell') {
      query += ' AND t.transaction_type = ?';
      params.push(type);
    }
    if (fundId) {
      query += ' AND f.fund_id = ?';
      params.push(fundId);
    }
    if (folio) {
      query += ' AND f.folio_number LIKE ?';
      params.push(`%${folio}%`);
    }
    if (amountMin) {
      query += ' AND ABS(t.amount) >= ?';
      params.push(Number(amountMin));
    }
    if (amountMax) {
      query += ' AND ABS(t.amount) <= ?';
      params.push(Number(amountMax));
    }

    query += ' ORDER BY t.date DESC, fu.name ASC, f.folio_number ASC';

    const rows = db.prepare(query).all(...params) as Array<{
      date: string;
      fund_house: string;
      fund_name: string;
      isin: string;
      amfi_code: string;
      folio_number: string;
      investor_name: string;
      pan: string | null;
      asset_class: string;
      plan: string;
      transaction_type: string;
      amount: number;
      units: number;
      nav: number;
      balance_units: number;
      description: string;
      source: string;
    }>;

    // CSV format function that handles escaping
    const escapeCsv = (val: string | null | undefined) => {
      if (val === null || val === undefined) return '';
      const s = String(val);
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const formatNum = (num: number | null | undefined) => {
      if (num === null || num === undefined || isNaN(num)) return '0.0000';
      return num.toFixed(4);
    };

    const headers = [
      'Date', 'Fund House', 'Fund Name', 'ISIN', 'AMFI Code', 'Folio Number', 'Investor Name',
      'PAN', 'Asset Class', 'Plan', 'Type', 'Amount (Rs)', 'Units', 'NAV', 'Balance Units',
      'Description', 'Source'
    ];
    const csvRows = [headers.join(',')];

    for (const r of rows) {
      const line = [
        escapeCsv(r.date),
        escapeCsv(r.fund_house),
        escapeCsv(r.fund_name),
        escapeCsv(r.isin),
        escapeCsv(r.amfi_code),
        escapeCsv(r.folio_number),
        escapeCsv(r.investor_name),
        escapeCsv(r.pan),
        escapeCsv(r.asset_class),
        escapeCsv(r.plan),
        escapeCsv(r.transaction_type),
        formatNum(r.amount),
        formatNum(r.units),
        formatNum(r.nav),
        formatNum(r.balance_units),
        escapeCsv(r.description),
        escapeCsv(r.source)
      ];
      csvRows.push(line.join(','));
    }

    const csvContent = csvRows.join('\r\n');
    const todayStr = new Date().toISOString().split('T')[0];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="vriddhi-transactions-${todayStr}.csv"`);
    res.send(csvContent);

    log('app', 'INFO', 'TXN-EXPORT', `Exported ${rows.length} transactions (filters: ${JSON.stringify(appliedFilters)})`);
  } catch (err: any) {
    log('app', 'ERROR', 'TXN-EXPORT', `Export failed: ${err.message}`);
    res.status(500).json({ error: 'Export failed' });
  }
});

router.get('/transactions', (req, res) => {
  try {
    const { dateFrom, dateTo, type, fundId, folio, amountMin, amountMax } = req.query;
    
    let query = `
      SELECT t.*, f.folio_number, fu.name as fund_name, fu.clean_name, fu.simple_name
      FROM transactions t
      JOIN folios f ON t.folio_id = f.id
      JOIN funds fu ON f.fund_id = fu.id
      WHERE 1=1
    `;
    
    const params: any[] = [];

    if (dateFrom) {
      query += ' AND t.date >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      query += ' AND t.date <= ?';
      params.push(dateTo);
    }
    if (type === 'buy' || type === 'sell') {
      query += ' AND t.transaction_type = ?';
      params.push(type);
    }
    if (fundId) {
      query += ' AND f.fund_id = ?';
      params.push(fundId);
    }
    if (folio) {
      query += ' AND f.folio_number LIKE ?';
      params.push(`%${folio}%`);
    }
    if (amountMin) {
      query += ' AND ABS(t.amount) >= ?';
      params.push(Number(amountMin));
    }
    if (amountMax) {
      query += ' AND ABS(t.amount) <= ?';
      params.push(Number(amountMax));
    }

    query += ' ORDER BY t.date DESC';
    
    const txns = db.prepare(query).all(...params);
    res.json(txns);
  } catch (err: any) {
    appendLog('app.log', 'ERROR', `transactions: ${err.message}`);
    res.status(500).json({ error: 'Failed to load transactions' });
  }
});

router.get('/transactions/funds-list', (req, res) => {
  try {
    const fundsList = db.prepare(`
      SELECT DISTINCT fu.id, fu.name, fu.clean_name, fu.simple_name 
      FROM funds fu 
      JOIN folios f ON f.fund_id = fu.id 
      JOIN transactions t ON t.folio_id = f.id 
      ORDER BY fu.name
    `).all();
    res.json({ funds: fundsList });
  } catch (err: any) {
    appendLog('app.log', 'ERROR', `transactions-funds-list: ${err.message}`);
    res.status(500).json({ error: 'Failed to load funds list' });
  }
});

export default router;
