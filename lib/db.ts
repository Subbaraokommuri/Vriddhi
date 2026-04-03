import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { CONFIG } from './config.ts';

export const db = new Database(CONFIG.DB_NAME);

/**
 * Logging system
 */
export function log(type: 'app' | 'import' | 'benchmark', level: 'INFO' | 'WARN' | 'ERROR', module: string, message: string) {
  try {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0];
    const logDir = path.join(process.cwd(), CONFIG.LOG_DIR);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, `${type}-${dateStr}.log`);
    const logLine = `[${dateStr} ${timeStr}] [${level}] [${module}] ${message}\n`;
    fs.appendFileSync(logFile, logLine);
  } catch (err) {
    console.error('Logging failed:', err);
  }
}

/**
 * Initialize Database and run migrations
 */
export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS funds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      isin TEXT,
      scheme_code TEXT,
      amfi_code TEXT,
      category TEXT
    );

    CREATE TABLE IF NOT EXISTS folios (
      id TEXT PRIMARY KEY,
      folio_number TEXT NOT NULL,
      fund_id TEXT REFERENCES funds(id),
      pan TEXT,
      mode TEXT
    );

    CREATE TABLE IF NOT EXISTS portfolios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#01696f'
    );
  `);

  // Migration: Move data from portfolio_folios to portfolio_assets if it exists
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_folios'").get();
  if (tableExists) {
    // We need to ensure portfolio_assets exists before migrating
    // But we'll use the NEW schema for portfolio_assets
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      folio_id TEXT REFERENCES folios(id),
      date TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      amount REAL,
      units REAL,
      nav REAL,
      balance_units REAL,
      source TEXT DEFAULT 'manual'
    );

    CREATE TABLE IF NOT EXISTS nav_history (
      fund_id TEXT REFERENCES funds(id),
      date TEXT NOT NULL,
      nav REAL NOT NULL,
      PRIMARY KEY (fund_id, date)
    );

    CREATE TABLE IF NOT EXISTS benchmark_prices (
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      close REAL NOT NULL,
      source TEXT DEFAULT 'index',
      amfi_code TEXT,
      PRIMARY KEY (symbol, date)
    );

    CREATE TABLE IF NOT EXISTS user_benchmarks (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      category TEXT,
      is_active INTEGER DEFAULT 1,
      color TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // New bridge table for future assets as requested
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      asset_type TEXT NOT NULL CHECK(asset_type IN
        ('mf','equity','fd','ppf','nps','sgb','gold')),
      notes TEXT,
      added_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
    )
  `);

  // Migration for portfolio_assets if it was the old schema (composite PK)
  const paCols = db.prepare("PRAGMA table_info(portfolio_assets)").all() as any[];
  if (!paCols.find(c => c.name === 'id')) {
    log('app', 'INFO', 'DB', 'Migrating portfolio_assets to new schema');
    db.transaction(() => {
      db.exec("ALTER TABLE portfolio_assets RENAME TO portfolio_assets_old");
      db.exec(`
        CREATE TABLE portfolio_assets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          portfolio_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          asset_type TEXT NOT NULL CHECK(asset_type IN
            ('mf','equity','fd','ppf','nps','sgb','gold')),
          notes TEXT,
          added_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (portfolio_id) REFERENCES portfolios(id)
        )
      `);
      db.exec(`
        INSERT INTO portfolio_assets (portfolio_id, asset_id, asset_type)
        SELECT portfolio_id, asset_id, 
               CASE WHEN asset_type = 'mf_folio' THEN 'mf' ELSE asset_type END
        FROM portfolio_assets_old
      `);
      db.exec("DROP TABLE portfolio_assets_old");
    })();
  }

  // Migration: Move data from portfolio_folios to portfolio_assets if it exists
  if (tableExists) {
    log('app', 'INFO', 'DB', 'Migrating data from portfolio_folios to portfolio_assets');
    db.exec(`
      INSERT OR IGNORE INTO portfolio_assets (portfolio_id, asset_type, asset_id)
      SELECT portfolio_id, 'mf', folio_id FROM portfolio_folios;

      DROP TABLE IF EXISTS portfolio_folios;
    `);
  }

  // Migration for benchmark_prices columns
  const benchmarkCols = db.prepare("PRAGMA table_info(benchmark_prices)").all() as any[];
  if (!benchmarkCols.find(c => c.name === 'source')) {
    db.exec("ALTER TABLE benchmark_prices ADD COLUMN source TEXT DEFAULT 'index'");
  }
  if (!benchmarkCols.find(c => c.name === 'amfi_code')) {
    db.exec("ALTER TABLE benchmark_prices ADD COLUMN amfi_code TEXT");
  }

  // Pre-populate user_benchmarks
  const count = db.prepare('SELECT COUNT(*) as count FROM user_benchmarks').get() as any;
  if (count.count === 0) {
    const insert = db.prepare('INSERT INTO user_benchmarks (id, symbol, name, source, category, color) VALUES (?, ?, ?, ?, ?, ?)');
    CONFIG.DEFAULT_BENCHMARKS.forEach(d => insert.run(uuidv4(), d.symbol, d.name, d.source, d.category, d.color));
  }

  const logDir = path.join(process.cwd(), CONFIG.LOG_DIR);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  log('app', 'INFO', 'APP', 'Application started, database initialized');
}
