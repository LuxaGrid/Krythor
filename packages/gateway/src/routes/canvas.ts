import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { atomicWriteJSON } from '@krythor/core';

export interface CanvasPage {
  id: string;
  title: string;
  html: string;
  css: string;
  js: string;
  createdAt: number;
  updatedAt: number;
}

/** A snapshot of a canvas page at a point in time. */
export interface CanvasRevision {
  /** Sequential revision number (1-based). */
  rev: number;
  title: string;
  html: string;
  css: string;
  js: string;
  savedAt: number;
  /** Optional user-supplied label (e.g. "before refactor"). */
  label?: string;
}

const MAX_HISTORY = 50;

export function registerCanvasRoute(app: FastifyInstance, dataDir: string): void {
  const canvasDir = join(dataDir, 'canvas');
  if (!existsSync(canvasDir)) mkdirSync(canvasDir, { recursive: true });

  function pageIndex(): Record<string, CanvasPage> {
    const indexPath = join(canvasDir, '_index.json');
    if (!existsSync(indexPath)) return {};
    try { return JSON.parse(readFileSync(indexPath, 'utf-8')) as Record<string, CanvasPage>; }
    catch { return {}; }
  }

  function saveIndex(index: Record<string, CanvasPage>): void {
    atomicWriteJSON(join(canvasDir, '_index.json'), index);
  }

  function historyPath(pageId: string): string {
    return join(canvasDir, `${pageId}.history.json`);
  }

  function loadHistory(pageId: string): CanvasRevision[] {
    const p = historyPath(pageId);
    if (!existsSync(p)) return [];
    try { return JSON.parse(readFileSync(p, 'utf-8')) as CanvasRevision[]; }
    catch { return []; }
  }

  function saveHistory(pageId: string, history: CanvasRevision[]): void {
    atomicWriteJSON(historyPath(pageId), history);
  }

  /** Append a new revision snapshot, trimming to MAX_HISTORY. */
  function pushRevision(pageId: string, page: CanvasPage, label?: string): void {
    const history = loadHistory(pageId);
    const rev: CanvasRevision = {
      rev: (history[history.length - 1]?.rev ?? 0) + 1,
      title: page.title,
      html: page.html,
      css: page.css,
      js: page.js,
      savedAt: page.updatedAt,
      label,
    };
    history.push(rev);
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
    saveHistory(pageId, history);
  }

  // GET /api/canvas  — list canvas pages
  app.get('/api/canvas', async (_req, reply) => {
    const index = pageIndex();
    return reply.send({ pages: Object.values(index).map(p => ({ id: p.id, title: p.title, updatedAt: p.updatedAt })) });
  });

  // POST /api/canvas  — create a new canvas page
  app.post<{ Body: { title: string; html?: string; css?: string; js?: string } }>('/api/canvas', {
    schema: {
      body: {
        type: 'object', required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          html:  { type: 'string', maxLength: 500_000 },
          css:   { type: 'string', maxLength: 100_000 },
          js:    { type: 'string', maxLength: 200_000 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { randomUUID } = await import('crypto');
    const id = randomUUID();
    const now = Date.now();
    const page: CanvasPage = {
      id, title: req.body.title,
      html: req.body.html ?? '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Canvas</title></head><body></body></html>',
      css:  req.body.css  ?? '',
      js:   req.body.js   ?? '',
      createdAt: now, updatedAt: now,
    };
    const index = pageIndex();
    index[id] = page;
    saveIndex(index);
    return reply.code(201).send(page);
  });

  // GET /api/canvas/:id  — get a canvas page (JSON)
  app.get<{ Params: { id: string } }>('/api/canvas/:id', async (req, reply) => {
    const page = pageIndex()[req.params.id];
    if (!page) return reply.code(404).send({ error: 'Canvas page not found' });
    return reply.send(page);
  });

  // PATCH /api/canvas/:id  — update a canvas page
  app.patch<{ Params: { id: string }; Body: { title?: string; html?: string; css?: string; js?: string; label?: string } }>('/api/canvas/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          html:  { type: 'string', maxLength: 500_000 },
          css:   { type: 'string', maxLength: 100_000 },
          js:    { type: 'string', maxLength: 200_000 },
          label: { type: 'string', maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const index = pageIndex();
    const page = index[req.params.id];
    if (!page) return reply.code(404).send({ error: 'Canvas page not found' });
    // Snapshot the current state before overwriting
    pushRevision(req.params.id, page, req.body.label);
    if (req.body.title !== undefined) page.title = req.body.title;
    if (req.body.html  !== undefined) page.html  = req.body.html;
    if (req.body.css   !== undefined) page.css   = req.body.css;
    if (req.body.js    !== undefined) page.js    = req.body.js;
    page.updatedAt = Date.now();
    saveIndex(index);
    return reply.send(page);
  });

  // DELETE /api/canvas/:id  — delete a canvas page
  app.delete<{ Params: { id: string } }>('/api/canvas/:id', async (req, reply) => {
    const index = pageIndex();
    if (!index[req.params.id]) return reply.code(404).send({ error: 'Canvas page not found' });
    delete index[req.params.id];
    saveIndex(index);
    return reply.code(204).send();
  });

  // GET /api/canvas/:id/render  — serve the canvas page as live HTML
  app.get<{ Params: { id: string } }>('/api/canvas/:id/render', async (req, reply) => {
    const page = pageIndex()[req.params.id];
    if (!page) return reply.code(404).send('Canvas page not found');
    const html = page.html
      .replace('</head>', `<style>\n${page.css}\n</style>\n</head>`)
      .replace('</body>', `<script>\n${page.js}\n</script>\n</body>`);
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // GET /api/canvas/:id/history  — list revisions (newest first, content omitted for list)
  app.get<{ Params: { id: string } }>('/api/canvas/:id/history', async (req, reply) => {
    if (!pageIndex()[req.params.id]) return reply.code(404).send({ error: 'Canvas page not found' });
    const history = loadHistory(req.params.id);
    // Return summary list (no html/css/js bodies to keep response small)
    const summaries = history
      .slice()
      .reverse()
      .map(({ html: _h, css: _c, js: _j, ...meta }) => meta);
    return reply.send({ revisions: summaries, total: history.length });
  });

  // GET /api/canvas/:id/history/:rev  — get a specific revision (full content)
  app.get<{ Params: { id: string; rev: string } }>('/api/canvas/:id/history/:rev', async (req, reply) => {
    if (!pageIndex()[req.params.id]) return reply.code(404).send({ error: 'Canvas page not found' });
    const revNum = parseInt(req.params.rev, 10);
    if (isNaN(revNum)) return reply.code(400).send({ error: 'rev must be a number' });
    const revision = loadHistory(req.params.id).find(r => r.rev === revNum);
    if (!revision) return reply.code(404).send({ error: 'Revision not found' });
    return reply.send(revision);
  });

  // POST /api/canvas/:id/history/:rev/restore  — restore a revision as current
  app.post<{ Params: { id: string; rev: string } }>('/api/canvas/:id/history/:rev/restore', async (req, reply) => {
    const index = pageIndex();
    const page = index[req.params.id];
    if (!page) return reply.code(404).send({ error: 'Canvas page not found' });
    const revNum = parseInt(req.params.rev, 10);
    if (isNaN(revNum)) return reply.code(400).send({ error: 'rev must be a number' });
    const revision = loadHistory(req.params.id).find(r => r.rev === revNum);
    if (!revision) return reply.code(404).send({ error: 'Revision not found' });
    // Snapshot current state before restoring
    pushRevision(req.params.id, page, `before restore to rev ${revNum}`);
    page.title     = revision.title;
    page.html      = revision.html;
    page.css       = revision.css;
    page.js        = revision.js;
    page.updatedAt = Date.now();
    saveIndex(index);
    return reply.send(page);
  });
}
