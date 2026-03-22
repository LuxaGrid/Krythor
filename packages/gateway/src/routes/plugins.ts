import type { FastifyInstance } from 'fastify';
import type { PluginLoader } from '@krythor/core';

/**
 * GET /api/plugins — list loaded plugins (auth required).
 * Returns [{ name, description, file }] for each successfully loaded plugin.
 */
export function registerPluginRoutes(
  app: FastifyInstance,
  pluginLoader: PluginLoader,
): void {
  app.get('/api/plugins', async (_req, reply) => {
    const plugins = pluginLoader.list().map(({ name, description, file }) => ({
      name,
      description,
      file,
    }));
    return reply.send(plugins);
  });
}
