// ─── Workspace routes ────────────────────────────────────────────────────────
//
// GET  /api/workspace        — workspace status (dir, files, sizes)
// POST /api/workspace/init   — (re-)initialise workspace files (missing only)
//
// These endpoints let the control UI show workspace health and allow
// the onboarding wizard to trigger workspace setup.
//

import type { FastifyInstance } from 'fastify';
import { existsSync, statSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AgentWorkspaceManager, WorkspaceBootstrapLoader, BOOTSTRAP_FILES_FULL, getDefaultWorkspaceDir } from '@krythor/core';

export function registerWorkspaceRoutes(app: FastifyInstance): void {
  // ── GET /api/workspace ────────────────────────────────────────────────────

  app.get('/api/workspace', async (_req, reply) => {
    const dir = getDefaultWorkspaceDir();
    const loader = new WorkspaceBootstrapLoader(dir);
    const result = loader.load('full');

    const files = result.files.map(f => ({
      name:          f.name,
      status:        f.status,
      rawChars:      f.rawChars,
      injectedChars: f.injectedChars,
    }));

    return reply.send({
      dir,
      exists: existsSync(dir),
      files,
      totalRawChars:      result.totalRawChars,
      totalInjectedChars: result.totalInjectedChars,
    });
  });

  // ── POST /api/workspace/init ─────────────────────────────────────────────

  app.post('/api/workspace/init', async (req, reply) => {
    const body = (req.body ?? {}) as { skipBootstrap?: boolean };
    const dir = getDefaultWorkspaceDir();
    const manager = new AgentWorkspaceManager(dir);
    manager.ensureWorkspace({ skipBootstrap: body.skipBootstrap ?? false });

    // Re-check status after init
    const loader = new WorkspaceBootstrapLoader(dir);
    const result = loader.load('full');

    return reply.send({
      ok: true,
      dir,
      files: result.files.map(f => ({ name: f.name, status: f.status })),
    });
  });

  // ── GET /api/workspace/file/:name ─────────────────────────────────────────

  app.get<{ Params: { name: string } }>('/api/workspace/file/:name', async (req, reply) => {
    const { name } = req.params;

    // Security: only allow known bootstrap file names
    const allowed: string[] = [...BOOTSTRAP_FILES_FULL, 'MEMORY.md', 'BOOT.md'];
    if (!allowed.includes(name)) {
      return reply.code(400).send({ error: `File "${name}" is not a managed workspace file` });
    }

    const dir = getDefaultWorkspaceDir();
    const filePath = join(dir, name);

    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: 'File not found' });
    }

    const content = readFileSync(filePath, 'utf-8');
    const stat = statSync(filePath);

    return reply.send({ name, content, sizeBytes: stat.size, updatedAt: stat.mtimeMs });
  });

  // ── PUT /api/workspace/file/:name ─────────────────────────────────────────

  app.put<{ Params: { name: string }; Body: { content: string } }>('/api/workspace/file/:name', async (req, reply) => {
    const { name } = req.params;
    const { content } = req.body ?? {};

    if (typeof content !== 'string') {
      return reply.code(400).send({ error: 'content must be a string' });
    }

    // Security: only allow known bootstrap file names
    const allowed: string[] = [...BOOTSTRAP_FILES_FULL, 'MEMORY.md', 'BOOT.md'];
    if (!allowed.includes(name)) {
      return reply.code(400).send({ error: `File "${name}" is not a managed workspace file` });
    }

    const dir = getDefaultWorkspaceDir();
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, name);
    writeFileSync(filePath, content, 'utf-8');

    return reply.send({ ok: true, name, sizeBytes: content.length });
  });
}
