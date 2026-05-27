import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

router.get('/logs', (req, res) => {
  const { type, date, download } = req.query as { type: string, date: string, download?: string };
  if (!type || !date) return res.status(400).send('Missing type or date');
  const logFile = path.join(process.cwd(), 'logs', `${type}-${date}.log`);
  if (fs.existsSync(logFile)) {
    const content = fs.readFileSync(logFile, 'utf8');
    res.header('Content-Type', 'text/plain');
    if (download === 'true') {
      res.header('Content-Disposition', `attachment; filename="${type}-${date}.log"`);
    }
    res.send(content);
  } else {
    res.status(404).send('Log file not found');
  }
});

export default router;
