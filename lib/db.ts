import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { CONFIG } from './config.ts';

export const db = new Database(CONFIG.DB_NAME);

/**
 * Logging system (Legacy)
 */
export function log(type: 'app' | 'import' | 'benchmark' | 'nav', level: 'INFO' | 'WARN' | 'ERROR', module: string, message: string) {
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
 * Standard logger
 */
export function appendLog(filename: string, level: string, message: string) {
  try {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0];
    const logDir = path.join(process.cwd(), CONFIG.LOG_DIR);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, filename);
    const logLine = `[${dateStr} ${timeStr}] [${level}] ${message}\n`;
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

  // NEW MIGRATIONS
  db.exec(`
    CREATE TABLE IF NOT EXISTS benchmark_history (
      index_name TEXT NOT NULL,
      price_date TEXT NOT NULL,
      value      REAL NOT NULL,
      PRIMARY KEY (index_name, price_date)
    );
    CREATE INDEX IF NOT EXISTS idx_benchmark_date ON benchmark_history(index_name, price_date);
  `);

  // Check if nav_history needs to be migrated to the isin-based schema
  const navHistoryCols = db.prepare("PRAGMA table_info(nav_history)").all() as any[];
  if (navHistoryCols.length > 0 && !navHistoryCols.find(c => c.name === 'isin')) {
    // Table exists but with old schema (fund_id). Rename it to avoid conflict.
    db.exec("ALTER TABLE nav_history RENAME TO nav_history_v1");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS nav_history (
      isin      TEXT NOT NULL,
      nav_date  TEXT NOT NULL,
      nav       REAL NOT NULL,
      PRIMARY KEY (isin, nav_date)
    );
    CREATE INDEX IF NOT EXISTS idx_nav_history_isin_date ON nav_history(isin, nav_date);
  `);

  // Data migration for nav_history
  const v1Exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='nav_history_v1'").get();
  if (v1Exists) {
    log('app', 'INFO', 'DB', 'Migrating data to new nav_history schema');
    db.exec(`
      INSERT OR IGNORE INTO nav_history (isin, nav_date, nav)
      SELECT f.isin, n.date, n.nav
      FROM nav_history_v1 n
      JOIN funds f ON n.fund_id = f.id
      WHERE f.isin IS NOT NULL;
    `);
  }

  // Data migration for benchmark_history
  const bpExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='benchmark_prices'").get();
  if (bpExists) {
    log('app', 'INFO', 'DB', 'Migrating data to benchmark_history');
    db.exec(`
      INSERT OR IGNORE INTO benchmark_history (index_name, price_date, value)
      SELECT symbol, date, close
      FROM benchmark_prices;
    `);
  }

  // Migration for funds/folios columns
  const fundsCols = db.prepare("PRAGMA table_info(funds)").all() as any[];
  if (!fundsCols.find(c => c.name === 'amfi_code')) {
    db.exec("ALTER TABLE funds ADD COLUMN amfi_code TEXT");
  }
  if (!fundsCols.find(c => c.name === 'nav_history_fetched')) {
    db.exec("ALTER TABLE funds ADD COLUMN nav_history_fetched INTEGER DEFAULT 0");
  }

  const foliosCols = (db.prepare(
    "PRAGMA table_info(folios)"
  ).all() as any[]).map((c: any) => c.name);

  if (!foliosCols.includes('investor_name')) {
    db.exec("ALTER TABLE folios ADD COLUMN investor_name TEXT DEFAULT ''");
  }
  if (!foliosCols.includes('pan_number')) {
    db.exec("ALTER TABLE folios ADD COLUMN pan_number TEXT DEFAULT ''");
  }

  const logDir = path.join(process.cwd(), CONFIG.LOG_DIR);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Migration for folio columns to TEXT (Precision fix for KFINtech folios)
  const tablesToCheck = ['folios', 'transactions', 'funds', 'portfolios', 'portfolio_assets'];
  for (const tableName of tablesToCheck) {
    try {
      const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
      const columnsToMigrate = tableInfo.filter(c => 
        c.name.toLowerCase().includes('folio') && 
        c.type.toUpperCase() !== 'TEXT'
      );

      if (columnsToMigrate.length > 0) {
        log('app', 'INFO', 'DB', `Migrating ${tableName} folio columns to TEXT`);
        db.transaction(() => {
          const createSqlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tableName) as any;
          if (!createSqlRow) return;
          
          let newCreateSql = createSqlRow.sql;
          for (const col of columnsToMigrate) {
            const reg = new RegExp(`\\b${col.name}\\b\\s+[^,)]+`, 'gi');
            newCreateSql = newCreateSql.replace(reg, `${col.name} TEXT`);
          }

          db.exec(`ALTER TABLE ${tableName} RENAME TO ${tableName}_old`);
          db.exec(newCreateSql);
          
          const colNames = tableInfo.map(c => c.name).join(', ');
          const selectNames = tableInfo.map(c => 
            c.name.toLowerCase().includes('folio') ? `CAST(${c.name} AS TEXT)` : c.name
          ).join(', ');
          
          db.exec(`INSERT INTO ${tableName} (${colNames}) SELECT ${selectNames} FROM ${tableName}_old`);
          db.exec(`DROP TABLE ${tableName}_old`);
        })();
      }
    } catch (e) {
      // Skip errors if table doesn't exist or other issues
    }
  }

  log('app', 'INFO', 'APP', 'Application started, database initialized');

  // CAS IMPORT MIGRATIONS
  db.exec(`
    CREATE TABLE IF NOT EXISTS investors (
      pan        TEXT PRIMARY KEY,
      name       TEXT,
      email      TEXT,
      mobile     TEXT,
      kyc_ok     INTEGER DEFAULT 0,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cas_imports (
      id                   TEXT PRIMARY KEY,
      imported_at          TEXT NOT NULL DEFAULT (datetime('now')),
      period_from          TEXT,
      period_to            TEXT,
      investor_name        TEXT,
      total_folios         INTEGER DEFAULT 0,
      total_schemes        INTEGER DEFAULT 0,
      total_transactions   INTEGER DEFAULT 0,
      new_transactions     INTEGER DEFAULT 0,
      skipped_transactions INTEGER DEFAULT 0
    );

    DELETE FROM transactions
    WHERE rowid NOT IN (
      SELECT MIN(rowid)
      FROM transactions
      GROUP BY folio_id, date, transaction_type, units, nav, balance_units
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_dedup
    ON transactions(folio_id, date, transaction_type, units, nav, balance_units);
  `);

  // New columns on existing tables
  const fundsColsMigrate = db.prepare("PRAGMA table_info(funds)").all() as any[];
  if (!fundsColsMigrate.find(c => c.name === 'plan')) {
    db.exec("ALTER TABLE funds ADD COLUMN plan TEXT DEFAULT 'Unknown'");
  }
  if (!fundsColsMigrate.find(c => c.name === 'fund_option')) {
    db.exec("ALTER TABLE funds ADD COLUMN fund_option TEXT DEFAULT 'Unknown'");
  }
  if (!fundsColsMigrate.find(c => c.name === 'registrar')) {
    db.exec("ALTER TABLE funds ADD COLUMN registrar TEXT DEFAULT ''");
  }

  const foliosColsMigrate = db.prepare("PRAGMA table_info(folios)").all() as any[];
  if (!foliosColsMigrate.find(c => c.name === 'kyc_ok')) {
    db.exec("ALTER TABLE folios ADD COLUMN kyc_ok INTEGER DEFAULT 0");
  }
  if (!foliosColsMigrate.find(c => c.name === 'stated_balance')) {
    db.exec("ALTER TABLE folios ADD COLUMN stated_balance REAL DEFAULT 0");
  }
  if (!foliosColsMigrate.find(c => c.name === 'stated_cost')) {
    db.exec("ALTER TABLE folios ADD COLUMN stated_cost REAL DEFAULT 0");
  }
  if (!foliosColsMigrate.find(c => c.name === 'stated_market_value')) {
    db.exec("ALTER TABLE folios ADD COLUMN stated_market_value REAL DEFAULT 0");
  }
  if (!foliosColsMigrate.find(c => c.name === 'cas_updated_at')) {
    db.exec("ALTER TABLE folios ADD COLUMN cas_updated_at TEXT");
  }

  const transactionsColsMigrate = db.prepare("PRAGMA table_info(transactions)").all() as any[];
  if (!transactionsColsMigrate.find(c => c.name === 'description')) {
    db.exec("ALTER TABLE transactions ADD COLUMN description TEXT DEFAULT ''");
  }
}

/**
 * Sanitizes folio numbers to prevent precision loss and scientific notation issues.
 * Logic: if the value is in scientific notation, use BigInt(Math.round(Number(raw))).toString()
 * Keeps full folio as-is including suffixes like "/76".
 */
export function sanitizeFolio(raw: string | number | any): string {
  if (raw === null || raw === undefined) return '';
  let str = String(raw).trim();
  
  // Handle scientific notation (e.g., "5.9935E+11")
  if (/e\+/i.test(str)) {
    try {
      const num = Number(raw);
      if (!isNaN(num)) {
        str = BigInt(Math.round(num)).toString();
      }
    } catch (e) {
      // If conversion fails, return original trimmed string
    }
  }
  
  return str;
}
