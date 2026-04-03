import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import fs from 'fs';
import { CONFIG } from './lib/config.ts';
import { db, initDb, log } from './lib/db.ts';
import { xirr, calcMirrorXirr } from './lib/xirr.ts';
import fundsRouter from './routes/funds.ts';
import transactionsRouter from './routes/transactions.ts';
import navRouter from './routes/nav.ts';
import portfoliosRouter from './routes/portfolios.ts';
import benchmarksRouter from './routes/benchmarks.ts';
import reportsRouter from './routes/reports.ts';
import xirrRouter from './routes/xirr.ts';
import logsRouter from './routes/logs.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initDb();

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api', fundsRouter);
  app.use('/api', transactionsRouter);
  app.use('/api', navRouter);
  app.use('/api', portfoliosRouter);
  app.use('/api', benchmarksRouter);
  app.use('/api', reportsRouter);
  app.use('/api', xirrRouter);
  app.use('/api', logsRouter);

  // Vite setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(3000, '0.0.0.0', () => {
    console.log('Server running on http://localhost:3000');
  });
}

startServer();
