import { join, resolve, normalize, sep } from 'path';
import {
  readFile,
  writeFile,
  rename,
  copyFile,
  rm,
  mkdir,
  readdir,
  stat,
} from 'fs/promises';
import type { FastifyInstance } from 'fastify';
import type { GuardEngine, OperationType } from '@krythor/guard';
import { sendError } from '../errors.js';
import { logger } from '../logger.js';
import { AccessProfileStore, makeAuditEntry } from '../AccessProfileStore.js';
import type { AccessProfile } from '../AccessProfileStore.js';

// ─── File Operation Tool Routes ────────────────────────────────────────────────
//
// All routes live under /api/tools/files/.
// Every operation is:
//   1. Guard-checked via guard.check({ operation: 'file:<op>', ... })
//   2. Path-validated against the agent's access profile
//   3. Logged to logger + appended to the audit log
//
// Access profiles:
//   safe        — workspace dir only (process.cwd()/workspace)
//   standard    — workspace + any non-system path
//   full_access — no path restrictions
//

// ─── System directory prefixes blocked in 'standard' mode ────────────────────
const SYSTEM_DIR_PREFIXES_UNIX: string[] = [
  '/etc',
  '/sys',
  '/proc',
  '/boot',
  '/dev',
  '/run',
  '/usr/lib',
  '/lib',
  '/lib64',
  '/sbin',
  '/bin',
];

const SYSTEM_DIR_PREFIXES_WIN: string[] = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\System32',
];

const MAX_READ_BYTES = 1_048_576; // 1 MB

// ─── Path validation ──────────────────────────────────────────────────────────

function workspaceDir(): string {
  return join(process.cwd(), 'workspace');
}

/**
 * Returns an error string if the resolved path is not permitted for the given
 * access profile, or undefined if it is allowed.
 */
function checkPathPermission(rawPath: string, profile: AccessProfile): string | undefined {
  // Resolve to absolute, normalize separators
  const resolved = resolve(normalize(rawPath));

  if (profile === 'full_access') {
    return undefined;
  }

  if (profile === 'safe') {
    const ws = workspaceDir();
    // Must be inside the workspace directory
    if (!isUnder(resolved, ws)) {
      return `Path '${rawPath}' is outside the workspace directory. Profile 'safe' restricts access to ${ws}`;
    }
    return undefined;
  }

  // standard — reject system directories
  if (process.platform === 'win32') {
    for (const prefix of SYSTEM_DIR_PREFIXES_WIN) {
      if (isUnder(resolved, prefix)) {
        return `Path '${rawPath}' is inside a protected system directory (${prefix}). Use profile 'full_access' to override.`;
      }
    }
  } else {
    for (const prefix of SYSTEM_DIR_PREFIXES_UNIX) {
      if (isUnder(resolved, prefix)) {
        return `Path '${rawPath}' is inside a protected system directory (${prefix}). Use profile 'full_access' to override.`;
      }
    }
  }
  return undefined;
}

/** Returns true if child is inside or equal to parent. */
function isUnder(child: string, parent: string): boolean {
  const parentNorm = parent.endsWith(sep) ? parent : parent + sep;
  return child === parent || child.startsWith(parentNorm);
}

// ─── Guard + profile gate ─────────────────────────────────────────────────────

type GateOk = { allowed: true };
type GateFail = { allowed: false; statusCode: number; code: string; message: string; hint?: string };
type GateResult = GateOk | GateFail;

