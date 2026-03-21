/**
 * Config export / import routes — ITEM 5
 *
 * GET  /api/config/export  — returns sanitized providers config (no API keys or OAuth tokens)
 * POST /api/config/import  — validates, merges providers by id (update existing, add new)
 *
 * The sanitized export replaces apiKey values with "***" and omits oauthToken fields.
 * Import validates the schema first; invalid entries are rejected (not silently skipped).
 */

import type { FastifyInstance } from 'fastify';
import type { ModelEngine, ProviderConfig } from '@krythor/models';
import { parseProviderList } from '@krythor/models';
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
      const isPlaceholderKey = (incoming as Record<string, unknown>)['apiKey'] === '***';

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
}
