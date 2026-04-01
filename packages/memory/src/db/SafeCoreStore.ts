import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

export type SafeCoreMode = 'READ_ONLY' | 'WORKSPACE' | 'CONNECTOR_LIMITED' | 'ELEVATED_HOST';
export type ApprovalState = 'none' | 'pending' | 'approved' | 'denied';
export type PromotionState = 'none' | 'pending' | 'approved' | 'promoted' | 'rejected';
export type ResultState = 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'promoted';
export type PolicyResult = 'allow' | 'deny' | 'warn' | 'require-approval';

export interface SafeCoreExecution {
  id: string;
  runId?: string;
  agentId?: string;
  mode: SafeCoreMode;
  requestedAction: string;
  approvedAction?: string;
  policyResult: PolicyResult;
  policyReason?: string;
  filesystemScope?: { allowedPaths: string[]; workspaceDir?: string };
  networkScope?: { allowedHosts: string[]; blockedHosts: string[] };
  connectorScope?: { allowedConnectors: string[] };
  approvalState: ApprovalState;
  promotionState: PromotionState;
  promotedAt?: number;
  promotedBy?: string;
  resultState: ResultState;
  output?: string;
  filesTouched?: string[];
  commandsRun?: { cmd: string; args: string[]; exitCode?: number }[];
  networkAttempts?: { url: string; blocked: boolean }[];
  errorMessage?: string;
  startedAt: number;
  completedAt?: number;
  retainedUntil?: number;
  createdAt: number;
}

export interface CreateSafeCoreExecutionInput {
  runId?: string;
  agentId?: string;
  mode: SafeCoreMode;
  requestedAction: string;
  policyResult: PolicyResult;
  policyReason?: string;
  filesystemScope?: SafeCoreExecution['filesystemScope'];
  networkScope?: SafeCoreExecution['networkScope'];
  connectorScope?: SafeCoreExecution['connectorScope'];
}

export interface SafeCorePolicy {
  mode: SafeCoreMode;
  enabled: boolean;
  requireApproval: boolean;
  requirePromotionApproval: boolean;
  allowedPaths: string[];
  blockedCommands: string[];
  allowedHosts: string[];
  blockedHosts: string[];
  allowedConnectors: string[];
  retentionDays: number;
  ephemeral: boolean;
  updatedAt: number;
}

export interface SafeCoreDashboardStats {
  totalRuns: number;
  runsByMode: Record<SafeCoreMode, number>;
  pendingApprovals: number;
  pendingPromotions: number;
  blockedActions: number;
  recentRuns: SafeCoreExecution[];
}

