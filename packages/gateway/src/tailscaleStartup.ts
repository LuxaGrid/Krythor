/**
 * tailscaleStartup — validates Tailscale config and applies Serve/Funnel at gateway startup.
 *
 * Called from server.ts after the TLS block. Hard-fails (throws) on misconfiguration
 * so that server.ts can catch and call process.exit(1) — a misconfigured Funnel setup
 * should not silently start unprotected.
 */

import { TailscaleService } from './TailscaleService.js';
import type { TailscaleConfig, GatewayAuthMode } from './TailscaleService.js';

type MinimalLogger = {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
};

type MinimalAuditLogger = {
  log(entry: Record<string, unknown>): void;
};

export async function validateAndApplyTailscale(
  config: TailscaleConfig,
  authMode: GatewayAuthMode,
  port: number,
  log: MinimalLogger,
  auditLogger?: MinimalAuditLogger,
): Promise<void> {
  // 1. Off — nothing to do
  if (config.mode === 'off') return;

  const service = new TailscaleService(port);

  // 2. Validate config combination
  const configError = service.validateConfig(config, authMode);
  if (configError) {
    throw new Error(`Tailscale config error: ${configError}`);
  }

  // 3. Check CLI is installed
  const installed = await service.isInstalled();
  if (!installed) {
    throw new Error('Tailscale CLI not found — install Tailscale and ensure it is in PATH');
  }

  // 4. Check login status
  const loggedIn = await service.isLoggedIn();
  if (!loggedIn) {
    throw new Error('Tailscale is not logged in — run `tailscale up` to authenticate');
  }

  // 5. Apply the requested mode
  if (config.mode === 'serve') {
    log.info('Applying Tailscale Serve configuration', { port });
    await service.applyServe();
  } else if (config.mode === 'funnel') {
    log.info('Applying Tailscale Funnel configuration', { port });
    await service.applyFunnel();
  }

  // 6. Log success to audit logger
  if (auditLogger) {
    auditLogger.log({
      actionType: 'tailscale:startup',
      mode: config.mode,
      port,
      ts: Date.now(),
    });
  }

  // 7. Register cleanup on exit if resetOnExit is set
  if (config.resetOnExit) {
    process.on('exit', () => {
      // Synchronous best-effort reset — cannot await on exit
      const { execFileSync } = require('child_process');
      const binary = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
      try {
        execFileSync(binary, ['serve', 'reset'], { timeout: 5000 });
      } catch { /* best-effort */ }
    });
  }
}

export type { TailscaleConfig, GatewayAuthMode };
