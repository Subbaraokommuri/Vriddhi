import Database from 'better-sqlite3';
import { CONFIG } from './config.ts';
import { runMigrations } from './migrations.ts';

export const db = new Database(CONFIG.DB_NAME);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb() {
  runMigrations(db);
}

export { log } from './logger.ts';
export { sanitizeFolio } from './utils.ts';
