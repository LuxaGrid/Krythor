// ─── Vault routes ─────────────────────────────────────────────────────────────
//
// GET  /api/vault/catalog          — list available skills from vault manifest
// GET  /api/vault/installed        — list locally installed vault skills
// POST /api/vault/install          — install a skill from the vault catalog
// POST /api/vault/install/local    — import a skill from a local JSON payload
// DELETE /api/vault/installed/:id  — remove an installed vault skill
// POST /api/vault/update/:id       — update an installed skill to latest version
//
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { FastifyInstance } from 'fastify';
import type { SkillRegistry, CreateSkillInput } from '@krythor/skills';
import type { GuardEngine } from '@krythor/guard';
import type { ApprovalManager } from '../ApprovalManager.js';
import { guardCheck } from '../guardCheck.js';
import { sendError } from '../errors.js';
import { logger } from '../logger.js';
import type { VaultRegistry } from '../VaultRegistry.js';
import type { VaultManifest, InstalledVaultSkill } from '../VaultRegistry.js';

// Risk classification derived from declared permissions
function classifyRisk(permissions: string[]): 'low' | 'medium' | 'high' {
  if (
    permissions.includes('shell:exec') ||
    permissions.includes('file:write') ||
    permissions.includes('file:delete') ||
    permissions.includes('webhook:call')
  ) return 'high';
  if (
    permissions.includes('internet:read') ||
    permissions.includes('memory:write') ||
    permissions.includes('skill:invoke')
  ) return 'medium';
  return 'low';
}

// Resolve the vault root — walks up from __dirname to find the vault/ directory
function resolveVaultRoot(): string | null {
  // Binary install: ~/.krythor/vault (deployed by deploy-dist.js)
  // Dev: repo root vault/ — walked up 4 levels from dist/routes/vault.js
  const homeVault = resolve(
    process.env['HOME'] ?? process.env['USERPROFILE'] ?? '',
    '.krythor',
    'vault',
  );
  const candidates = [
    homeVault,
    resolve(__dirname, '..', '..', '..', '..', 'vault'),
    resolve(__dirname, '..', '..', '..', 'vault'),
    resolve(__dirname, '..', '..', 'vault'),
    resolve(process.cwd(), 'vault'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'vault.manifest.json'))) return c;
  }
  return null;
}

function loadManifest(vaultRoot: string): VaultManifest | null {
  const p = join(vaultRoot, 'vault.manifest.json');
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as VaultManifest;
  } catch {
    return null;
  }
}

