import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

export type ProposalType = 'new_skill' | 'update_skill' | 'prompt_refinement' | 'workflow_refinement' | 'parameter_tuning';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'superseded' | 'applied';

export interface SkillEvolutionProposal {
  id: string;
  sourceSkillId?: string;
  proposedName: string;
  proposalType: ProposalType;
  summary: string;
  rationale: string;
  changes: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  confidence?: number;
  status: ProposalStatus;
  createdBy: string;
  createdAt: number;
  reviewedBy?: string;
  reviewedAt?: number;
  appliedAt?: number;
  appliedSkillVersion?: number;
  reviewNote?: string;
}

export interface CreateProposalInput {
  sourceSkillId?: string;
  proposedName: string;
  proposalType: ProposalType;
  summary: string;
  rationale: string;
  changes: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  confidence?: number;
  createdBy: string;
}

export class SkillEvolutionStore {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateProposalInput): SkillEvolutionProposal {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db.prepare(`
      INSERT INTO skill_evolution_proposals
        (id, source_skill_id, proposed_name, proposal_type, summary, rationale, changes, evidence, confidence, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      id,
      input.sourceSkillId ?? null,
      input.proposedName,
      input.proposalType,
      input.summary,
      input.rationale,
      JSON.stringify(input.changes),
      input.evidence ? JSON.stringify(input.evidence) : null,
      input.confidence ?? null,
      input.createdBy,
      createdAt,
    );
    return this.getById(id)!;
  }

  getById(id: string): SkillEvolutionProposal | null {
    const row = this.db.prepare(`SELECT * FROM skill_evolution_proposals WHERE id = ?`).get(id) as any;
    return row ? this.rowToRecord(row) : null;
  }

  list(filter?: { status?: ProposalStatus; sourceSkillId?: string }): SkillEvolutionProposal[] {
    let sql = `SELECT * FROM skill_evolution_proposals WHERE 1=1`;
    const params: unknown[] = [];
    if (filter?.status) {
      sql += ` AND status = ?`;
      params.push(filter.status);
    }
    if (filter?.sourceSkillId) {
      sql += ` AND source_skill_id = ?`;
      params.push(filter.sourceSkillId);
    }
    sql += ` ORDER BY created_at DESC`;
    return (this.db.prepare(sql).all(...params) as any[]).map(this.rowToRecord);
  }

  review(id: string, decision: 'approved' | 'rejected', reviewedBy: string, reviewNote?: string): SkillEvolutionProposal {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Proposal "${id}" not found`);
    if (existing.status !== 'pending') throw new Error(`Proposal "${id}" is not pending (status: ${existing.status})`);
    this.db.prepare(`
      UPDATE skill_evolution_proposals
      SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?
      WHERE id = ?
    `).run(decision, reviewedBy, Date.now(), reviewNote ?? null, id);
    return this.getById(id)!;
  }

  markApplied(id: string, skillVersion: number): SkillEvolutionProposal {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Proposal "${id}" not found`);
    this.db.prepare(`
      UPDATE skill_evolution_proposals
      SET status = 'applied', applied_at = ?, applied_skill_version = ?
      WHERE id = ?
    `).run(Date.now(), skillVersion, id);
    return this.getById(id)!;
  }

  markSuperseded(id: string): void {
    this.db.prepare(`
      UPDATE skill_evolution_proposals SET status = 'superseded' WHERE id = ?
    `).run(id);
  }

  private rowToRecord(row: any): SkillEvolutionProposal {
    return {
      id: row.id,
      sourceSkillId: row.source_skill_id ?? undefined,
      proposedName: row.proposed_name,
      proposalType: row.proposal_type as ProposalType,
      summary: row.summary,
      rationale: row.rationale,
      changes: JSON.parse(row.changes),
      evidence: row.evidence ? JSON.parse(row.evidence) : undefined,
      confidence: row.confidence ?? undefined,
      status: row.status as ProposalStatus,
      createdBy: row.created_by,
      createdAt: row.created_at,
      reviewedBy: row.reviewed_by ?? undefined,
      reviewedAt: row.reviewed_at ?? undefined,
      appliedAt: row.applied_at ?? undefined,
      appliedSkillVersion: row.applied_skill_version ?? undefined,
      reviewNote: row.review_note ?? undefined,
    };
  }
}
