import express from 'express';
import { CONFIG } from '../lib/config.ts';
import { log } from '../lib/logger.ts';

const router = express.Router();

// Read-only list of Nifty TRI indices the user can add as benchmarks.
router.get('/catalogue', (req, res) => {
  try {
    res.json(CONFIG.NIFTY_TRI_CATALOGUE);
  } catch (error) {
    log('app', 'ERROR', 'BENCHMARK', `Failed to load benchmark catalogue: ${String(error)}`);
    res.status(500).json({ error: 'Failed to load benchmark catalogue' });
  }
});

export default router;