function loadSkillPackage(vaultRoot: string, path: string): Record<string, unknown> | null {
  try {
    // path is relative to vault root, sanitize it
    const safe = join(vaultRoot, path.replace(/\.\./g, ''));
    if (!safe.startsWith(vaultRoot)) return null;
    return JSON.parse(readFileSync(safe, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function manifestEntryToCreateInput(pkg: Record<string, unknown>): CreateSkillInput {
  return {
    name:         String(pkg['name'] ?? ''),
    description:  String(pkg['description'] ?? ''),
    systemPrompt: String(pkg['systemPrompt'] ?? ''),
    tags:         Array.isArray(pkg['tags']) ? pkg['tags'].map(String) : [],
    permissions:  Array.isArray(pkg['permissions']) ? pkg['permissions'].map(String) as CreateSkillInput['permissions'] : [],
    enabled:      pkg['enabled'] !== false,
    userInvocable: pkg['userInvocable'] !== false,
  };
}

export function registerVaultRoutes(
  app: FastifyInstance,
  skills: SkillRegistry,
  vaultRegistry: VaultRegistry,
  guard: GuardEngine,
  approvalManager?: ApprovalManager,
): void {

  // GET /api/vault/catalog — return available skills, enriched with install state
  app.get('/api/vault/catalog', async (_req, reply) => {
    const vaultRoot = resolveVaultRoot();
    if (!vaultRoot) {
      return reply.send({ skills: [], updatable: [], note: 'Vault catalog not found on this installation.' });
    }
    const manifest = loadManifest(vaultRoot);
    if (!manifest) {
      return reply.send({ skills: [], updatable: [], note: 'vault.manifest.json could not be parsed.' });
    }

    const installed = vaultRegistry.listInstalled();
    const installedMap = new Map(installed.map(i => [i.vaultId, i]));
    const updatable = vaultRegistry.findUpdatable(manifest.skills);

    const enriched = manifest.skills.map(entry => ({
      ...entry,
      risk:      classifyRisk(entry.permissions),
      installed: installedMap.has(entry.id),
      skillId:   installedMap.get(entry.id)?.skillId ?? null,
      updateAvailable: updatable.includes(entry.id),
    }));

    return reply.send({
      manifestVersion: manifest.manifestVersion,
      updatedAt:       manifest.updatedAt,
      skills:          enriched,
      updatable,
      collections:     manifest.collections ?? [],
    });
  });

  // GET /api/vault/installed — list installed vault skills
  app.get('/api/vault/installed', async (_req, reply) => {
    return reply.send(vaultRegistry.listInstalled());
  });

  // POST /api/vault/install — install a skill from the catalog
  app.post<{ Body: { vaultId: string } }>('/api/vault/install', {
    schema: {
      body: {
        type: 'object',
        required: ['vaultId'],
        properties: { vaultId: { type: 'string' } },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'skill:create', source: 'user' });
    if (!allowed) return;

    const { vaultId } = req.body;

    if (vaultRegistry.isInstalled(vaultId)) {
      return sendError(reply, 409, 'ALREADY_INSTALLED', 'Skill is already installed', 'Use the update endpoint to upgrade to a newer version.');
    }

    const vaultRoot = resolveVaultRoot();
    const manifest  = vaultRoot ? loadManifest(vaultRoot) : null;
    const entry     = manifest?.skills.find(s => s.id === vaultId);

    if (!entry) {
      return sendError(reply, 404, 'NOT_FOUND', `Vault skill "${vaultId}" not found in catalog`);
    }

    const pkg = vaultRoot ? loadSkillPackage(vaultRoot, entry.path) : null;
    if (!pkg) {
      return sendError(reply, 500, 'LOAD_FAILED', 'Failed to load skill package from vault');
    }

    let skill;
    try {
      skill = skills.create(manifestEntryToCreateInput(pkg));
    } catch (err) {
      logger.error('[vault] skill create failed', { vaultId, error: err instanceof Error ? err.message : String(err) });
      return sendError(reply, 500, 'INSTALL_FAILED', 'Failed to create skill');
    }

    const record: InstalledVaultSkill = {
      vaultId:         entry.id,
      skillId:         skill.id,
      name:            entry.name,
      version:         entry.version,
      source:          entry.source,
      author:          entry.author,
      category:        entry.category,
      permissions:     entry.permissions,
      risk:            classifyRisk(entry.permissions),
      installedAt:     Date.now(),
      manifestVersion: manifest?.manifestVersion ?? '1',
    };
    vaultRegistry.record(record);

    logger.info('[vault] skill installed', { vaultId, skillId: skill.id, name: entry.name });
    return reply.code(201).send({ ok: true, skill, vaultRecord: record });
  });

  // POST /api/vault/install/local — import skill from JSON body
  app.post<{ Body: Record<string, unknown> }>('/api/vault/install/local', {
    schema: {
      body: { type: 'object', additionalProperties: true },
    },
  }, async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'skill:create', source: 'user' });
    if (!allowed) return;

    const pkg = req.body;
    const name = String(pkg['name'] ?? '').trim();
    if (!name) return sendError(reply, 400, 'INVALID', 'Skill must have a name');
    if (!pkg['systemPrompt']) return sendError(reply, 400, 'INVALID', 'Skill must have a systemPrompt');

    let skill;
    try {
      skill = skills.create(manifestEntryToCreateInput(pkg));
    } catch (err) {
      return sendError(reply, 500, 'INSTALL_FAILED', err instanceof Error ? err.message : 'Failed to create skill');
    }

    // Record as a community import with a generated vault ID
    const vaultId = `local-${skill.id}`;
    const record: InstalledVaultSkill = {
      vaultId,
      skillId:         skill.id,
      name:            skill.name,
      version:         String(pkg['version'] ?? '1.0.0'),
      source:          'community',
      author:          String(pkg['author'] ?? 'local'),
      category:        String(pkg['category'] ?? 'Imported'),
      permissions:     Array.isArray(pkg['permissions']) ? pkg['permissions'].map(String) : [],
      risk:            classifyRisk(Array.isArray(pkg['permissions']) ? pkg['permissions'].map(String) : []),
      installedAt:     Date.now(),
      manifestVersion: '0',
    };
    vaultRegistry.record(record);

    logger.info('[vault] local skill imported', { vaultId, skillId: skill.id, name: skill.name });
    return reply.code(201).send({ ok: true, skill, vaultRecord: record });
  });

  // DELETE /api/vault/installed/:id — remove an installed vault skill
  app.delete<{ Params: { id: string } }>('/api/vault/installed/:id', async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'skill:delete', source: 'user' });
    if (!allowed) return;

    const { id } = req.params;
    const record = vaultRegistry.getInstalled(id);
    if (!record) {
      return sendError(reply, 404, 'NOT_FOUND', `Vault skill "${id}" is not installed`);
    }

    // Remove from skill registry
    try { skills.delete(record.skillId); } catch { /* skill may have been manually deleted */ }

    vaultRegistry.remove(id);
    logger.info('[vault] skill removed', { vaultId: id, skillId: record.skillId });
    return reply.code(204).send();
  });

  // POST /api/vault/update/:id — update installed skill to latest catalog version
  app.post<{ Params: { id: string } }>('/api/vault/update/:id', async (req, reply) => {
    const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'skill:create', source: 'user' });
    if (!allowed) return;

    const { id } = req.params;
    const existing = vaultRegistry.getInstalled(id);
    if (!existing) {
      return sendError(reply, 404, 'NOT_FOUND', `Vault skill "${id}" is not installed`);
    }

    const vaultRoot = resolveVaultRoot();
    const manifest  = vaultRoot ? loadManifest(vaultRoot) : null;
    const entry     = manifest?.skills.find(s => s.id === id);
    if (!entry) {
      return sendError(reply, 404, 'NOT_FOUND', `Vault skill "${id}" not found in catalog`);
    }

    const pkg = vaultRoot ? loadSkillPackage(vaultRoot, entry.path) : null;
    if (!pkg) {
      return sendError(reply, 500, 'LOAD_FAILED', 'Failed to load skill package from vault');
    }

    // Update the existing skill in SkillRegistry
    let skill;
    try {
      skill = skills.update(existing.skillId, manifestEntryToCreateInput(pkg));
    } catch {
      // If the skill was manually deleted, recreate it
      try {
        skill = skills.create(manifestEntryToCreateInput(pkg));
      } catch (err) {
        return sendError(reply, 500, 'UPDATE_FAILED', err instanceof Error ? err.message : 'Failed to update skill');
      }
    }

    const updated: InstalledVaultSkill = {
      ...existing,
      skillId:         skill.id,
      version:         entry.version,
      installedAt:     existing.installedAt,
      manifestVersion: manifest?.manifestVersion ?? '1',
    };
    vaultRegistry.record(updated);

    logger.info('[vault] skill updated', { vaultId: id, skillId: skill.id, version: entry.version });
    return reply.send({ ok: true, skill, vaultRecord: updated });
  });
}