async function gate(
  guard: GuardEngine,
  accessProfileStore: AccessProfileStore,
  operation: OperationType,
  rawPath: string,
  agentId: string,
): Promise<GateResult> {
  // 1. Guard check
  const verdict = guard.check({
    operation,
    source: 'agent',
    sourceId: agentId,
  });
  if (!verdict.allowed) {
    return {
      allowed: false,
      statusCode: 403,
      code: 'GUARD_DENIED',
      message: verdict.reason ?? 'Guard denied operation',
      hint: 'Adjust your Guard policy in the Guard tab if this is unexpected.',
    };
  }

  // 2. Profile check
  const profile = accessProfileStore.getProfile(agentId);
  const pathErr = checkPathPermission(rawPath, profile);
  if (pathErr) {
    return {
      allowed: false,
      statusCode: 403,
      code: 'PATH_DENIED',
      message: pathErr,
      hint: `Current profile: '${profile}'. Update via PUT /api/agents/:id/access-profile.`,
    };
  }

  return { allowed: true };
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerFileToolRoutes(
  app: FastifyInstance,
  guard: GuardEngine,
  accessProfileStore: AccessProfileStore,
): void {

  // ── POST /api/tools/files/read ─────────────────────────────────────────────
  app.post('/api/tools/files/read', {
    schema: {
      body: {
        type: 'object',
        required: ['path'],
        properties: {
          path:    { type: 'string', minLength: 1, maxLength: 4096 },
          agentId: { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { path: rawPath, agentId = '' } = req.body as { path: string; agentId?: string };
    const operation = 'file:read';

    const check = await gate(guard, accessProfileStore, operation, rawPath, agentId);
    if (!check.allowed) {
      const fail = check as GateFail;
      logger.warn('File tool: read denied', { rawPath, agentId, code: fail.code });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, rawPath, accessProfileStore.getProfile(agentId), false, fail.message));
      return sendError(reply, fail.statusCode, fail.code, fail.message, fail.hint);
    }

    const resolvedPath = resolve(rawPath);
    try {
      const fileStat = await stat(resolvedPath);
      if (fileStat.isDirectory()) {
        accessProfileStore.logAudit(makeAuditEntry(agentId, operation, resolvedPath, accessProfileStore.getProfile(agentId), false, 'Path is a directory'));
        return sendError(reply, 400, 'IS_DIRECTORY', 'Path is a directory — use /api/tools/files/list to list contents.');
      }
      if (fileStat.size > MAX_READ_BYTES) {
        accessProfileStore.logAudit(makeAuditEntry(agentId, operation, resolvedPath, accessProfileStore.getProfile(agentId), false, 'File exceeds 1MB limit'));
        return sendError(reply, 400, 'FILE_TOO_LARGE', `File is ${fileStat.size} bytes, max allowed is ${MAX_READ_BYTES} (1 MB).`);
      }
      const content = await readFile(resolvedPath, 'utf-8');
      logger.info('File tool: read', { path: resolvedPath, agentId, bytes: fileStat.size });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, resolvedPath, accessProfileStore.getProfile(agentId), true));
      return reply.send({ path: resolvedPath, content, size: fileStat.size });
    } catch (err) {
      return handleFsError(err, reply, resolvedPath, agentId, operation, accessProfileStore);
    }
  });

  // ── POST /api/tools/files/write ────────────────────────────────────────────
  app.post('/api/tools/files/write', {
    schema: {
      body: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
          path:    { type: 'string', minLength: 1, maxLength: 4096 },
          content: { type: 'string' },
          agentId: { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { path: rawPath, content, agentId = '' } = req.body as { path: string; content: string; agentId?: string };
    const operation = 'file:write';

    const check = await gate(guard, accessProfileStore, operation, rawPath, agentId);
    if (!check.allowed) {
      const fail = check as GateFail;
      logger.warn('File tool: write denied', { rawPath, agentId, code: fail.code });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, rawPath, accessProfileStore.getProfile(agentId), false, fail.message));
      return sendError(reply, fail.statusCode, fail.code, fail.message, fail.hint);
    }

    const resolvedPath = resolve(rawPath);
    try {
      await writeFile(resolvedPath, content, 'utf-8');
      const bytes = Buffer.byteLength(content, 'utf-8');
      logger.info('File tool: write', { path: resolvedPath, agentId, bytes });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, resolvedPath, accessProfileStore.getProfile(agentId), true));
      return reply.send({ ok: true, path: resolvedPath, bytes });
    } catch (err) {
      return handleFsError(err, reply, resolvedPath, agentId, operation, accessProfileStore);
    }
  });

  // ── POST /api/tools/files/edit ─────────────────────────────────────────────
  app.post('/api/tools/files/edit', {
    schema: {
      body: {
        type: 'object',
        required: ['path', 'oldText', 'newText'],
        properties: {
          path:    { type: 'string', minLength: 1, maxLength: 4096 },
          oldText: { type: 'string', minLength: 1 },
          newText: { type: 'string' },
          agentId: { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { path: rawPath, oldText, newText, agentId = '' } = req.body as {
      path: string; oldText: string; newText: string; agentId?: string;
    };
    const operation = 'file:write';

    const check = await gate(guard, accessProfileStore, operation, rawPath, agentId);
    if (!check.allowed) {
      const fail = check as GateFail;
      logger.warn('File tool: edit denied', { rawPath, agentId, code: fail.code });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, rawPath, accessProfileStore.getProfile(agentId), false, fail.message));
      return sendError(reply, fail.statusCode, fail.code, fail.message, fail.hint);
    }

    const resolvedPath = resolve(rawPath);
    try {
      const fileStat = await stat(resolvedPath);
      if (fileStat.size > MAX_READ_BYTES) {
        return sendError(reply, 400, 'FILE_TOO_LARGE', `File is ${fileStat.size} bytes, max editable size is ${MAX_READ_BYTES} (1 MB).`);
      }
      const original = await readFile(resolvedPath, 'utf-8');
      if (!original.includes(oldText)) {
        accessProfileStore.logAudit(makeAuditEntry(agentId, 'file:edit', resolvedPath, accessProfileStore.getProfile(agentId), false, 'oldText not found'));
        return sendError(reply, 400, 'TEXT_NOT_FOUND', 'oldText was not found in the file — no changes made.',
          'The substring must appear exactly as provided, including whitespace and line endings.');
      }
      const updated = original.split(oldText).join(newText);
      await writeFile(resolvedPath, updated, 'utf-8');
      const replacements = original.split(oldText).length - 1;
      logger.info('File tool: edit', { path: resolvedPath, agentId, replacements });
      accessProfileStore.logAudit(makeAuditEntry(agentId, 'file:edit', resolvedPath, accessProfileStore.getProfile(agentId), true));
      return reply.send({ ok: true, path: resolvedPath, replacements });
    } catch (err) {
      return handleFsError(err, reply, resolvedPath, agentId, 'file:edit', accessProfileStore);
    }
  });

  // ── POST /api/tools/files/move ─────────────────────────────────────────────
  app.post('/api/tools/files/move', {
    schema: {
      body: {
        type: 'object',
        required: ['sourcePath', 'destPath'],
        properties: {
          sourcePath: { type: 'string', minLength: 1, maxLength: 4096 },
          destPath:   { type: 'string', minLength: 1, maxLength: 4096 },
          agentId:    { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { sourcePath, destPath, agentId = '' } = req.body as {
      sourcePath: string; destPath: string; agentId?: string;
    };
    const operation = 'file:move';
    const profile = accessProfileStore.getProfile(agentId);

    // Guard check
    const verdict = guard.check({ operation, source: 'agent', sourceId: agentId });
    if (!verdict.allowed) {
      const msg = verdict.reason ?? 'Guard denied operation';
      logger.warn('File tool: move denied', { sourcePath, destPath, agentId });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, sourcePath, profile, false, msg));
      return sendError(reply, 403, 'GUARD_DENIED', msg, 'Adjust your Guard policy in the Guard tab.');
    }

    // Check both paths
    const srcErr = checkPathPermission(sourcePath, profile);
    if (srcErr) {
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, sourcePath, profile, false, srcErr));
      return sendError(reply, 403, 'PATH_DENIED', srcErr, `Current profile: '${profile}'.`);
    }
    const dstErr = checkPathPermission(destPath, profile);
    if (dstErr) {
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, destPath, profile, false, dstErr));
      return sendError(reply, 403, 'PATH_DENIED', dstErr, `Current profile: '${profile}'.`);
    }

    const resolvedSrc = resolve(sourcePath);
    const resolvedDst = resolve(destPath);
    try {
      await rename(resolvedSrc, resolvedDst);
      logger.info('File tool: move', { from: resolvedSrc, to: resolvedDst, agentId });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, resolvedSrc, profile, true));
      return reply.send({ ok: true, from: resolvedSrc, to: resolvedDst });
    } catch (err) {
      return handleFsError(err, reply, resolvedSrc, agentId, operation, accessProfileStore);
    }
  });

  // ── POST /api/tools/files/copy ─────────────────────────────────────────────
  app.post('/api/tools/files/copy', {
    schema: {
      body: {
        type: 'object',
        required: ['sourcePath', 'destPath'],
        properties: {
          sourcePath: { type: 'string', minLength: 1, maxLength: 4096 },
          destPath:   { type: 'string', minLength: 1, maxLength: 4096 },
          agentId:    { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { sourcePath, destPath, agentId = '' } = req.body as {
      sourcePath: string; destPath: string; agentId?: string;
    };
    const operation = 'file:copy';
    const profile = accessProfileStore.getProfile(agentId);

    const verdict = guard.check({ operation, source: 'agent', sourceId: agentId });
    if (!verdict.allowed) {
      const msg = verdict.reason ?? 'Guard denied operation';
      logger.warn('File tool: copy denied', { sourcePath, destPath, agentId });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, sourcePath, profile, false, msg));
      return sendError(reply, 403, 'GUARD_DENIED', msg, 'Adjust your Guard policy in the Guard tab.');
    }

    const srcErr = checkPathPermission(sourcePath, profile);
    if (srcErr) {
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, sourcePath, profile, false, srcErr));
      return sendError(reply, 403, 'PATH_DENIED', srcErr, `Current profile: '${profile}'.`);
    }
    const dstErr = checkPathPermission(destPath, profile);
    if (dstErr) {
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, destPath, profile, false, dstErr));
      return sendError(reply, 403, 'PATH_DENIED', dstErr, `Current profile: '${profile}'.`);
    }

    const resolvedSrc = resolve(sourcePath);
    const resolvedDst = resolve(destPath);
    try {
      await copyFile(resolvedSrc, resolvedDst);
      logger.info('File tool: copy', { from: resolvedSrc, to: resolvedDst, agentId });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, resolvedSrc, profile, true));
      return reply.send({ ok: true, from: resolvedSrc, to: resolvedDst });
    } catch (err) {
      return handleFsError(err, reply, resolvedSrc, agentId, operation, accessProfileStore);
    }
  });

  // ── POST /api/tools/files/delete ───────────────────────────────────────────
  app.post('/api/tools/files/delete', {
    schema: {
      body: {
        type: 'object',
        required: ['path'],
        properties: {
          path:      { type: 'string', minLength: 1, maxLength: 4096 },
          recursive: { type: 'boolean' },
          agentId:   { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { path: rawPath, recursive = false, agentId = '' } = req.body as {
      path: string; recursive?: boolean; agentId?: string;
    };
    const operation = 'file:delete';

    const check = await gate(guard, accessProfileStore, operation, rawPath, agentId);
    if (!check.allowed) {
      const fail = check as GateFail;
      logger.warn('File tool: delete denied', { rawPath, agentId, code: fail.code });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, rawPath, accessProfileStore.getProfile(agentId), false, fail.message));
      return sendError(reply, fail.statusCode, fail.code, fail.message, fail.hint);
    }

    const resolvedPath = resolve(rawPath);
    try {
      await rm(resolvedPath, { recursive, force: false });
      logger.info('File tool: delete', { path: resolvedPath, agentId, recursive });
      accessProfileStore.logAudit(makeAuditEntry(agentId, operation, resolvedPath, accessProfileStore.getProfile(agentId), true));
      return reply.send({ ok: true, path: resolvedPath });
    } catch (err) {
      return handleFsError(err, reply, resolvedPath, agentId, operation, accessProfileStore);
    }
  });

  // ── POST /api/tools/files/mkdir ────────────────────────────────────────────
  app.post('/api/tools/files/mkdir', {
    schema: {
      body: {
        type: 'object',
        required: ['path'],
        properties: {
          path:      { type: 'string', minLength: 1, maxLength: 4096 },
          recursive: { type: 'boolean' },
          agentId:   { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { path: rawPath, recursive = true, agentId = '' } = req.body as {
      path: string; recursive?: boolean; agentId?: string;
    };
    const operation = 'file:write';

    const check = await gate(guard, accessProfileStore, operation, rawPath, agentId);
    if (!check.allowed) {
      const fail = check as GateFail;
      logger.warn('File tool: mkdir denied', { rawPath, agentId, code: fail.code });
      accessProfileStore.logAudit(makeAuditEntry(agentId, 'file:mkdir', rawPath, accessProfileStore.getProfile(agentId), false, fail.message));
      return sendError(reply, fail.statusCode, fail.code, fail.message, fail.hint);
    }

    const resolvedPath = resolve(rawPath);
    try {
      await mkdir(resolvedPath, { recursive });
      logger.info('File tool: mkdir', { path: resolvedPath, agentId, recursive });
      accessProfileStore.logAudit(makeAuditEntry(agentId, 'file:mkdir', resolvedPath, accessProfileStore.getProfile(agentId), true));
      return reply.send({ ok: true, path: resolvedPath });
    } catch (err) {
      return handleFsError(err, reply, resolvedPath, agentId, 'file:mkdir', accessProfileStore);
    }
  });

  // ── POST /api/tools/files/list ─────────────────────────────────────────────
  app.post('/api/tools/files/list', {
    schema: {
      body: {
        type: 'object',
        required: ['path'],
        properties: {
          path:    { type: 'string', minLength: 1, maxLength: 4096 },
          agentId: { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { path: rawPath, agentId = '' } = req.body as { path: string; agentId?: string };
    const operation = 'file:read';

    const check = await gate(guard, accessProfileStore, operation, rawPath, agentId);
    if (!check.allowed) {
      const fail = check as GateFail;
      logger.warn('File tool: list denied', { rawPath, agentId, code: fail.code });
      accessProfileStore.logAudit(makeAuditEntry(agentId, 'file:list', rawPath, accessProfileStore.getProfile(agentId), false, fail.message));
      return sendError(reply, fail.statusCode, fail.code, fail.message, fail.hint);
    }

    const resolvedPath = resolve(rawPath);
    try {
      const entries = await readdir(resolvedPath, { withFileTypes: true });
      const items = await Promise.all(entries.map(async (entry) => {
        const entryPath = join(resolvedPath, entry.name);
        let size: number | undefined;
        let mtime: string | undefined;
        try {
          const s = await stat(entryPath);
          size = s.size;
          mtime = s.mtime.toISOString();
        } catch { /* stat failed — omit fields */ }
        return {
          name:  entry.name,
          isDir: entry.isDirectory(),
          isFile: entry.isFile(),
          size,
          mtime,
        };
      }));
      logger.info('File tool: list', { path: resolvedPath, agentId, count: items.length });
      accessProfileStore.logAudit(makeAuditEntry(agentId, 'file:list', resolvedPath, accessProfileStore.getProfile(agentId), true));
      return reply.send({ path: resolvedPath, entries: items });
    } catch (err) {
      return handleFsError(err, reply, resolvedPath, agentId, 'file:list', accessProfileStore);
    }
  });

  // ── POST /api/tools/files/stat ─────────────────────────────────────────────
  app.post('/api/tools/files/stat', {
    schema: {
      body: {
        type: 'object',
        required: ['path'],
        properties: {
          path:    { type: 'string', minLength: 1, maxLength: 4096 },
          agentId: { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { path: rawPath, agentId = '' } = req.body as { path: string; agentId?: string };
    const operation = 'file:read';

    const check = await gate(guard, accessProfileStore, operation, rawPath, agentId);
    if (!check.allowed) {
      const fail = check as GateFail;
      logger.warn('File tool: stat denied', { rawPath, agentId, code: fail.code });
      accessProfileStore.logAudit(makeAuditEntry(agentId, 'file:stat', rawPath, accessProfileStore.getProfile(agentId), false, fail.message));
      return sendError(reply, fail.statusCode, fail.code, fail.message, fail.hint);
    }

    const resolvedPath = resolve(rawPath);
    try {
      const s = await stat(resolvedPath);
      logger.info('File tool: stat', { path: resolvedPath, agentId });
      accessProfileStore.logAudit(makeAuditEntry(agentId, 'file:stat', resolvedPath, accessProfileStore.getProfile(agentId), true));
      return reply.send({
        path:   resolvedPath,
        exists: true,
        isDir:  s.isDirectory(),
        isFile: s.isFile(),
        size:   s.size,
        mtime:  s.mtime.toISOString(),
        atime:  s.atime.toISOString(),
        ctime:  s.ctime.toISOString(),
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        // Return exists: false rather than 404 — callers often probe existence
        return reply.send({ path: resolvedPath, exists: false });
      }
      return handleFsError(err, reply, resolvedPath, agentId, 'file:stat', accessProfileStore);
    }
  });

  // ── GET /api/tools/files/audit ─────────────────────────────────────────────
  app.get('/api/tools/files/audit', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit:   { type: 'integer', minimum: 1, maximum: 500 },
          agentId: { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const query = req.query as { limit?: number; agentId?: string };
    const limit = query.limit ?? 100;
    let entries = accessProfileStore.getAuditLog(limit);
    if (query.agentId) {
      entries = entries.filter(e => e.agentId === query.agentId);
    }
    return reply.send({ entries, total: entries.length });
  });
}

// ─── Shared FS error handler ──────────────────────────────────────────────────

function handleFsError(
  err: unknown,
  reply: import('fastify').FastifyReply,
  resolvedPath: string,
  agentId: string,
  operation: string,
  accessProfileStore: AccessProfileStore,
): ReturnType<import('fastify').FastifyReply['send']> {
  const fsErr = err as NodeJS.ErrnoException;
  const message = fsErr.message ?? String(err);

  if (fsErr.code === 'ENOENT') {
    logger.warn('File tool: path not found', { path: resolvedPath, agentId, operation });
    accessProfileStore.logAudit(makeAuditEntry(agentId, operation, resolvedPath, 'safe', false, 'ENOENT: path not found'));
    return sendError(reply, 404, 'NOT_FOUND', `Path not found: ${resolvedPath}`);
  }
  if (fsErr.code === 'EACCES' || fsErr.code === 'EPERM') {
    logger.warn('File tool: OS permission denied', { path: resolvedPath, agentId, operation });
    accessProfileStore.logAudit(makeAuditEntry(agentId, operation, resolvedPath, 'safe', false, 'OS permission denied'));
    return sendError(reply, 403, 'OS_PERMISSION_DENIED', `OS denied access to: ${resolvedPath}`,
      'The gateway process does not have OS-level permission for this path.');
  }
  if (fsErr.code === 'EISDIR') {
    return sendError(reply, 400, 'IS_DIRECTORY', 'Path is a directory.');
  }
  if (fsErr.code === 'ENOTDIR') {
    return sendError(reply, 400, 'NOT_DIRECTORY', 'A path component is not a directory.');
  }
  if (fsErr.code === 'ENOTEMPTY') {
    return sendError(reply, 400, 'DIR_NOT_EMPTY', 'Directory is not empty. Pass recursive: true to delete recursively.');
  }

  logger.warn('File tool: unexpected error', { path: resolvedPath, agentId, operation, error: message });
  accessProfileStore.logAudit(makeAuditEntry(agentId, operation, resolvedPath, 'safe', false, message));
  return sendError(reply, 500, 'FS_ERROR', `File operation failed: ${message}`);
}
