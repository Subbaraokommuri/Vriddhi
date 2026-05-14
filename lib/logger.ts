import path from 'path';
import fs from 'fs';
import { CONFIG } from './config.ts';

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
