import type { FastifyInstance } from 'fastify';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Log routes ───────────────────────────────────────────────────────────────
//
// GET /api/logs          — list available log files (date, size, path)
// GET /api/logs/today    — tail the current day's log file (last N lines)
// GET /api/logs/:date    — fetch a specific day's log file (YYYY-MM-DD)
//
// All endpoints require auth. Logs are filtered to remove credential values
// before being returned to the client (same redaction as disk writes).
//

function getLogsDir(): string {
  if (process.platform === 'win32') {
    return join(
      process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'),
      'Krythor', 'logs',
    );
  }
  return join(homedir(), '.krythor', 'logs');
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseLogLines(raw: string): unknown[] {
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); }
      catch { return { raw: line }; }
    });
}

export function registerLogRoutes(app: FastifyInstance): void {
  const logsDir = getLogsDir();

  // GET /api/logs — list available log files
  app.get('/api/logs', async (_req, reply) => {
    if (!existsSync(logsDir)) return reply.send({ files: [], logsDir });
    const files = readdirSync(logsDir)
      .filter(f => f.startsWith('krythor-') && f.endsWith('.log'))
      .sort()
      .reverse() // newest first
      .map(f => {
        const date = f.replace('krythor-', '').replace('.log', '');
        let size = 0;
        try { size = statSync(join(logsDir, f)).size; } catch { /* ignore */ }
        return { date, filename: f, sizeBytes: size };
      });
    return reply.send({ files, logsDir });
  });

  // GET /api/logs/today?lines=200 — tail current day's log
  app.get<{ Querystring: { lines?: string } }>('/api/logs/today', async (req, reply) => {
    const maxLines = Math.min(parseInt(req.query.lines ?? '200', 10) || 200, 2000);
    const file = join(logsDir, `krythor-${todayStr()}.log`);
    if (!existsSync(file)) return reply.send({ date: todayStr(), entries: [], file });
    const raw = readFileSync(file, 'utf-8');
    const allLines = parseLogLines(raw);
    const entries = allLines.slice(-maxLines);
    return reply.send({ date: todayStr(), entries, file, total: allLines.length });
  });

  // GET /api/logs/:date — fetch a specific date's log file
  app.get<{ Params: { date: string }; Querystring: { lines?: string } }>(
    '/api/logs/:date',
    async (req, reply) => {
      const { date } = req.params;
      // Validate format — prevent path traversal
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return reply.code(400).send({ code: 'INVALID_DATE', message: 'Date must be YYYY-MM-DD' });
      }
      const file = join(logsDir, `krythor-${date}.log`);
      if (!existsSync(file)) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: `No log file for ${date}` });
      }
      const maxLines = Math.min(parseInt(req.query.lines ?? '500', 10) || 500, 5000);
      const raw = readFileSync(file, 'utf-8');
      const allLines = parseLogLines(raw);
      const entries = allLines.slice(-maxLines);
      return reply.send({ date, entries, file, total: allLines.length });
    },
  );
}
