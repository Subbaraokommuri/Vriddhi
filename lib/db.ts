import Database from 'better-sqlite3';
import { CONFIG } from './config.ts';
import { runMigrations } from './migrations.ts';

export const db = new Database(CONFIG.DB_NAME);

export function initDb() {
  runMigrations(db);
}

export { log, appendLog } from './logger.ts';
export { sanitizeFolio } from './utils.ts';
