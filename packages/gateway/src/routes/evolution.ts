/**
 * Skill Evolution routes
 *
 * GET  /api/skills/evolution/proposals        — list proposals (filter: status, skillId)
 * POST /api/skills/evolution/proposals        — create proposal
 * GET  /api/skills/evolution/proposals/:id    — get proposal detail
 * POST /api/skills/evolution/proposals/:id/review  — approve or reject
 * POST /api/skills/evolution/proposals/:id/apply   — apply approved proposal
 * GET  /api/skills/:id/versions               — list versions for a skill
 * GET  /api/skills/:id/versions/:version      — get specific version snapshot
 * POST /api/skills/:id/versions/:version/restore — restore skill to this version
 *
 * IMPORTANT: static segments registered before parameterized ones at the same depth.
 */

import type { FastifyInstance } from 'fastify';
import type { MemoryEngine } from '@krythor/memory';
import type { GuardEngine } from '@krythor/guard';
import { sendError } from '../errors.js';
import type { ApprovalManager } from '../ApprovalManager.js';
import { guardCheck } from '../guardCheck.js';
import type { SkillRegistry } from '@krythor/skills';
import type { CreateProposalInput, ProposalStatus } from '@krythor/memory';

export function registerEvolutionRoutes(
  app: FastifyInstance,
  memory: MemoryEngine,
  skillRegistry: SkillRegistry,
  guard: GuardEngine,
  approvalManager?: ApprovalManager,
): void {
  const evolutionStore = memory.skillEvolutionStore;
  const versionStore = memory.skillVersionStore;

  // ── Static evolution routes ─────────────────────────────────────────────

  // GET /api/skills/evolution/proposals
  app.get('/api/skills/evolution/proposals', async (req, reply) => {
    const query = req.query as { status?: string; skillId?: string };
    const proposals = evolutionStore.list({
      status: query.status as ProposalStatus | undefined,
      sourceSkillId: query.skillId,
    });
    return reply.send({ proposals });
  });

  // POST /api/skills/evolution/proposals
  app.post('/api/skills/evolution/proposals', async (req, reply) => {
    const allowed = await guardCheck({ guard, reply, operation: 'skill:write', source: 'user', approvalManager });
    if (!allowed) return;

    const body = req.body as Partial<CreateProposalInput>;
    if (!body.proposedName || !body.proposalType || !body.summary || !body.rationale || !body.changes || !body.createdBy) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'proposedName, proposalType, summary, rationale, changes, createdBy are required');
    }
    const proposal = evolutionStore.create(body as CreateProposalInput);
    return reply.code(201).send(proposal);
  });

  // POST /api/skills/evolution/proposals/:id/review
  app.post('/api/skills/evolution/proposals/:id/review', async (req, reply) => {
    const allowed = await guardCheck({ guard, reply, operation: 'skill:write', source: 'user', approvalManager });
    if (!allowed) return;

    const { id } = req.params as { id: string };
    const body = req.body as { decision: 'approved' | 'rejected'; reviewNote?: string; reviewedBy?: string };
    if (!body.decision || !['approved', 'rejected'].includes(body.decision)) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'decision must be "approved" or "rejected"');
    }
    try {
      const proposal = evolutionStore.review(id, body.decision, body.reviewedBy ?? 'user', body.reviewNote);
      return reply.send(proposal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return sendError(reply, 404, 'NOT_FOUND', msg);
      return sendError(reply, 400, 'INVALID_OPERATION', msg);
    }
  });

  // POST /api/skills/evolution/proposals/:id/apply
  app.post('/api/skills/evolution/proposals/:id/apply', async (req, reply) => {
    const allowed = await guardCheck({ guard, reply, operation: 'skill:write', source: 'user', approvalManager });
    if (!allowed) return;

    const { id } = req.params as { id: string };
    const proposal = evolutionStore.getById(id);
    if (!proposal) return sendError(reply, 404, 'NOT_FOUND', `Proposal "${id}" not found`);
    if (proposal.status !== 'approved') {
      return sendError(reply, 400, 'INVALID_OPERATION', `Proposal must be approved before applying (status: ${proposal.status})`);
    }

    try {
      if (proposal.proposalType === 'new_skill') {
        // Create a new skill from the proposal changes
        const input = proposal.changes as Record<string, unknown>;
        const skill = skillRegistry.create({
          name: proposal.proposedName,
          description: (input['description'] as string | undefined) ?? '',
          systemPrompt: (input['systemPrompt'] as string | undefined) ?? '',
          tags: (input['tags'] as string[] | undefined) ?? [],
          createdBy: proposal.createdBy,
          changelogNote: proposal.summary,
        });
        versionStore.save({
          skillId: skill.id,
          version: skill.version,
          snapshot: skill as unknown as Record<string, unknown>,
          createdBy: proposal.createdBy,
          changelogNote: proposal.summary,
        });
        evolutionStore.markApplied(id, skill.version);
        return reply.send({ proposal: evolutionStore.getById(id), skill });
      } else {
        // Update existing skill
        if (!proposal.sourceSkillId) {
          return sendError(reply, 400, 'INVALID_OPERATION', 'sourceSkillId is required for update proposals');
        }
        const existingSkill = skillRegistry.getById(proposal.sourceSkillId);
        if (!existingSkill) {
          return sendError(reply, 404, 'NOT_FOUND', `Source skill "${proposal.sourceSkillId}" not found`);
        }
        const changes = proposal.changes as Record<string, unknown>;
        const updatedSkill = skillRegistry.update(proposal.sourceSkillId, {
          ...(changes['name'] !== undefined && { name: changes['name'] as string }),
          ...(changes['description'] !== undefined && { description: changes['description'] as string }),
          ...(changes['systemPrompt'] !== undefined && { systemPrompt: changes['systemPrompt'] as string }),
          ...(changes['tags'] !== undefined && { tags: changes['tags'] as string[] }),
          ...(changes['enabled'] !== undefined && { enabled: changes['enabled'] as boolean }),
          createdBy: proposal.createdBy,
          changelogNote: proposal.summary,
        });
        evolutionStore.markApplied(id, updatedSkill.version);
        return reply.send({ proposal: evolutionStore.getById(id), skill: updatedSkill });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendError(reply, 500, 'APPLY_FAILED', `Failed to apply proposal: ${msg}`);
    }
  });

  // GET /api/skills/evolution/proposals/:id
  app.get('/api/skills/evolution/proposals/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const proposal = evolutionStore.getById(id);
    if (!proposal) return sendError(reply, 404, 'NOT_FOUND', `Proposal "${id}" not found`);
    return reply.send(proposal);
  });

  // ── Skill version routes (under /api/skills/:id/versions) ─────────────────

  // POST /api/skills/:id/versions/:version/restore — must be registered before GET
  app.post('/api/skills/:id/versions/:version/restore', async (req, reply) => {
    const allowed = await guardCheck({ guard, reply, operation: 'skill:write', source: 'user', approvalManager });
    if (!allowed) return;

    const { id, version } = req.params as { id: string; version: string };
    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum)) return sendError(reply, 400, 'VALIDATION_ERROR', 'version must be a number');

    const versionRecord = versionStore.getByVersion(id, versionNum);
    if (!versionRecord) return sendError(reply, 404, 'NOT_FOUND', `Version ${versionNum} for skill "${id}" not found`);

    const snapshot = versionRecord.snapshot as Record<string, unknown>;
    try {
      const restored = skillRegistry.update(id, {
        name: snapshot['name'] as string | undefined,
        description: snapshot['description'] as string | undefined,
        systemPrompt: snapshot['systemPrompt'] as string | undefined,
        tags: snapshot['tags'] as string[] | undefined,
        changelogNote: `Restored from version ${versionNum}`,
      });
      return reply.send({ skill: restored, restoredFromVersion: versionNum });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendError(reply, 500, 'RESTORE_FAILED', `Failed to restore: ${msg}`);
    }
  });

  // GET /api/skills/:id/versions
  app.get('/api/skills/:id/versions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const versions = versionStore.list(id);
    return reply.send({ versions });
  });

  // GET /api/skills/:id/versions/:version
  app.get('/api/skills/:id/versions/:version', async (req, reply) => {
    const { id, version } = req.params as { id: string; version: string };
    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum)) return sendError(reply, 400, 'VALIDATION_ERROR', 'version must be a number');
    const record = versionStore.getByVersion(id, versionNum);
    if (!record) return sendError(reply, 404, 'NOT_FOUND', `Version ${versionNum} for skill "${id}" not found`);
    return reply.send(record);
  });
}
