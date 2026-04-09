import express from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
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

export default router;
