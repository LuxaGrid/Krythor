/**
 * StandingOrderStore — persists agent standing orders.
 *
 * A standing order defines a permanent operating program for an agent:
 *   - scope:         what the agent is authorized to do
 *   - triggers:      when to execute (schedule expression, event, or condition)
 *   - approvalGates: what requires human sign-off before acting
 *   - escalation:    when to stop and ask for help
 *
 * Standing orders can be linked to cron jobs (via cronJobId) so that the
 * scheduler automatically runs them on a defined schedule.
 *
 * Stored as JSON at <configDir>/standing-orders.json.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { atomicWriteJSON } from '@krythor/core';

export interface StandingOrder {
  /** Stable unique ID */
  id: string;
  /** Human-readable name, e.g. "Weekly Status Report" */
  name: string;
  /** Optional description */
  description?: string;
  /** The agent this order applies to. Uses default agent if omitted. */
  agentId?: string;
  /**
   * What the agent is authorized to do.
   * Plain text — injected into the agent's context when triggered.
   */
  scope: string;
  /**
   * Trigger description — human-readable, e.g. "Every Friday at 4 PM".
   * The actual schedule is enforced via a linked cron job.
   */
  triggers?: string;
  /**
   * Approval gate rules — when to require human sign-off.
   * Plain text description, e.g. "Require approval for external sends."
   */
  approvalGates?: string;
  /**
   * Escalation rules — when to stop and ask for help.
   * Plain text description.
   */
  escalation?: string;
  /**
   * Execution steps — optional ordered list of steps for the agent.
   * Plain text or markdown.
   */
  executionSteps?: string;
  /**
   * Linked cron job ID. When set, the scheduler runs this standing order
   * on the cron job's schedule.
   */
  cronJobId?: string;
  /** Whether this standing order is currently active. */
  enabled: boolean;
  /** ISO timestamp of last execution */
  lastRunAt?: string;
  /** Last run status */
  lastRunStatus?: 'success' | 'failed';
  /** Last run error message */
  lastError?: string;
  /** Total successful run count */
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStandingOrderInput {
  name: string;
  description?: string;
  agentId?: string;
  scope: string;
  triggers?: string;
  approvalGates?: string;
  escalation?: string;
  executionSteps?: string;
  cronJobId?: string;
  enabled?: boolean;
}

export interface UpdateStandingOrderInput {
  name?: string;
  description?: string;
  agentId?: string;
  scope?: string;
  triggers?: string;
  approvalGates?: string;
  escalation?: string;
  executionSteps?: string;
  cronJobId?: string;
  enabled?: boolean;
}

export class StandingOrderStore {
  private readonly configPath: string;
  private orders: Map<string, StandingOrder> = new Map();

  constructor(configDir: string) {
    this.configPath = join(configDir, 'standing-orders.json');
    this.load();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  create(input: CreateStandingOrderInput): StandingOrder {
    const now = new Date().toISOString();
    const order: StandingOrder = {
      id:             randomUUID(),
      name:           input.name,
      description:    input.description,
      agentId:        input.agentId,
      scope:          input.scope,
      triggers:       input.triggers,
      approvalGates:  input.approvalGates,
      escalation:     input.escalation,
      executionSteps: input.executionSteps,
      cronJobId:      input.cronJobId,
      enabled:        input.enabled !== false,
      runCount:       0,
      createdAt:      now,
      updatedAt:      now,
    };
    this.orders.set(order.id, order);
    this.save();
    return order;
  }

  update(id: string, input: UpdateStandingOrderInput): StandingOrder {
    const existing = this.orders.get(id);
    if (!existing) throw new Error(`Standing order "${id}" not found`);
    const updated: StandingOrder = {
      ...existing,
      ...(input.name           !== undefined && { name:           input.name }),
      ...(input.description    !== undefined && { description:    input.description }),
      ...(input.agentId        !== undefined && { agentId:        input.agentId || undefined }),
      ...(input.scope          !== undefined && { scope:          input.scope }),
      ...(input.triggers       !== undefined && { triggers:       input.triggers }),
      ...(input.approvalGates  !== undefined && { approvalGates:  input.approvalGates }),
      ...(input.escalation     !== undefined && { escalation:     input.escalation }),
      ...(input.executionSteps !== undefined && { executionSteps: input.executionSteps }),
      ...(input.cronJobId      !== undefined && { cronJobId:      input.cronJobId || undefined }),
      ...(input.enabled        !== undefined && { enabled:        input.enabled }),
      updatedAt: new Date().toISOString(),
    };
    this.orders.set(id, updated);
    this.save();
    return updated;
  }

  delete(id: string): void {
    if (!this.orders.has(id)) throw new Error(`Standing order "${id}" not found`);
    this.orders.delete(id);
    this.save();
  }

  getById(id: string): StandingOrder | null {
    return this.orders.get(id) ?? null;
  }

  list(): StandingOrder[] {
    return Array.from(this.orders.values()).sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt),
    );
  }

  /** Returns standing orders linked to the given cron job. */
  getByCronJobId(cronJobId: string): StandingOrder[] {
    return Array.from(this.orders.values()).filter(o => o.cronJobId === cronJobId);
  }

  /** Called after a successful execution. */
  recordSuccess(id: string): void {
    const order = this.orders.get(id);
    if (!order) return;
    this.orders.set(id, {
      ...order,
      runCount:      order.runCount + 1,
      lastRunAt:     new Date().toISOString(),
      lastRunStatus: 'success',
      lastError:     undefined,
      updatedAt:     new Date().toISOString(),
    });
    this.save();
  }

  /** Called after a failed execution. */
  recordFailure(id: string, error: string): void {
    const order = this.orders.get(id);
    if (!order) return;
    this.orders.set(id, {
      ...order,
      lastRunAt:     new Date().toISOString(),
      lastRunStatus: 'failed',
      lastError:     error.slice(0, 500),
      updatedAt:     new Date().toISOString(),
    });
    this.save();
  }

  /**
   * Build the full instruction block to inject when triggering this order.
   * Combines scope, approval gates, escalation, and execution steps into
   * a structured prompt the agent can follow.
   */
  buildPrompt(id: string): string | null {
    const order = this.orders.get(id);
    if (!order || !order.enabled) return null;

    const sections: string[] = [
      `# Standing Order: ${order.name}`,
      '',
      '## Scope',
      order.scope,
    ];

    if (order.approvalGates) {
      sections.push('', '## Approval Gates', order.approvalGates);
    }
    if (order.escalation) {
      sections.push('', '## Escalation Rules', order.escalation);
    }
    if (order.executionSteps) {
      sections.push('', '## Execution Steps', order.executionSteps);
    }

    sections.push('', '---', 'Execute the above standing order now.');
    return sections.join('\n');
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.configPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.configPath, 'utf-8')) as unknown;
      if (Array.isArray(raw)) {
        for (const o of raw as StandingOrder[]) {
          this.orders.set(o.id, o);
        }
      }
    } catch (err) {
      console.error(`[StandingOrderStore] Failed to load ${this.configPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private save(): void {
    atomicWriteJSON(this.configPath, Array.from(this.orders.values()));
  }
}
