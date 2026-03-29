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
  releaseUrl: string | null;
}

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/LuxaGrid/Krythor/releases';

function readCurrentVersion(): string {
  try {
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

function semverGt(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
}

// Simple in-memory cache — avoid hammering GitHub API on every UI load
let _cachedRelease: { data: GitHubRelease; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchLatestRelease(includePrereleases: boolean): Promise<GitHubRelease | null> {
  const now = Date.now();
  if (_cachedRelease && (now - _cachedRelease.fetchedAt) < CACHE_TTL_MS) {
    const r = _cachedRelease.data;
    if (!includePrereleases && r.prerelease) return null;
    return r;
  }

  try {
    const res = await fetch(`${GITHUB_RELEASES_URL}?per_page=10`, {
      headers: { 'User-Agent': 'Krythor-UpdateCheck/1.0', 'Accept': 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const releases = await res.json() as GitHubRelease[];
    const candidates = releases.filter(r =>
      !r.draft && (includePrereleases ? true : !r.prerelease)
    );
    if (candidates.length === 0) return null;

    const latest = candidates[0]!;
    _cachedRelease = { data: latest, fetchedAt: now };
    return latest;
  } catch {
    return null;
  }
}

export function registerUpdateRoute(app: FastifyInstance): void {
  // GET /api/update/check  — check GitHub Releases for a newer version
  // ?channel=beta  includes pre-releases
  // Cached for 5 minutes to avoid GitHub rate limits
  app.get<{ Querystring: { channel?: string } }>('/api/update/check', async (req, reply) => {
    const channel = (req.query.channel === 'beta' || req.query.channel === 'dev')
      ? req.query.channel
      : 'stable';
    const includePrereleases = channel !== 'stable';
    const currentVersion = readCurrentVersion();

    const latestRelease = await fetchLatestRelease(includePrereleases);
    const latestVersion = latestRelease ? latestRelease.tag_name.replace(/^v/, '') : null;
    const updateAvailable = latestVersion ? semverGt(latestVersion, currentVersion) : false;

    const info: UpdateInfo = {
      currentVersion,
      channel,
      latestVersion,
      updateAvailable,
      releaseNotes: latestRelease?.body ?? null,
      publishedAt:  latestRelease?.published_at ?? null,
      releaseUrl:   latestRelease?.html_url ?? null,
    };
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
    return reply.send({ ok: true, channel: req.body.channel });
  });
}
