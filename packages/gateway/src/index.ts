import { buildServer, GATEWAY_HOST, GATEWAY_PORT, warnIfNetworkExposed } from './server.js';
import { logger } from './logger.js';
import type { ReadinessResult } from './readiness.js';

let serverInstance: Awaited<ReturnType<typeof buildServer>> | null = null;

async function main(): Promise<void> {
  const app = await buildServer();
  serverInstance = app;

  try {
    await app.listen({ port: GATEWAY_PORT, host: GATEWAY_HOST });
    warnIfNetworkExposed(GATEWAY_HOST);
    app.log.info(`Krythor Gateway running at http://${GATEWAY_HOST}:${GATEWAY_PORT}`);
    app.log.info(`WebSocket stream at ws://${GATEWAY_HOST}:${GATEWAY_PORT}/ws/stream`);
    logger.serverStart(GATEWAY_PORT, GATEWAY_HOST);

    // Log readiness state immediately after startup
    const checkReady = (app as unknown as Record<string, () => Promise<ReadinessResult>>)['checkReady'];
    if (checkReady) {
      const readiness = await checkReady();
      if (readiness.ready) {
        app.log.info('Readiness check passed — server is ready to serve requests');
      } else {
        const failing = Object.entries(readiness.checks)
          .filter(([, v]) => !v.ok)
          .map(([k, v]) => `${k}: ${v.detail ?? 'failed'}`)
          .join(', ');
        app.log.warn(`Readiness check FAILED — ${failing}`);
      }
    }
  } catch (err) {
    logger.error('Server failed to start', { error: String(err) });
    app.log.error(err);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  logger.serverStop();
  if (serverInstance) {
    await serverInstance.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.serverStop();
  if (serverInstance) {
    await serverInstance.close();
  }
  process.exit(0);
});

main().catch((err: unknown) => {
  console.error('Fatal error starting Krythor Gateway:', err);
  process.exit(1);
});
