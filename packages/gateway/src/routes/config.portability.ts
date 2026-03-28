/**
 * Config export / import routes — ITEM 5
 *
 * GET  /api/config/export  — returns sanitized providers config (no API keys or OAuth tokens)
 * POST /api/config/import  — validates, merges providers by id (update existing, add new)
 *
 * The sanitized export replaces apiKey values with "***" and omits oauthToken fields.
 * Import validates the schema first; invalid entries are rejected (not silently skipped).
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { FastifyInstance } from 'fastify';
import type { ModelEngine, ProviderConfig } from '@krythor/models';
import { parseProviderList } from '@krythor/models';
import type { AgentOrchestrator } from '@krythor/core';
import type { GuardEngine } from '@krythor/guard';
import type { SkillRegistry } from '@krythor/skills';
import { logger } from '../logger.js';

/** Build a sanitized (no-secrets) copy of a provider config for export. */
function sanitizeProvider(p: ProviderConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id:         p.id,
    name:       p.name,
    type:       p.type,
    endpoint:   p.endpoint,
    authMethod: p.authMethod,
    isDefault:  p.isDefault,
    isEnabled:  p.isEnabled,
    models:     p.models,
  };

  // Replace API key with placeholder — never export the real key
  if (p.apiKey !== undefined) {
    out['apiKey'] = '***';
  }

  // Omit oauthAccount entirely — tokens must never be exported
  // (oauthToken is excluded by not including it in out)

  if (p.setupHint) out['setupHint'] = p.setupHint;

  return out;
}