export class SafeCoreStore {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateSafeCoreExecutionInput): SafeCoreExecution {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO safecore_executions
        (id, run_id, agent_id, mode, requested_action, policy_result, policy_reason,
         filesystem_scope, network_scope, connector_scope,
         approval_state, promotion_state, result_state, started_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', 'none', 'pending', ?, ?)
    `).run(
      id,
      input.runId ?? null,
      input.agentId ?? null,
      input.mode,
      input.requestedAction,
      input.policyResult,
      input.policyReason ?? null,
      input.filesystemScope ? JSON.stringify(input.filesystemScope) : null,
      input.networkScope ? JSON.stringify(input.networkScope) : null,
      input.connectorScope ? JSON.stringify(input.connectorScope) : null,
      now,
      now,
    );
    return this.getById(id)!;
  }

  getById(id: string): SafeCoreExecution | null {
    const row = this.db.prepare(`SELECT * FROM safecore_executions WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  list(filter?: {
    mode?: SafeCoreMode;
    resultState?: ResultState;
    approvalState?: ApprovalState;
    promotionState?: PromotionState;
    agentId?: string;
    limit?: number;
    offset?: number;
  }): SafeCoreExecution[] {
    let sql = `SELECT * FROM safecore_executions WHERE 1=1`;
    const params: unknown[] = [];
    if (filter?.mode)           { sql += ` AND mode = ?`;            params.push(filter.mode); }
    if (filter?.resultState)    { sql += ` AND result_state = ?`;    params.push(filter.resultState); }
    if (filter?.approvalState)  { sql += ` AND approval_state = ?`;  params.push(filter.approvalState); }
    if (filter?.promotionState) { sql += ` AND promotion_state = ?`; params.push(filter.promotionState); }
    if (filter?.agentId)        { sql += ` AND agent_id = ?`;        params.push(filter.agentId); }
    sql += ` ORDER BY created_at DESC`;
    const lim = Math.min(filter?.limit ?? 50, 200);
    sql += ` LIMIT ? OFFSET ?`;
    params.push(lim, filter?.offset ?? 0);
    return (this.db.prepare(sql).all(...params) as Record<string, unknown>[]).map(r => this.rowToRecord(r));
  }

  update(id: string, patch: Partial<Pick<SafeCoreExecution,
    'approvedAction' | 'approvalState' | 'promotionState' | 'resultState' |
    'output' | 'filesTouched' | 'commandsRun' | 'networkAttempts' |
    'errorMessage' | 'completedAt' | 'promotedAt' | 'promotedBy' | 'retainedUntil'
  >>): SafeCoreExecution {
    const row = this.getById(id);
    if (!row) throw new Error(`SafeCore execution "${id}" not found`);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.approvedAction  !== undefined) { sets.push('approved_action = ?');  params.push(patch.approvedAction); }
    if (patch.approvalState   !== undefined) { sets.push('approval_state = ?');   params.push(patch.approvalState); }
    if (patch.promotionState  !== undefined) { sets.push('promotion_state = ?');  params.push(patch.promotionState); }
    if (patch.resultState     !== undefined) { sets.push('result_state = ?');     params.push(patch.resultState); }
    if (patch.output          !== undefined) { sets.push('output = ?');           params.push(patch.output.slice(0, 10240)); }
    if (patch.filesTouched    !== undefined) { sets.push('files_touched = ?');    params.push(JSON.stringify(patch.filesTouched)); }
    if (patch.commandsRun     !== undefined) { sets.push('commands_run = ?');     params.push(JSON.stringify(patch.commandsRun)); }
    if (patch.networkAttempts !== undefined) { sets.push('network_attempts = ?'); params.push(JSON.stringify(patch.networkAttempts)); }
    if (patch.errorMessage    !== undefined) { sets.push('error_message = ?');    params.push(patch.errorMessage); }
    if (patch.completedAt     !== undefined) { sets.push('completed_at = ?');     params.push(patch.completedAt); }
    if (patch.promotedAt      !== undefined) { sets.push('promoted_at = ?');      params.push(patch.promotedAt); }
    if (patch.promotedBy      !== undefined) { sets.push('promoted_by = ?');      params.push(patch.promotedBy); }
    if (patch.retainedUntil   !== undefined) { sets.push('retained_until = ?');   params.push(patch.retainedUntil); }
    if (sets.length === 0) return row;
    params.push(id);
    this.db.prepare(`UPDATE safecore_executions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id)!;
  }

  getDashboardStats(): SafeCoreDashboardStats {
    const totalRuns = (this.db.prepare(`SELECT COUNT(*) as c FROM safecore_executions`).get() as { c: number }).c;
    const byMode = this.db.prepare(`SELECT mode, COUNT(*) as c FROM safecore_executions GROUP BY mode`).all() as { mode: string; c: number }[];
    const runsByMode: Record<SafeCoreMode, number> = { READ_ONLY: 0, WORKSPACE: 0, CONNECTOR_LIMITED: 0, ELEVATED_HOST: 0 };
    for (const r of byMode) runsByMode[r.mode as SafeCoreMode] = r.c;
    const pendingApprovals = (this.db.prepare(`SELECT COUNT(*) as c FROM safecore_executions WHERE approval_state = 'pending'`).get() as { c: number }).c;
    const pendingPromotions = (this.db.prepare(`SELECT COUNT(*) as c FROM safecore_executions WHERE promotion_state = 'pending'`).get() as { c: number }).c;
    const blockedActions = (this.db.prepare(`SELECT COUNT(*) as c FROM safecore_executions WHERE result_state = 'blocked'`).get() as { c: number }).c;
    const recentRuns = this.list({ limit: 10 });
    return { totalRuns, runsByMode, pendingApprovals, pendingPromotions, blockedActions, recentRuns };
  }

  getPolicy(mode: SafeCoreMode): SafeCorePolicy | null {
    const row = this.db.prepare(`SELECT * FROM safecore_policies WHERE mode = ?`).get(mode) as Record<string, unknown> | undefined;
    return row ? this.policyRowToRecord(row) : null;
  }

  listPolicies(): SafeCorePolicy[] {
    return (this.db.prepare(`SELECT * FROM safecore_policies ORDER BY mode`).all() as Record<string, unknown>[]).map(r => this.policyRowToRecord(r));
  }

  updatePolicy(mode: SafeCoreMode, patch: Partial<Omit<SafeCorePolicy, 'mode' | 'updatedAt'>>): SafeCorePolicy {
    const existing = this.getPolicy(mode);
    if (!existing) throw new Error(`SafeCore policy for mode "${mode}" not found`);
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [Date.now()];
    if (patch.enabled                   !== undefined) { sets.push('enabled = ?');                    params.push(patch.enabled ? 1 : 0); }
    if (patch.requireApproval           !== undefined) { sets.push('require_approval = ?');           params.push(patch.requireApproval ? 1 : 0); }
    if (patch.requirePromotionApproval  !== undefined) { sets.push('require_promotion_approval = ?'); params.push(patch.requirePromotionApproval ? 1 : 0); }
    if (patch.allowedPaths              !== undefined) { sets.push('allowed_paths = ?');              params.push(JSON.stringify(patch.allowedPaths)); }
    if (patch.blockedCommands           !== undefined) { sets.push('blocked_commands = ?');           params.push(JSON.stringify(patch.blockedCommands)); }
    if (patch.allowedHosts              !== undefined) { sets.push('allowed_hosts = ?');              params.push(JSON.stringify(patch.allowedHosts)); }
    if (patch.blockedHosts              !== undefined) { sets.push('blocked_hosts = ?');              params.push(JSON.stringify(patch.blockedHosts)); }
    if (patch.allowedConnectors         !== undefined) { sets.push('allowed_connectors = ?');        params.push(JSON.stringify(patch.allowedConnectors)); }
    if (patch.retentionDays             !== undefined) { sets.push('retention_days = ?');             params.push(patch.retentionDays); }
    if (patch.ephemeral                 !== undefined) { sets.push('ephemeral = ?');                  params.push(patch.ephemeral ? 1 : 0); }
    params.push(mode);
    this.db.prepare(`UPDATE safecore_policies SET ${sets.join(', ')} WHERE mode = ?`).run(...params);
    return this.getPolicy(mode)!;
  }

  pruneExpired(): number {
    const now = Date.now();
    // Prune executions past their retained_until date
    const explicit = this.db.prepare(`
      DELETE FROM safecore_executions
      WHERE retained_until IS NOT NULL AND retained_until < ?
    `).run(now);
    // Prune executions past the policy-based retention window
    const policies = this.listPolicies();
    let policyPruned = 0;
    for (const policy of policies) {
      const cutoff = now - policy.retentionDays * 24 * 60 * 60 * 1000;
      const r = this.db.prepare(`
        DELETE FROM safecore_executions
        WHERE mode = ? AND retained_until IS NULL AND created_at < ?
          AND result_state NOT IN ('pending', 'running')
      `).run(policy.mode, cutoff);
      policyPruned += r.changes;
    }
    return explicit.changes + policyPruned;
  }

  private rowToRecord(row: Record<string, unknown>): SafeCoreExecution {
    return {
      id:              row['id'] as string,
      runId:           (row['run_id'] as string | null) ?? undefined,
      agentId:         (row['agent_id'] as string | null) ?? undefined,
      mode:            row['mode'] as SafeCoreMode,
      requestedAction: row['requested_action'] as string,
      approvedAction:  (row['approved_action'] as string | null) ?? undefined,
      policyResult:    row['policy_result'] as PolicyResult,
      policyReason:    (row['policy_reason'] as string | null) ?? undefined,
      filesystemScope: row['filesystem_scope'] ? JSON.parse(row['filesystem_scope'] as string) : undefined,
      networkScope:    row['network_scope']    ? JSON.parse(row['network_scope'] as string)    : undefined,
      connectorScope:  row['connector_scope']  ? JSON.parse(row['connector_scope'] as string)  : undefined,
      approvalState:   row['approval_state'] as ApprovalState,
      promotionState:  row['promotion_state'] as PromotionState,
      promotedAt:      (row['promoted_at'] as number | null) ?? undefined,
      promotedBy:      (row['promoted_by'] as string | null) ?? undefined,
      resultState:     row['result_state'] as ResultState,
      output:          (row['output'] as string | null) ?? undefined,
      filesTouched:    row['files_touched']    ? JSON.parse(row['files_touched'] as string)    : undefined,
      commandsRun:     row['commands_run']     ? JSON.parse(row['commands_run'] as string)     : undefined,
      networkAttempts: row['network_attempts'] ? JSON.parse(row['network_attempts'] as string) : undefined,
      errorMessage:    (row['error_message'] as string | null) ?? undefined,
      startedAt:       row['started_at'] as number,
      completedAt:     (row['completed_at'] as number | null) ?? undefined,
      retainedUntil:   (row['retained_until'] as number | null) ?? undefined,
      createdAt:       row['created_at'] as number,
    };
  }

  private policyRowToRecord(row: Record<string, unknown>): SafeCorePolicy {
    return {
      mode:                    row['mode'] as SafeCoreMode,
      enabled:                 Boolean(row['enabled']),
      requireApproval:         Boolean(row['require_approval']),
      requirePromotionApproval: Boolean(row['require_promotion_approval']),
      allowedPaths:            row['allowed_paths']    ? JSON.parse(row['allowed_paths'] as string)    : [],
      blockedCommands:         row['blocked_commands'] ? JSON.parse(row['blocked_commands'] as string) : [],
      allowedHosts:            row['allowed_hosts']    ? JSON.parse(row['allowed_hosts'] as string)    : [],
      blockedHosts:            row['blocked_hosts']    ? JSON.parse(row['blocked_hosts'] as string)    : [],
      allowedConnectors:       row['allowed_connectors'] ? JSON.parse(row['allowed_connectors'] as string) : [],
      retentionDays:           row['retention_days'] as number,
      ephemeral:               Boolean(row['ephemeral']),
      updatedAt:               row['updated_at'] as number,
    };
  }
}
