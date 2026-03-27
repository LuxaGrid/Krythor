// ─── Per-agent auth profile routes ───────────────────────────────────────────
//
// GET    /api/agents/:agentId/auth                    — list profiles
// GET    /api/agents/:agentId/auth/:name              — get profile (token masked)
// PUT    /api/agents/:agentId/auth/:name              — upsert profile
// DELETE /api/agents/:agentId/auth/:name              — remove profile
// GET    /api/agents/:agentId/auth/:name/valid        — check if token is valid/not expired
//

import type { FastifyInstance } from 'fastify';
import type { AgentAuthProfileStore, AuthProfile } from '@krythor/core';

/** Mask the access token in API responses — never expose raw tokens. */
function maskProfile(p: AuthProfile): Omit<AuthProfile, 'accessToken' | 'refreshToken'> & { hasToken: boolean; hasRefreshToken: boolean } {
  const { accessToken: _at, refreshToken: _rt, ...safe } = p;
  return { ...safe, hasToken: !!_at, hasRefreshToken: !!_rt };
}

export function registerAgentAuthRoutes(app: FastifyInstance, store: AgentAuthProfileStore): void {

  // GET /api/agents/:agentId/auth
  app.get<{ Params: { agentId: string } }>('/api/agents/:agentId/auth', async (req, reply) => {
    const { agentId } = req.params;
    const { profiles } = store.load(agentId);
    return reply.send({ profiles: profiles.map(maskProfile) });
  });

  // GET /api/agents/:agentId/auth/:name
  app.get<{ Params: { agentId: string; name: string } }>('/api/agents/:agentId/auth/:name', async (req, reply) => {
    const { agentId, name } = req.params;
    const profile = store.get(agentId, name);
    if (!profile) return reply.code(404).send({ error: `Profile "${name}" not found for agent "${agentId}"` });
    return reply.send({ profile: maskProfile(profile) });
  });

  // GET /api/agents/:agentId/auth/:name/valid
  app.get<{ Params: { agentId: string; name: string } }>('/api/agents/:agentId/auth/:name/valid', async (req, reply) => {
    const { agentId, name } = req.params;
    const valid = store.isValid(agentId, name);
    return reply.send({ valid });
  });

  // PUT /api/agents/:agentId/auth/:name
  app.put<{
    Params: { agentId: string; name: string };
    Body: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      displayName?: string;
      meta?: Record<string, unknown>;
    };
  }>('/api/agents/:agentId/auth/:name', {
    schema: {
      body: {
        type: 'object',
        required: ['accessToken'],
        properties: {
          accessToken:  { type: 'string', minLength: 1, maxLength: 4096 },
          refreshToken: { type: 'string', maxLength: 4096 },
          expiresAt:    { type: 'number' },
          displayName:  { type: 'string', maxLength: 256 },
          meta:         { type: 'object' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { agentId, name } = req.params;
    const { accessToken, refreshToken, expiresAt, displayName, meta } = req.body;
    const profile: AuthProfile = {
      name,
      accessToken,
      ...(refreshToken && { refreshToken }),
      expiresAt: expiresAt ?? 0,
      displayName,
      connectedAt: new Date().toISOString(),
      ...(meta && { meta }),
    };
    store.upsert(agentId, profile);
    return reply.send({ ok: true, profile: maskProfile(profile) });
  });

  // DELETE /api/agents/:agentId/auth/:name
  app.delete<{ Params: { agentId: string; name: string } }>('/api/agents/:agentId/auth/:name', async (req, reply) => {
    const { agentId, name } = req.params;
    store.remove(agentId, name);
    return reply.send({ ok: true });
  });
}
