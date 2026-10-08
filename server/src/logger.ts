// Gateway diagnostics logger: every line goes to the console and to a daily
// file under server/logs/ (gateway-YYYY-MM-DD.log), so a field test against
// real hardware leaves a log that can be sent back for analysis.
//
//   LOG_LEVEL=debug  every Modbus frame and HTTP request (very noisy)
//   LOG_LEVEL=info   connection lifecycle, errors, timeouts, 30s health
//                    snapshots (default)
//   LOG_LEVEL=warn   problems only
//   LOG_DIR=...      where log files go (default: server/logs)
import { appendFile, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const configured = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as Level;
const threshold = LEVELS[configured] ?? LEVELS.info;
const logDir = process.env.LOG_DIR ?? join(__dirname, '..', 'logs');

let fileLoggingAvailable = true;
try {
  mkdirSync(logDir, { recursive: true });
} catch {
  fileLoggingAvailable = false;
}

function localTimestamp(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  );
}

function formatFields(fields?: Record<string, unknown>): string {
  if (!fields) return '';
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' && !/\s/.test(v) ? v : JSON.stringify(v)}`);
  return parts.length ? ' ' + parts.join(' ') : '';
}

function write(level: Level, category: string, message: string, fields?: Record<string, unknown>, sync = false): void {
  if (LEVELS[level] < threshold) return;
  const now = new Date();
  const line = `${localTimestamp(now)} ${level.toUpperCase().padEnd(5)} [${category}] ${message}${formatFields(fields)}`;
  if (level === 'error' || level === 'warn') console.warn(line);
  else console.log(line);

  if (fileLoggingAvailable) {
    const file = join(logDir, `gateway-${localTimestamp(now).slice(0, 10)}.log`);
    if (sync) {
      try {
        appendFileSync(file, line + '\n');
      } catch {
        // console still has it
      }
    } else {
      appendFile(file, line + '\n', (err) => {
        // The logs folder was deleted while running - recreate it and retry
        // once. Any other failure (full disk etc.) must never take the
        // gateway down; the console still has the line.
        if (err?.code === 'ENOENT') {
          try {
            mkdirSync(logDir, { recursive: true });
            appendFileSync(file, line + '\n');
          } catch {
            // give up on this line
          }
        }
      });
    }
  }
}

export const logger = {
  debug: (category: string, message: string, fields?: Record<string, unknown>) => write('debug', category, message, fields),
  info: (category: string, message: string, fields?: Record<string, unknown>) => write('info', category, message, fields),
  warn: (category: string, message: string, fields?: Record<string, unknown>) => write('warn', category, message, fields),
  error: (category: string, message: string, fields?: Record<string, unknown>) => write('error', category, message, fields),
  // Written synchronously - for the last line before the process exits.
  fatal: (category: string, message: string, fields?: Record<string, unknown>) => write('error', category, message, fields, true),
  isDebug: () => threshold <= LEVELS.debug,
  logDir,
};
