/**
 * Operating Profiles routes
 *
 * GET    /api/profiles               — list all profiles
 * POST   /api/profiles               — create profile
 * GET    /api/profiles/active        — get active profile (query: ?contextId=global|agentId)
 * POST   /api/profiles/activate      — activate profile (body: { profileId, contextId })
 * GET    /api/profiles/:id           — get profile detail
 * PATCH  /api/profiles/:id           — update profile
 * DELETE /api/profiles/:id           — delete profile (cannot delete active profile)
 *
 * IMPORTANT: static routes registered before /:id
 */

import type { FastifyInstance } from 'fastify';
import type { GuardEngine } from '@krythor/guard';
import { sendError } from '../errors.js';
import type { ApprovalManager } from '../ApprovalManager.js';
import { guardCheck } from '../guardCheck.js';
import type { OperatingProfileStore, CreateProfileInput } from '../OperatingProfileStore.js';

export function registerProfileRoutes(
  app: FastifyInstance,
  profileStore: OperatingProfileStore,
  guard: GuardEngine,
  approvalManager?: ApprovalManager,
): void {
  // ── Static routes BEFORE /:id ──────────────────────────────────────────

  // GET /api/profiles/active
  app.get('/api/profiles/active', async (req, reply) => {
    const query = req.query as { contextId?: string };
    const contextId = query.contextId ?? 'global';
    const profileId = profileStore.getActive(contextId);
    if (!profileId) {
      return reply.send({ active: null });
    }
    const profile = profileStore.getById(profileId);
    return reply.send({ active: profile ?? null, profileId });
  });

  // POST /api/profiles/activate
  app.post('/api/profiles/activate', async (req, reply) => {
    const allowed = await guardCheck({ guard, reply, operation: 'skill:write', source: 'user', approvalManager });
    if (!allowed) return;

    const body = req.body as { profileId: string; contextId?: string; contextType?: string };
    if (!body.profileId) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'profileId is required');
    }
    const profile = profileStore.getById(body.profileId);
    if (!profile) return sendError(reply, 404, 'NOT_FOUND', `Profile "${body.profileId}" not found`);
    if (profile.status === 'inactive') {
      return sendError(reply, 400, 'INVALID_OPERATION', 'Cannot activate an inactive profile');
    }
    const contextId = body.contextId ?? 'global';
    profileStore.setActive(contextId, body.profileId, body.contextType ?? 'agent');
    return reply.send({ ok: true, activeProfileId: body.profileId, contextId, profile });
  });

  // GET /api/profiles
  app.get('/api/profiles', async (req, reply) => {
    const query = req.query as { activeOnly?: string };
    const profiles = profileStore.list(query.activeOnly === 'true');
    return reply.send({ profiles });
  });

  // POST /api/profiles
  app.post('/api/profiles', async (req, reply) => {
    const allowed = await guardCheck({ guard, reply, operation: 'skill:write', source: 'user', approvalManager });
    if (!allowed) return;

    const body = req.body as Partial<CreateProfileInput>;
    if (!body.name || !body.slug) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'name and slug are required');
    }
    // Validate slug is URL-safe
    if (!/^[a-z0-9-_]+$/.test(body.slug)) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'slug must contain only lowercase letters, digits, hyphens, and underscores');
    }
    // Check slug uniqueness
    const existing = profileStore.getBySlug(body.slug);
    if (existing) {
      return sendError(reply, 409, 'CONFLICT', `A profile with slug "${body.slug}" already exists`);
    }
    const profile = profileStore.create(body as CreateProfileInput);
    return reply.code(201).send(profile);
  });

  // ── Parameterized routes AFTER static ones ──────────────────────────────

  // GET /api/profiles/:id
  app.get('/api/profiles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    // Support lookup by slug too
    const profile = profileStore.getById(id) ?? profileStore.getBySlug(id);
    if (!profile) return sendError(reply, 404, 'NOT_FOUND', `Profile "${id}" not found`);
    return reply.send(profile);
  });

  // PATCH /api/profiles/:id
  app.patch('/api/profiles/:id', async (req, reply) => {
    const allowed = await guardCheck({ guard, reply, operation: 'skill:write', source: 'user', approvalManager });
    if (!allowed) return;

    const { id } = req.params as { id: string };
    const body = req.body as Partial<CreateProfileInput>;
    // Validate slug if being changed
    if (body.slug !== undefined) {
      if (!/^[a-z0-9-_]+$/.test(body.slug)) {
        return sendError(reply, 400, 'VALIDATION_ERROR', 'slug must contain only lowercase letters, digits, hyphens, and underscores');
      }
      const existingWithSlug = profileStore.getBySlug(body.slug);
      if (existingWithSlug && existingWithSlug.id !== id) {
        return sendError(reply, 409, 'CONFLICT', `A profile with slug "${body.slug}" already exists`);
      }
    }
    try {
      const updated = profileStore.update(id, body);
      return reply.send(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) return sendError(reply, 404, 'NOT_FOUND', msg);
      return sendError(reply, 500, 'INTERNAL_ERROR', msg);
    }
  });

  // DELETE /api/profiles/:id
  app.delete('/api/profiles/:id', async (req, reply) => {
    const allowed = await guardCheck({ guard, reply, operation: 'skill:write', source: 'user', approvalManager });
    if (!allowed) return;

    const { id } = req.params as { id: string };
    const profile = profileStore.getById(id);
    if (!profile) return sendError(reply, 404, 'NOT_FOUND', `Profile "${id}" not found`);

    // Cannot delete an active profile
    const globalActive = profileStore.getActive('global');
    if (globalActive === id) {
      return sendError(reply, 409, 'CONFLICT', 'Cannot delete the currently active global profile. Activate another profile first.');
    }

    profileStore.delete(id);
    return reply.code(204).send();
  });
}
