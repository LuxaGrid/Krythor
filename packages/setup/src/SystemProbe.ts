import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import * as net from 'net';

export interface ProbeResult {
  nodeVersion: string;
  nodeVersionOk: boolean;
  platform: string;
  dataDir: string;
  configDir: string;
  hasExistingConfig: boolean;
  gatewayPortFree: boolean;
  ollamaDetected: boolean;
  ollamaBaseUrl: string;
  lmStudioDetected: boolean;
  lmStudioBaseUrl: string;
  lmStudioModels: string[];
  llamaServerDetected: boolean;
  llamaServerBaseUrl: string;
  tailscaleDetected: boolean;
  tailscaleSocketPath: string | undefined;
  isWSL2: boolean;
  defaultWorkspaceDir: string;
}

function getConfigDir(): string {
  if (process.env['KRYTHOR_DATA_DIR']) {
    return join(process.env['KRYTHOR_DATA_DIR'], 'config');
  }
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Krythor', 'config');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Krythor', 'config');
  }
  return join(homedir(), '.local', 'share', 'krythor', 'config');
}

function getDataDir(): string {
  if (process.env['KRYTHOR_DATA_DIR']) {
    return process.env['KRYTHOR_DATA_DIR'];
  }
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Krythor');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Krythor');
  }
  return join(homedir(), '.local', 'share', 'krythor');
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, '127.0.0.1');
  });
}

async function detectOllama(): Promise<{ found: boolean; baseUrl: string }> {
  const candidates = ['http://localhost:11434', 'http://127.0.0.1:11434'];
  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return { found: true, baseUrl: url };
    } catch { /* not available */ }
  }
  return { found: false, baseUrl: 'http://localhost:11434' };
}

async function detectLmStudio(): Promise<{ found: boolean; baseUrl: string; models: string[] }> {
  const candidates = ['http://localhost:1234', 'http://127.0.0.1:1234'];
  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/v1/models`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        let models: string[] = [];
        try {
          const data = await res.json() as { data?: Array<{ id: string }> };
          models = (data.data ?? []).map(m => m.id);
        } catch { /* models list is best-effort */ }
        return { found: true, baseUrl: url, models };
      }
    } catch { /* not available */ }
  }
  return { found: false, baseUrl: 'http://localhost:1234', models: [] };
}

async function detectLlamaServer(): Promise<{ found: boolean; baseUrl: string }> {
  const candidates = ['http://localhost:8080', 'http://127.0.0.1:8080'];
  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        if (typeof data['status'] === 'string') {
          return { found: true, baseUrl: url };
        }
      }
    } catch { /* not available */ }
  }
  return { found: false, baseUrl: 'http://localhost:8080' };
}

async function detectTailscale(): Promise<{ found: boolean; socketPath: string | undefined }> {
  // Check for tailscaled socket on Linux/macOS
  if (process.platform !== 'win32') {
    const sockets = [
      '/var/run/tailscale/tailscaled.sock',
      '/run/tailscale/tailscaled.sock',
    ];
    for (const s of sockets) {
      if (existsSync(s)) return { found: true, socketPath: s };
    }
  }

  // Try the CLI (works on all platforms)
  try {
    if (process.platform === 'win32') {
      // Windows: check known install path first (faster than PATH lookup)
      const winExe = 'C:\\Program Files\\Tailscale\\tailscale.exe';
      const cmd = existsSync(winExe) ? `"${winExe}" status` : 'tailscale status';
      execSync(cmd, { timeout: 2000, stdio: 'ignore' });
    } else {
      execSync('tailscale status --json', { timeout: 2000, stdio: 'ignore' });
    }
    return { found: true, socketPath: undefined };
  } catch { /* not running or not installed */ }

  return { found: false, socketPath: undefined };
}

function detectWSL2(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const version = readFileSync('/proc/version', 'utf8');
    return version.toLowerCase().includes('microsoft');
  } catch { return false; }
}

export async function probe(): Promise<ProbeResult> {
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  const configDir = getConfigDir();
  const dataDir = getDataDir();
  const hasExistingConfig = existsSync(join(configDir, 'providers.json'));
  const isWSL2 = detectWSL2();

  const [portFree, ollama, lmStudio, llamaServer, tailscale] = await Promise.all([
    isPortFree(47200),
    detectOllama(),
    detectLmStudio(),
    detectLlamaServer(),
    detectTailscale(),
  ]);

  return {
    nodeVersion,
    nodeVersionOk: major >= 20,
    platform: process.platform,
    dataDir,
    configDir,
    hasExistingConfig,
    gatewayPortFree: portFree,
    ollamaDetected: ollama.found,
    ollamaBaseUrl: ollama.baseUrl,
    lmStudioDetected: lmStudio.found,
    lmStudioBaseUrl: lmStudio.baseUrl,
    lmStudioModels: lmStudio.models,
    llamaServerDetected: llamaServer.found,
    llamaServerBaseUrl: llamaServer.baseUrl,
    tailscaleDetected: tailscale.found,
    tailscaleSocketPath: tailscale.socketPath,
    isWSL2,
    defaultWorkspaceDir: join(dataDir, 'workspace'),
  };
}
