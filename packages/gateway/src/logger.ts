import { mkdirSync, appendFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { redactSecrets, redactErrorMessage } from './redact.js';

// ─── DiskLogger ───────────────────────────────────────────────────────────────
//
// Writes rotating daily log files to %LOCALAPPDATA%\Krythor\logs\ (Windows)
// or ~/.krythor/logs/ (other platforms). Retains 7 days of logs.
//
// Log levels (in ascending severity): debug < info < warn < error
// Set via setLevel() at startup — lines below the active level are dropped.
//

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

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
  private minLevel: LogLevel = 'info';

  constructor() {
    this.logsDir = getLogsDir();
    try {
      mkdirSync(this.logsDir, { recursive: true });
      pruneOldLogs(this.logsDir);
    } catch { /* non-fatal */ }
  }

  /** Change the minimum log level at runtime (e.g. from AppConfig). */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  getLevel(): LogLevel {
    return this.minLevel;
  }

  private write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return;
    try {
      const ts = new Date().toISOString();
      const safeData = data ? redactSecrets(data) as Record<string, unknown> : undefined;
      const line = JSON.stringify({ ts, level: level.toUpperCase(), message, ...safeData }) + '\n';
      appendFileSync(logFilePath(this.logsDir), line, 'utf-8');
    } catch { /* non-fatal — disk logging must never crash the server */ }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.write('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write('info', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write('error', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write('warn', message, data);
  }

  serverStart(port: number, host: string): void {
    this.info('Server started', { port, host });
    pruneOldLogs(this.logsDir);
  }

  serverStop(): void {
    this.info('Server stopped');
  }

  guardDenied(context: Record<string, unknown>, reason: string, requestId?: string): void {
    this.warn('Guard denied', { context, reason, ...(requestId && { requestId }) });
  }

  agentRunStarted(runId: string, agentId: string, agentName: string, requestId?: string): void {
    this.info('Agent run started', { runId, agentId, agentName, ...(requestId && { requestId }) });
  }

  agentRunCompleted(runId: string, agentId: string, durationMs: number, modelUsed?: string, requestId?: string): void {
    this.info('Agent run completed', { runId, agentId, durationMs, modelUsed, ...(requestId && { requestId }) });
  }

  agentRunFailed(runId: string, agentId: string, error: string, requestId?: string): void {
    this.error('Agent run failed', { runId, agentId, error: redactErrorMessage(error), ...(requestId && { requestId }) });
  }

  skillRunCompleted(skillId: string, skillName: string, durationMs: number, modelId?: string, requestId?: string): void {
    this.info('Skill run completed', { skillId, skillName, durationMs, modelId, ...(requestId && { requestId }) });
  }

  skillRunFailed(skillId: string, skillName: string, error: string, requestId?: string): void {
    this.error('Skill run failed', { skillId, skillName, error: redactErrorMessage(error), ...(requestId && { requestId }) });
  }

  guardDecisionLogged(operation: string, allowed: boolean, action: string, ruleId?: string): void {
    this.info('Guard decision', { operation, allowed, action, ruleId });
  }

  system(event: string, data?: Record<string, unknown>): void {
    this.info(`System: ${event}`, data);
  }

  circuitStateChange(providerId: string, from: string, to: string, data?: Record<string, unknown>): void {
    this.warn('Circuit breaker state change', { providerId, from, to, ...data });
  }

  modelRetry(providerId: string, attempt: number, maxRetries: number, delayMs: number, error: string): void {
    this.warn('Model inference retry', { providerId, attempt, maxRetries, delayMs, error: redactErrorMessage(error) });
  }

  modelSelected(providerId: string, model: string, selectionReason: string, fallbackOccurred: boolean, retryCount?: number): void {
    this.info('Model selected', { providerId, model, selectionReason, fallbackOccurred, ...(retryCount !== undefined && retryCount > 0 && { retryCount }) });
  }

  heartbeatRun(checksRan: number, insights: number, durationMs: number, timedOut: boolean): void {
    this.info('Heartbeat run', { checksRan, insights, durationMs, timedOut });
  }

  recommendationMade(taskType: string, modelId: string, providerId: string, confidence: string): void {
    this.info('Model recommendation', { taskType, modelId, providerId, confidence });
  }

  recommendationOverridden(taskType: string, suggestedModelId: string, chosenModelId: string): void {
    this.info('Recommendation overridden', { taskType, suggestedModelId, chosenModelId });
  }

  learningRecordWritten(id: string, taskType: string, outcome: string): void {
    this.info('Learning record written', { id, taskType, outcome });
  }
}

// Singleton logger instance
export const logger = new DiskLogger();
