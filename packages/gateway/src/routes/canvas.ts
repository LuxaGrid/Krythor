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
  app.patch<{ Params: { id: string }; Body: { title?: string; html?: string; css?: string; js?: string } }>('/api/canvas/:id', {
    schema: {
      body: {
        type: 'object',
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
    const index = pageIndex();
    const page = index[req.params.id];
    if (!page) return reply.code(404).send({ error: 'Canvas page not found' });
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
}
