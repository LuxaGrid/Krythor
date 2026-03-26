import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import type { PrivacyDecision } from '@krythor/models';

// ─── AuditLogger ──────────────────────────────────────────────────────────────
//
// Structured, append-only audit log for all significant Krythor operations.
// Separate from the existing guard-audit.ndjson (which records raw guard verdicts).
// This logger captures higher-level events: agent runs, approvals, privacy decisions.
//
// File: <dataDir>/logs/audit.ndjson
// Format: one JSON object per line (NDJSON)
// Ring buffer: last 10,000 events in memory for fast tail/query
// Retention: append-only — use logrotate externally for rotation
//
// SECURITY: Never store raw secrets — callers must pass contentHash instead.
//

export interface AuditEvent {
  id: string;
  timestamp: string;         // ISO 8601
  requestId?: string;
  sessionId?: string;
  agentId?: string;
  agentName?: string;
  toolName?: string;
  skillName?: string;
  actionType: string;
  target?: string;
  policyDecision?: 'allow' | 'deny' | 'warn' | 'require-approval';
  approvalResult?: 'allow_once' | 'allow_for_session' | 'deny' | 'timeout';
  executionOutcome?: 'success' | 'error' | 'blocked' | 'timeout';
  modelUsed?: string;
  providerId?: string;
  privacyDecision?: PrivacyDecision;
  fallbackOccurred?: boolean;
  reason?: string;
  durationMs?: number;
  /** SHA-256 of sensitive content — never store raw content */
  contentHash?: string;
}

/** Maximum number of events to keep in the in-memory ring buffer */
const RING_BUFFER_SIZE = 10_000;

export class AuditLogger {
  private readonly logPath: string;
  private readonly ring: AuditEvent[] = [];
  private ready = false;

  constructor(private readonly logDir: string) {
    this.logPath = join(logDir, 'audit.ndjson');
    try {
      mkdirSync(logDir, { recursive: true });
      this.ready = true;
      this.loadExisting();
    } catch {
      process.stderr.write('[AuditLogger] Could not create logs directory — audit log disabled\n');
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Append an audit event. Assigns id and timestamp if not provided.
   * Silently no-ops if the logger failed to initialize.
   */
  log(event: Partial<AuditEvent> & { actionType: string }): void {
    const full: AuditEvent = {
      id: event.id ?? randomUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
      ...event,
    };

    // Add to ring buffer (cap at RING_BUFFER_SIZE)
    this.ring.push(full);
    if (this.ring.length > RING_BUFFER_SIZE) {
      this.ring.shift();
    }

    if (!this.ready) return;

    try {
      appendFileSync(this.logPath, JSON.stringify(full) + '\n', 'utf-8');
    } catch {
      // Best-effort — non-fatal
    }
  }

  /**
   * Returns the last N events from the ring buffer (most recent last).
   */
  tail(limit: number): AuditEvent[] {
    const n = Math.max(1, Math.min(limit, RING_BUFFER_SIZE));
    return this.ring.slice(-n);
  }

  /**
   * Query events from the ring buffer matching ALL provided filter fields.
   * Only string and boolean fields are compared (partial match semantics for strings).
   */
  query(filter: Partial<AuditEvent>): AuditEvent[] {
    return this.ring.filter(event => {
      for (const [key, value] of Object.entries(filter)) {
        const k = key as keyof AuditEvent;
        const eventVal = event[k];
        if (value === undefined) continue;
        if (typeof value === 'string' && typeof eventVal === 'string') {
          if (!eventVal.includes(value)) return false;
        } else if (eventVal !== value) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Returns the path to the audit log file.
   */
  get path(): string {
    return this.logPath;
  }

  /**
   * Returns the current size of the in-memory ring buffer.
   */
  get size(): number {
    return this.ring.length;
  }

  // ── Static helpers ─────────────────────────────────────────────────────────

  /**
   * SHA-256 hash of content for use as contentHash.
   * Use this instead of storing raw sensitive content.
   */
  static hashContent(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Load existing log entries into the ring buffer on startup.
   * Reads the last RING_BUFFER_SIZE lines to populate the in-memory buffer.
   */
  private loadExisting(): void {
    if (!existsSync(this.logPath)) return;
    try {
      const raw = readFileSync(this.logPath, 'utf-8');
      const lines = raw.split('\n').filter(l => l.trim().length > 0);
      // Take the last RING_BUFFER_SIZE lines to populate ring
      const recent = lines.slice(-RING_BUFFER_SIZE);
      for (const line of recent) {
        try {
          const event = JSON.parse(line) as AuditEvent;
          this.ring.push(event);
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // Non-fatal — start with empty ring if file is unreadable
    }
  }
}
