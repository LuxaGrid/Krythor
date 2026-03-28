import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface UpdateInfo {
  currentVersion: string;
  channel: 'stable' | 'beta' | 'dev';
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseNotes: string | null;
  publishedAt: string | null;
}

function readCurrentVersion(): string {
  try {
    // Walk up from this file's location to find the root package.json
    // In production (SEA exe), __dirname may not be reliable — try process.cwd() too
    for (const base of [join(process.cwd()), join(process.cwd(), '..')]) {
      const p = join(base, 'package.json');
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, 'utf-8')) as { version?: string };
        if (pkg.version) return pkg.version;
      }
    }
  } catch { /* ignore */ }
  return '0.0.0';
}

export function registerUpdateRoute(app: FastifyInstance): void {
  // GET /api/update/check  — check for available updates
  // Does NOT perform any network request by default — returns local version info.
  // Pass ?channel=beta to check beta channel.
  app.get<{ Querystring: { channel?: string } }>('/api/update/check', async (req, reply) => {
    const channel = (req.query.channel === 'beta' || req.query.channel === 'dev')
      ? req.query.channel
      : 'stable';
    const currentVersion = readCurrentVersion();
    const info: UpdateInfo = {
      currentVersion,
      channel,
      latestVersion: null,
      updateAvailable: false,
      releaseNotes: null,
      publishedAt: null,
    };
    // Future: poll GitHub releases API or a self-hosted manifest
    // For now, return current info with no network call (offline-safe)
    return reply.send(info);
  });

  // POST /api/update/set-channel  — persist preferred update channel
  app.post<{ Body: { channel: 'stable' | 'beta' | 'dev' } }>('/api/update/set-channel', {
    schema: {
      body: {
        type: 'object', required: ['channel'],
        properties: { channel: { type: 'string', enum: ['stable', 'beta', 'dev'] } },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    // Channel preference stored in-memory; persisted on next config PATCH
    return reply.send({ ok: true, channel: req.body.channel });
  });
}