export function registerConfigPortabilityRoutes(
  app: FastifyInstance,
  models: ModelEngine,
  orchestrator?: AgentOrchestrator,
  guard?: GuardEngine,
  skillRegistry?: SkillRegistry,
  configDir?: string,
): void {

  // ── GET /api/config/export ─────────────────────────────────────────────────
  // Returns sanitized providers config. Auth required (wired via server-level hook).
  app.get('/api/config/export', async (_req, reply) => {
    const providers = models.listProviders().map(sanitizeProvider);
    return reply.send({
      version:   '1',
      exportedAt: new Date().toISOString(),
      providers,
      note:      'API keys are masked (***). OAuth tokens are omitted. Re-enter credentials after import.',
    });
  });

  // ── POST /api/config/import ────────────────────────────────────────────────
  // Accepts a config JSON body, validates schema, merges providers by id.
  // Update existing providers, add new ones. Auth required.
  app.post('/api/config/import', {
    schema: {
      body: {
        type: 'object',
        required: ['providers'],
        properties: {
          version:   { type: 'string' },
          providers: { type: 'array' },
        },
        additionalProperties: true,
      },
    },
  }, async (req, reply) => {
    const body = req.body as { version?: string; providers: unknown[] };

    if (!Array.isArray(body.providers)) {
      return reply.code(400).send({
        ok:    false,
        error: 'INVALID_IMPORT',
        message: 'body.providers must be an array',
      });
    }

    // Validate the incoming provider list
    const parsed = parseProviderList({ version: body.version ?? '1', providers: body.providers });

    if (parsed.errors.length > 0 && parsed.providers.length === 0) {
      return reply.code(400).send({
        ok:               false,
        error:            'VALIDATION_FAILED',
        message:          'No valid providers in import payload',
        validationErrors: parsed.errors,
      });
    }

    const existing = models.listProviders();
    const existingById = new Map(existing.map(p => [p.id, p]));

    let updated = 0;
    let added   = 0;
    const skipped: string[] = [];

    for (const incoming of parsed.providers) {
      // Providers exported with "***" for apiKey must not overwrite real keys
      const isPlaceholderKey = (incoming as unknown as Record<string, unknown>)['apiKey'] === '***';

      if (existingById.has(incoming.id)) {
        // Update existing — but never overwrite credentials with placeholders
        const updates: Partial<Omit<ProviderConfig, 'id'>> = {
          name:      incoming.name,
          type:      incoming.type,
          endpoint:  incoming.endpoint,
          isEnabled: incoming.isEnabled,
          isDefault: incoming.isDefault,
          models:    incoming.models,
          setupHint: incoming.setupHint,
        };
        if (!isPlaceholderKey && incoming.apiKey) {
          updates.apiKey = incoming.apiKey;
          updates.authMethod = incoming.authMethod;
        }
        try {
          models.updateProvider(incoming.id, updates);
          updated++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          skipped.push(`${incoming.name}: ${msg}`);
          logger.warn('ConfigImport: failed to update provider', { providerId: incoming.id, error: msg });
        }
      } else {
        // Add new provider — strip placeholder key
        const newEntry: Omit<ProviderConfig, 'id'> = {
          name:       incoming.name,
          type:       incoming.type,
          endpoint:   incoming.endpoint,
          authMethod: isPlaceholderKey ? 'none' : incoming.authMethod,
          apiKey:     isPlaceholderKey ? undefined : incoming.apiKey,
          isDefault:  incoming.isDefault,
          isEnabled:  incoming.isEnabled,
          models:     incoming.models,
          setupHint:  incoming.setupHint,
        };
        try {
          models.addProvider(newEntry);
          added++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          skipped.push(`${incoming.name}: ${msg}`);
          logger.warn('ConfigImport: failed to add provider', { providerName: incoming.name, error: msg });
        }
      }
    }

    logger.info('ConfigImport: import completed', {
      updated,
      added,
      skipped: skipped.length,
      validationErrors: parsed.errors.length,
    });

    return reply.send({
      ok:               true,
      updated,
      added,
      skipped,
      validationErrors: parsed.errors,
      message:          `Import complete: ${updated} updated, ${added} added${skipped.length > 0 ? `, ${skipped.length} failed` : ''}.`,
    });
  });

  // ── GET /api/config/export/full ────────────────────────────────────────────
  // Exports a complete snapshot of system config: agents, guard policies,
  // access profiles, cron jobs, channels, skills, and app-config.
  app.get('/api/config/export/full', async (_req, reply) => {
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      krythorFullExport: '1',
      exportedAt:        now,
      version:           '1',
    };

    // App config (no secrets)
    if (configDir) {
      try {
        const appCfgPath = join(configDir, 'app-config.json');
        if (existsSync(appCfgPath)) {
          const raw = JSON.parse(readFileSync(appCfgPath, 'utf-8')) as Record<string, unknown>;
          // Redact sensitive keys
          const safe = { ...raw };
          delete safe['webhookToken'];
          payload['appConfig'] = safe;
        }
      } catch { /* best-effort */ }
    }

    // Agents
    if (orchestrator) {
      payload['agents'] = orchestrator.listAgents();
    }

    // Guard policies
    if (guard) {
      try {
        payload['guardPolicies'] = guard.getPolicy();
      } catch { /* best-effort */ }
    }

    // Access profiles
    if (configDir) {
      try {
        const profilesPath = join(configDir, 'access-profiles.json');
        if (existsSync(profilesPath)) {
          payload['accessProfiles'] = JSON.parse(readFileSync(profilesPath, 'utf-8'));
        }
      } catch { /* best-effort */ }
    }

    // Cron jobs
    if (configDir) {
      try {
        const cronPath = join(configDir, 'cron.json');
        if (existsSync(cronPath)) {
          payload['cronJobs'] = JSON.parse(readFileSync(cronPath, 'utf-8'));
        }
      } catch { /* best-effort */ }
    }

    // Channels
    if (configDir) {
      try {
        const channelsPath = join(configDir, 'channels.json');
        if (existsSync(channelsPath)) {
          payload['channels'] = JSON.parse(readFileSync(channelsPath, 'utf-8'));
        }
      } catch { /* best-effort */ }
    }

    // Skills
    if (skillRegistry) {
      try {
        payload['skills'] = skillRegistry.list();
      } catch { /* best-effort */ }
    }

    // Providers (sanitized)
    payload['providers'] = models.listProviders().map(sanitizeProvider);

    return reply.send(payload);
  });

  // ── POST /api/config/import/full ───────────────────────────────────────────
  // Accepts a full export payload and imports selected sections.
  // Supports ?dryRun=true for validation-only mode.
  // Per-section flags in body: importAgents, importPolicies, importProfiles,
  //   importCrons, importChannels, importSkills, importProviders (all default true).
  app.post<{
    Querystring: { dryRun?: string };
  }>('/api/config/import/full', {
    schema: {
      body: {
        type: 'object',
        properties: {
          krythorFullExport: { type: 'string' },
          version:           { type: 'string' },
          agents:            { type: 'array' },
          guardPolicies:     { type: 'object' },
          accessProfiles:    { type: 'object' },
          cronJobs:          { type: 'array' },
          channels:          { type: 'array' },
          skills:            { type: 'array' },
          providers:         { type: 'array' },
          // Per-section import flags (all default true)
          importAgents:      { type: 'boolean' },
          importPolicies:    { type: 'boolean' },
          importProfiles:    { type: 'boolean' },
          importCrons:       { type: 'boolean' },
          importChannels:    { type: 'boolean' },
          importSkills:      { type: 'boolean' },
          importProviders:   { type: 'boolean' },
        },
        additionalProperties: true,
      },
    },
  }, async (req, reply) => {
    const dryRun = req.query.dryRun === 'true';
    const body = req.body as Record<string, unknown>;

    const result: {
      imported: Record<string, number>;
      skipped: string[];
      errors: string[];
      dryRun: boolean;
    } = {
      imported: {},
      skipped:  [],
      errors:   [],
      dryRun,
    };

    const flag = (key: string): boolean =>
      body[key] === undefined ? true : body[key] === true;

    // ── Agents ────────────────────────────────────────────────────────────
    if (flag('importAgents') && orchestrator && Array.isArray(body['agents'])) {
      let n = 0;
      for (const a of body['agents'] as Record<string, unknown>[]) {
        if (!a['id'] || !a['name'] || !a['systemPrompt']) {
          result.errors.push(`Agent skipped: missing id/name/systemPrompt`);
          continue;
        }
        if (!dryRun) {
          try {
            const existing = orchestrator.getAgent(String(a['id']));
            if (existing) {
              orchestrator.updateAgent(String(a['id']), a as unknown as Parameters<typeof orchestrator.updateAgent>[1]);
            } else {
              orchestrator.createAgent(a as unknown as Parameters<typeof orchestrator.createAgent>[0]);
            }
            n++;
          } catch (err) {
            result.errors.push(`Agent "${a['id']}": ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          n++;
        }
      }
      result.imported['agents'] = n;
    }

    // ── Guard policies ────────────────────────────────────────────────────
    if (flag('importPolicies') && guard && configDir && body['guardPolicies'] && typeof body['guardPolicies'] === 'object') {
      if (!dryRun) {
        try {
          const policyPath = join(configDir, 'policy.json');
          writeFileSync(policyPath, JSON.stringify(body['guardPolicies'], null, 2) + '\n', 'utf-8');
          result.imported['policies'] = 1;
        } catch (err) {
          result.errors.push(`Guard policies: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        result.imported['policies'] = 1;
      }
    }

    // ── Access profiles ───────────────────────────────────────────────────
    if (flag('importProfiles') && configDir && body['accessProfiles'] && typeof body['accessProfiles'] === 'object') {
      if (!dryRun) {
        try {
          const profilesPath = join(configDir, 'access-profiles.json');
          writeFileSync(profilesPath, JSON.stringify(body['accessProfiles'], null, 2) + '\n', 'utf-8');
          result.imported['profiles'] = Object.keys(body['accessProfiles'] as object).length;
        } catch (err) {
          result.errors.push(`Access profiles: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        result.imported['profiles'] = Object.keys(body['accessProfiles'] as object).length;
      }
    }

    // ── Cron jobs ─────────────────────────────────────────────────────────
    if (flag('importCrons') && configDir && Array.isArray(body['cronJobs'])) {
      if (!dryRun) {
        try {
          const cronPath = join(configDir, 'cron.json');
          writeFileSync(cronPath, JSON.stringify(body['cronJobs'], null, 2) + '\n', 'utf-8');
          result.imported['crons'] = (body['cronJobs'] as unknown[]).length;
        } catch (err) {
          result.errors.push(`Cron jobs: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        result.imported['crons'] = (body['cronJobs'] as unknown[]).length;
      }
    }

    // ── Channels ──────────────────────────────────────────────────────────
    if (flag('importChannels') && configDir && Array.isArray(body['channels'])) {
      if (!dryRun) {
        try {
          const channelsPath = join(configDir, 'channels.json');
          writeFileSync(channelsPath, JSON.stringify(body['channels'], null, 2) + '\n', 'utf-8');
          result.imported['channels'] = (body['channels'] as unknown[]).length;
        } catch (err) {
          result.errors.push(`Channels: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        result.imported['channels'] = (body['channels'] as unknown[]).length;
      }
    }

    // ── Skills ────────────────────────────────────────────────────────────
    if (flag('importSkills') && skillRegistry && Array.isArray(body['skills'])) {
      let n = 0;
      for (const s of body['skills'] as Record<string, unknown>[]) {
        if (!dryRun) {
          try {
            // Skills are read from disk; write the skill definition file
            if (configDir && s['id'] && s['name']) {
              const skillsDir = join(configDir, 'skills');
              const skillPath = join(skillsDir, `${String(s['id'])}.json`);
              // Ensure skills directory exists
              try {
                const { mkdirSync } = await import('fs');
                mkdirSync(skillsDir, { recursive: true });
              } catch { /* ok if exists */ }
              writeFileSync(skillPath, JSON.stringify(s, null, 2) + '\n', 'utf-8');
              n++;
            }
          } catch (err) {
            result.errors.push(`Skill "${s['id']}": ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          n++;
        }
      }
      result.imported['skills'] = n;
    }

    logger.info('FullConfigImport completed', { dryRun, imported: result.imported, errors: result.errors.length });
    return reply.send(result);
  });
}
