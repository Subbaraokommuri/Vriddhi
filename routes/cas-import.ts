import express from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../lib/db.ts';
import { parseCasPdf } from '../lib/cas-parser.ts';
import { generateHtml } from '../lib/cas-reconcile-html.ts';
import { runChecks } from '../lib/cas-reconcile.ts';
import { log } from '../lib/logger.ts';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    cb(null, isPdf);
  }
});

router.post('/preview', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No PDF file uploaded." });
  }

  const password = req.body.password || "";
  const tempPath = path.join(os.tmpdir(), `cas-${uuidv4()}.pdf`);

  try {
    // Write buffer to temp file
    fs.writeFileSync(tempPath, req.file.buffer);

    // Parse PDF
    const data = await parseCasPdf(tempPath, password);

    // Generate HTML and checks
    const html = generateHtml(data);
    const { results } = runChecks(data);
    
    const HARD_ERROR_CHECKS = [
      'Unit Balance Match',
      'Running Balance Continuity',
      'No Negative Mid-Series Balance',
      'No Missing Fields',
    ];

    const WARNING_CHECKS = [
      'ISIN Format Validation',
      'No Zero NAV',
      'Cost Value Cross-check',
    ];

    const ok = results
      .filter(r => HARD_ERROR_CHECKS.includes(r.name))
      .every(r => r.failures.length === 0);

    const warningCount = results
      .filter(r => WARNING_CHECKS.includes(r.name))
      .reduce((acc, r) => acc + r.failures.length, 0);

    res.json({
      html,
      stats: data.stats,
      ok,
      warningCount
    });

  } catch (err: any) {
    const msg = err.message || String(err);
    
    if (msg.toLowerCase().includes("incorrect password")) {
      return res.status(401).json({ error: "Wrong password. Please try again." });
    }
    
    if (msg.toLowerCase().includes("pdftotext not found") || msg.toLowerCase().includes("pdftotext: not found")) {
      return res.status(500).json({ error: "pdftotext not found. Run: brew install poppler" });
    }

    res.status(500).json({ error: `Parse failed: ${msg}` });
  } finally {
    // Cleanup
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch (e) {
        console.error("Failed to delete temp file:", tempPath, e);
      }
    }
  }
});

