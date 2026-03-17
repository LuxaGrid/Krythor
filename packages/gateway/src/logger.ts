import { mkdirSync, appendFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { redactSecrets, redactErrorMessage } from './redact.js';

// ─── DiskLogger ───────────────────────────────────────────────────────────────
//
// Writes rotating daily log files to %LOCALAPPDATA%\Krythor\logs\ (Windows)
// or ~/.krythor/logs/ (other platforms). Retains 7 days of logs.
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
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function logFilePath(logsDir: string): string {
  return join(logsDir, `krythor-${todayStr()}.log`);
}

function pruneOldLogs(logsDir: string, keepDays = 7): void {
  try {
    const files = readdirSync(logsDir).filter(f => f.startsWith('krythor-') && f.endsWith('.log'));
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    for (const file of files) {
      try {
        const stat = statSync(join(logsDir, file));
        if (stat.mtimeMs < cutoff) {
          unlinkSync(join(logsDir, file));
        }
      } catch { /* ignore individual file errors */ }
    }
  } catch { /* ignore if dir unreadable */ }
}

export class DiskLogger {
  private logsDir: string;

  constructor() {
    this.logsDir = getLogsDir();
    try {
      mkdirSync(this.logsDir, { recursive: true });
      pruneOldLogs(this.logsDir);
    } catch { /* non-fatal */ }
  }

  private write(level: string, message: string, data?: Record<string, unknown>): void {
    try {
      const ts = new Date().toISOString();
      const safeData = data ? redactSecrets(data) as Record<string, unknown> : undefined;
      const line = JSON.stringify({ ts, level, message, ...safeData }) + '\n';
      appendFileSync(logFilePath(this.logsDir), line, 'utf-8');
    } catch { /* non-fatal — disk logging must never crash the server */ }
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write('INFO', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write('ERROR', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write('WARN', message, data);
  }

  serverStart(port: number, host: string): void {
    this.info('Server started', { port, host });
    pruneOldLogs(this.logsDir);
  }

  serverStop(): void {
    this.info('Server stopped');
  }

  guardDenied(context: Record<string, unknown>, reason: string): void {
    this.warn('Guard denied', { context, reason });
  }

  agentRunStarted(runId: string, agentId: string, agentName: string): void {
    this.info('Agent run started', { runId, agentId, agentName });
  }

  agentRunCompleted(runId: string, agentId: string, durationMs: number, modelUsed?: string): void {
    this.info('Agent run completed', { runId, agentId, durationMs, modelUsed });
  }

  agentRunFailed(runId: string, agentId: string, error: string): void {
    this.error('Agent run failed', { runId, agentId, error: redactErrorMessage(error) });
  }

  skillRunCompleted(skillId: string, skillName: string, durationMs: number, modelId?: string): void {
    this.info('Skill run completed', { skillId, skillName, durationMs, modelId });
  }

  skillRunFailed(skillId: string, skillName: string, error: string): void {
    this.error('Skill run failed', { skillId, skillName, error: redactErrorMessage(error) });
  }

  guardDecisionLogged(operation: string, allowed: boolean, action: string, ruleId?: string): void {
    this.info('Guard decision', { operation, allowed, action, ruleId });
  }
}

// Singleton logger instance
export const logger = new DiskLogger();
