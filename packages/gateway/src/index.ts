import { buildServer, GATEWAY_HOST, GATEWAY_PORT, TRUSTED_PROXIES, warnIfNetworkExposed } from './server.js';
import { logger } from './logger.js';
import type { ReadinessResult } from './readiness.js';

type ServerInstance = Awaited<ReturnType<typeof buildServer>> & {
  checkReady?: () => Promise<ReadinessResult>;
  waitForDrain?: (timeoutMs: number) => Promise<void>;
};

let serverInstance: ServerInstance | null = null;

async function main(): Promise<void> {
  const app = await buildServer() as ServerInstance;
  serverInstance = app;

  try {
    await app.listen({ port: GATEWAY_PORT, host: GATEWAY_HOST });
    warnIfNetworkExposed(GATEWAY_HOST);
    app.log.info(`Krythor Gateway running at http://${GATEWAY_HOST}:${GATEWAY_PORT}`);
    app.log.info(`WebSocket stream at ws://${GATEWAY_HOST}:${GATEWAY_PORT}/ws/stream`);
    if (process.env['KRYTHOR_HOST']) {
      app.log.info(`Bind host overridden via KRYTHOR_HOST=${GATEWAY_HOST}`);
    }
    if (process.env['KRYTHOR_PORT']) {
      app.log.info(`Port overridden via KRYTHOR_PORT=${GATEWAY_PORT}`);
    }
    if (TRUSTED_PROXIES.size > 0) {
      app.log.info(`Trusted proxy auth: accepting X-Forwarded-User from ${[...TRUSTED_PROXIES].join(', ')}`);
    }
    logger.serverStart(GATEWAY_PORT, GATEWAY_HOST);

    // Log readiness state immediately after startup
    const checkReady = app.checkReady;
    if (checkReady) {
      const readiness = await checkReady();
      if (readiness.ready) {
        app.log.info('Readiness check passed — server is ready to serve requests');
      } else {
        const failing = (Object.entries(readiness.checks) as Array<[string, { ok: boolean; detail?: string }]>)
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

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, starting graceful shutdown`);
  logger.serverStop();
  if (serverInstance) {
    // Stop accepting new requests
    await serverInstance.close();
    // Wait for in-flight agent runs to complete (max 30s)
    if (serverInstance.waitForDrain) {
      await serverInstance.waitForDrain(30_000);
    }
  }
  logger.info('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });

main().catch((err: unknown) => {
  console.error('Fatal error starting Krythor Gateway:', err);
  process.exit(1);
});