router.post('/confirm', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No PDF file uploaded." });
  }

  const password = req.body.password || "";
  const tempPath = path.join(os.tmpdir(), `cas-confirm-${uuidv4()}.pdf`);

  try {
    fs.writeFileSync(tempPath, req.file.buffer);
    const data = await parseCasPdf(tempPath, password);

    let new_transactions = 0;
    let skipped_transactions = 0;
    let schemes_updated = 0;
    let zero_unit_transactions = 0;
    const import_id = uuidv4();

    const WARNING_CHECKS_LOG = [
      'ISIN Format Validation',
      'No Zero NAV',
      'Cost Value Cross-check',
    ];
    const { results: checkResults } = runChecks(data);
    const warnDetails = [
      { key: 'ISIN',    name: 'ISIN Format Validation' },
      { key: 'ZeroNAV', name: 'No Zero NAV' },
      { key: 'Cost',    name: 'Cost Value Cross-check' },
    ].map(({ key, name }) => {
      const c = checkResults.find(r => r.name === name);
      return `${key}:${c?.failures.length ?? 0}`;
    }).join(', ');
    const totalWarnings = checkResults
      .filter(r => WARNING_CHECKS_LOG.includes(r.name))
      .reduce((acc, r) => acc + r.failures.length, 0);

    log('import', 'INFO', 'CAS-IMPORT',
      `START import: investor=${data.investor.name}, ` +
      `period=${data.cas_period.from}→${data.cas_period.to}, ` +
      `folios=${data.folios.length}, ` +
      `schemes=${data.stats.total_schemes}, ` +
      `transactions=${data.stats.total_transactions}, ` +
      `warnings=${totalWarnings} (${warnDetails})`);

    db.transaction(() => {
      // STEP 0 — Upsert investor
      const upsertInvestor = db.prepare(`
        INSERT INTO investors (pan, name, email, mobile, kyc_ok, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(pan) DO UPDATE SET
          name=excluded.name, email=excluded.email,
          mobile=excluded.mobile, updated_at=excluded.updated_at
      `);

      const existingTxnKeys = new Set<string>(
        db.prepare(`
          SELECT folio_id || '|' || date || '|' || transaction_type || '|' ||
                 COALESCE(CAST(ROUND(amount * 100) AS INTEGER), 0) || '|' ||
                 COALESCE(CAST(ROUND(units * 10000) AS INTEGER), 0) AS key
          FROM transactions
        `).all().map((r: any) => r.key)
      );

      // Collect unique pan → investor_name pairs across all folios
      const uniquePans = new Map<string, string>();
      for (const folio of data.folios) {
        if (folio.pan && !uniquePans.has(folio.pan)) {
          uniquePans.set(
            folio.pan,
            folio.investor_name?.trim() || data.investor.name || ''
          );
        }
      }

      // Register every unique PAN in the investors table
      for (const [pan, investorName] of uniquePans) {
        upsertInvestor.run(
          pan,
          investorName,
          data.investor.email  || '',
          data.investor.mobile || '',
          1   // kyc_ok — treat all PANs in a consolidated CAS as KYC verified
        );
      }

      for (const folio of data.folios) {
        for (const scheme of folio.schemes) {
          schemes_updated++;

          // STEP A — Upsert fund
          let fund = db.prepare("SELECT id FROM funds WHERE isin = ?").get(scheme.isin) as any;
          let fund_id: string;

          if (!fund) {
            fund_id = uuidv4();
            db.prepare(`
              INSERT INTO funds (id, name, isin, plan, fund_option, registrar, category)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              fund_id,
              scheme.fund_name,
              scheme.isin,
              scheme.plan || 'Unknown',
              scheme.option || 'Unknown',
              folio.registrar || '',
              'Unknown'
            );
          } else {
            fund_id = fund.id;
            db.prepare(`
              UPDATE funds SET plan = ?, fund_option = ?, registrar = ? WHERE id = ?
            `).run(scheme.plan || 'Unknown', scheme.option || 'Unknown', folio.registrar || '', fund_id);
          }

          // STEP B — Upsert folio
          let dbFolio = db.prepare("SELECT id FROM folios WHERE folio_number = ? AND fund_id = ?")
            .get(folio.folio_full, fund_id) as any;
          let folio_id: string;

          if (!dbFolio) {
            folio_id = uuidv4();
            db.prepare(`
              INSERT INTO folios (id, folio_number, fund_id, pan, investor_name, kyc_ok, mode)
              VALUES (?, ?, ?, ?, ?, ?, 'cas')
            `).run(
              folio_id,
              folio.folio_full,
              fund_id,
              folio.pan,
              folio.investor_name,
              folio.kyc_ok ? 1 : 0
            );
          } else {
            folio_id = dbFolio.id;
            db.prepare(`
              UPDATE folios SET investor_name = ?, kyc_ok = ? WHERE id = ?
            `).run(folio.investor_name, folio.kyc_ok ? 1 : 0, folio_id);
          }

          // Always update stated values
          db.prepare(`
            UPDATE folios SET 
              stated_balance = ?, 
              stated_cost = ?, 
              stated_market_value = ?, 
              cas_updated_at = datetime('now')
            WHERE id = ?
          `).run(scheme.stated_balance, scheme.stated_cost, scheme.stated_market_value, folio_id);

          // STEP C — Insert transactions
          const insertTxn = db.prepare(`
            INSERT OR IGNORE INTO transactions
              (id, folio_id, date, transaction_type, amount, units,
              nav, balance_units, description, source,
              transaction_subtype, merger_ratio, source_fund_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'cas', ?, ?, ?)
          `);

          for (const txn of scheme.transactions) {
            // Skip zero-unit administrative transactions (folio consolidations,
            // recovery payouts). These carry no financial information.
            if ((txn.units || 0) === 0) {
              zero_unit_transactions++;
              continue;
            }

            const crossKey = `${folio_id}|${txn.date}|${txn.type}|${Math.round((txn.amount || 0) * 100)}|${Math.round((txn.units || 0) * 10000)}`;
            if (existingTxnKeys.has(crossKey)) {
              skipped_transactions++;
              continue;
            }

            let source_fund_id: string | null = null;
            if (txn.source_isin) {
              const sourceRow = db.prepare('SELECT id FROM funds WHERE isin = ?')
                                  .get(txn.source_isin) as { id: string } | undefined;
              source_fund_id = sourceRow ? sourceRow.id : null;
              if (!sourceRow) {
                log('import', 'WARN', 'cas-import',
                    `merger source fund not found for ISIN ${txn.source_isin} — source_fund_id set to null`);
              }
            }

            const result = insertTxn.run(
              uuidv4(),
              folio_id,
              txn.date,
              txn.type,
              txn.amount,
              txn.units,
              txn.nav,
              txn.balance,
              txn.description,
              txn.transaction_subtype ?? '',
              txn.merger_ratio ?? null,
              source_fund_id
            );

            if (result.changes === 1) {
              new_transactions++;
            } else {
              skipped_transactions++;
            }
          }
        }
      }

      // After transaction completes: INSERT into cas_imports
      db.prepare(`
        INSERT INTO cas_imports (
          id, period_from, period_to, investor_name,
          total_folios, total_schemes, total_transactions,
          new_transactions, skipped_transactions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        import_id,
        data.cas_period.from,
        data.cas_period.to,
        data.investor.name,
        data.stats.total_folios,
        data.stats.total_schemes,
        data.stats.total_transactions,
        new_transactions,
        skipped_transactions
      );
    })();
    
    log('import', 'INFO', 'CAS-IMPORT',
      `COMPLETE import: new=${new_transactions}, ` +
      `skipped=${skipped_transactions}, ` +
      `zero_unit=${zero_unit_transactions}, ` +
      `schemes=${schemes_updated}, import_id=${import_id}`);

    res.json({
      message: "Import complete",
      new_transactions,
      skipped_transactions,
      zero_unit_transactions,
      schemes_updated,
      import_id,
      portfolio_id: 'default'
    });

  } catch (err: any) {
    const msg = err.message || String(err);
    log('import', 'ERROR', 'CAS-IMPORT', `Import failed: ${msg}`);
    if (msg.toLowerCase().includes("incorrect password")) {
      return res.status(401).json({ error: "Wrong password. Please try again." });
    }
    if (msg.toLowerCase().includes("pdftotext not found") || msg.toLowerCase().includes("pdftotext: not found")) {
      return res.status(500).json({ error: "pdftotext not found. Run: brew install poppler" });
    }
    res.status(500).json({ error: `Import failed: ${msg}` });
  } finally {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (e) {}
    }
  }
});

export default router;

