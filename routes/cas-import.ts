  import express from 'express';
  import multer from 'multer';
  import * as fs from 'fs';
  import * as os from 'os';
  import * as path from 'path';
  import { v4 as uuidv4 } from 'uuid';
  import { db } from '../lib/db';
  import { parseCasPdf } from '../lib/cas-parser';
  import { generateHtml } from '../lib/cas-reconcile-html';
  import { runChecks } from '../lib/cas-reconcile';

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
      const ok = results.every(r => r.failures.length === 0);

      res.json({
        html,
        stats: data.stats,
        ok
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
      const import_id = uuidv4();

      db.transaction(() => {
        // STEP 0 — Upsert investor
        const upsertInvestor = db.prepare(`
          INSERT INTO investors (pan, name, email, mobile, kyc_ok, updated_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(pan) DO UPDATE SET
            name=excluded.name, email=excluded.email,
            mobile=excluded.mobile, updated_at=excluded.updated_at
        `);

        // We use the first folio's PAN for the investor upsert as per instructions
        // (data.investor is a single object for the whole CAS)
        if (data.folios.length > 0) {
          upsertInvestor.run(
            data.folios[0].pan,
            data.investor.name,
            data.investor.email,
            data.investor.mobile,
            data.folios[0].kyc_ok ? 1 : 0
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
                INSERT INTO folios (id, folio_number, fund_id, pan, investor_name, pan_number, kyc_ok, mode)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'cas')
              `).run(
                folio_id,
                folio.folio_full,
                fund_id,
                folio.pan,
                folio.investor_name,
                folio.pan,
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
                nav, balance_units, description, source)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'cas')
            `);

            for (const txn of scheme.transactions) {
              const result = insertTxn.run(
                uuidv4(),
                folio_id,
                txn.date,
                txn.type,
                txn.amount,
                txn.units,
                txn.nav,
                txn.balance,
                txn.description
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

      res.json({
        message: "Import complete",
        new_transactions,
        skipped_transactions,
        schemes_updated,
        import_id
      });

    } catch (err: any) {
      const msg = err.message || String(err);
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
