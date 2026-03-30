/**
 * TailscaleService — wraps tailscale CLI calls for Serve and Funnel networking modes.
 *
 * All CLI calls use execFile (not exec) to avoid shell injection.
 * On Windows the binary is tailscale.exe; on other platforms it is tailscale.
 * Every call has a 10-second timeout and gracefully degrades on CLI errors.
 */

import { execFile as _execFile } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execFile = promisify(_execFile);

export type TailscaleMode    = 'off' | 'serve' | 'funnel';
export type GatewayBind      = 'loopback' | 'tailnet' | 'auto';
export type GatewayAuthMode  = 'token' | 'password';

export interface TailscaleStatus {
  installed:  boolean;
  loggedIn:   boolean;
  tailnetIP:  string | null;
  magicDNS:   string | null;
  activeMode: TailscaleMode;
  activeURL:  string | null;
  warnings:   string[];
}

export interface TailscaleConfig {
  mode:         TailscaleMode;
  resetOnExit:  boolean;
}

/** JSON shape returned by `tailscale status --json` */
interface TailscaleStatusJSON {
  BackendState?: string;
  Self?: {
    DNSName?:       string;
    TailscaleIPs?:  string[];
  };
}

function getBinary(): string {
  return platform() === 'win32' ? 'tailscale.exe' : 'tailscale';
}

/** Run a tailscale CLI command with a 10-second timeout. */
async function run(args: string[]): Promise<string> {
  const { stdout } = await execFile(getBinary(), args, {
    timeout: 10_000,
    windowsHide: true,
  });
  return stdout;
}

export class TailscaleService {
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  /** Detect tailscale CLI by running `tailscale version`. Returns false on ENOENT or any error. */
  async isInstalled(): Promise<boolean> {
    try {
      await run(['version']);
      return true;
    } catch {
      return false;
    }
  }

  /** Check login status via `tailscale status --json`. BackendState === 'Running' means logged in. */
  async isLoggedIn(): Promise<boolean> {
    try {
      const raw = await run(['status', '--json']);
      const data = JSON.parse(raw) as TailscaleStatusJSON;
      return data.BackendState === 'Running';
    } catch {
      return false;
    }
  }

  /** Get tailnet IP and MagicDNS hostname from `tailscale status --json`. */
  async getNetworkInfo(): Promise<{ tailnetIP: string | null; magicDNS: string | null }> {
    try {
      const raw = await run(['status', '--json']);
      const data = JSON.parse(raw) as TailscaleStatusJSON;
      const tailnetIP  = data.Self?.TailscaleIPs?.[0] ?? null;
      // DNSName typically ends with a trailing dot — strip it
      const rawDNS     = data.Self?.DNSName ?? null;
      const magicDNS   = rawDNS ? rawDNS.replace(/\.$/, '') : null;
      return { tailnetIP, magicDNS };
    } catch {
      return { tailnetIP: null, magicDNS: null };
    }
  }

  /** Build a full TailscaleStatus for the API response. */
  async getStatus(config: TailscaleConfig): Promise<TailscaleStatus> {
    const installed = await this.isInstalled();
    if (!installed) {
      return {
        installed: false,
        loggedIn:  false,
        tailnetIP: null,
        magicDNS:  null,
        activeMode: config.mode,
        activeURL:  null,
        warnings:   ['Tailscale CLI not found'],
      };
    }

    const loggedIn = await this.isLoggedIn();
    const { tailnetIP, magicDNS } = await this.getNetworkInfo();

    const warnings: string[] = [];
    if (!loggedIn) warnings.push('Tailscale is not logged in');

    // Derive the active URL based on mode and network info
    let activeURL: string | null = null;
    if (config.mode === 'serve' && magicDNS) {
      activeURL = `https://${magicDNS}`;
    } else if (config.mode === 'funnel' && magicDNS) {
      activeURL = `https://${magicDNS}`;
    }

    return {
      installed,
      loggedIn,
      tailnetIP,
      magicDNS,
      activeMode: config.mode,
      activeURL,
      warnings,
    };
  }

  /**
   * Apply Tailscale Serve mode:
   *   tailscale serve --bg <port>
   * This proxies all traffic (HTTP + WebSocket upgrades) on the tailnet to localhost:<port>.
   */
  async applyServe(): Promise<void> {
    await run(['serve', '--bg', String(this.port)]);
  }

  /**
   * Apply Tailscale Funnel mode (public HTTPS):
   *   tailscale funnel --bg <port>
   */
  async applyFunnel(): Promise<void> {
    await run(['funnel', '--bg', String(this.port)]);
  }

  /** Reset serve/funnel config: `tailscale serve reset` */
  async reset(): Promise<void> {
    try {
      await run(['serve', 'reset']);
    } catch {
      // best-effort — reset may fail if nothing was configured
    }
  }

  /**
   * Validate a config combination.
   * Returns an error string if invalid, or null if the config is acceptable.
   *
   * Rules:
   *   - funnel mode requires authMode === 'password' (public exposure needs password auth)
   *   - tailnet bind + mode !== 'off' — warn but allow (user is manually binding to tailnet)
   */
  validateConfig(config: TailscaleConfig, authMode: GatewayAuthMode): string | null {
    if (config.mode === 'off') return null;
    if (config.mode === 'funnel' && authMode !== 'password') {
      return 'Funnel mode exposes the gateway publicly — password auth mode is required to prevent unauthorized access';
    }
    return null;
  }
}
