import express from 'express';
import { db } from '../lib/db.ts';
import { log } from '../lib/logger.ts';

const router = express.Router();

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
    log('app', 'ERROR', 'TRANSACTIONS', err.message);
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
    log('app', 'ERROR', 'TRANSACTIONS', `funds-list: ${err.message}`);
    res.status(500).json({ error: 'Failed to load funds list' });
  }
});

export default router;
