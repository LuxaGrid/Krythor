import type { FastifyInstance } from 'fastify';
import type { PluginLoader } from '@krythor/core';

/**
 * GET  /api/plugins        — list all plugin load records (auth required).
 *   Returns [{ file, status, name?, description?, reason? }] for every file
 *   scanned during the last load() pass — including errors and skipped entries.
 *
 * POST /api/plugins/reload — hot-reload plugins from disk without restarting.
 *   Re-runs PluginLoader.load() and returns the updated record list.
 */
export function registerPluginRoutes(
  app: FastifyInstance,
  pluginLoader: PluginLoader,
): void {
  app.get('/api/plugins', async (_req, reply) => {
    return reply.send(pluginLoader.listRecords());
  });

  app.post('/api/plugins/reload', async (_req, reply) => {
    pluginLoader.load();
    return reply.send(pluginLoader.listRecords());
  });
}
