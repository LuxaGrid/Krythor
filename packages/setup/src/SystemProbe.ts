import { execSync } from 'child_process';
import { existsSync } from 'fs';
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
}

function getConfigDir(): string {
  // If KRYTHOR_DATA_DIR is set, config lives under it.
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
  // KRYTHOR_DATA_DIR allows users to relocate Krythor's data directory.
  // Useful for backups, multi-user setups, and testing.
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

/** Detect LM Studio on its default port 1234. Returns available models if found. */
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

/** Detect llama-server (llama.cpp) on its default port 8080. */
async function detectLlamaServer(): Promise<{ found: boolean; baseUrl: string }> {
  // llama-server exposes GET /health returning {"status":"ok"}
  const candidates = ['http://localhost:8080', 'http://127.0.0.1:8080'];
  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        // Confirm it's llama-server by checking the response shape
        const data = await res.json() as Record<string, unknown>;
        // llama-server returns {"status":"ok"} or {"status":"loading model"}
        if (typeof data['status'] === 'string') {
          return { found: true, baseUrl: url };
        }
      }
    } catch { /* not available */ }
  }
  return { found: false, baseUrl: 'http://localhost:8080' };
}

export async function probe(): Promise<ProbeResult> {
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  const configDir = getConfigDir();
  const dataDir = getDataDir();
  const hasExistingConfig = existsSync(join(configDir, 'providers.json'));
  const gatewayPortFree = await isPortFree(47200);
  // Run all local-service detections in parallel for speed
  const [ollama, lmStudio, llamaServer] = await Promise.all([
    detectOllama(),
    detectLmStudio(),
    detectLlamaServer(),
  ]);

  return {
    nodeVersion,
    nodeVersionOk: major >= 20,
    platform: process.platform,
    dataDir,
    configDir,
    hasExistingConfig,
    gatewayPortFree,
    ollamaDetected: ollama.found,
    ollamaBaseUrl: ollama.baseUrl,
    lmStudioDetected: lmStudio.found,
    lmStudioBaseUrl: lmStudio.baseUrl,
    lmStudioModels: lmStudio.models,
    llamaServerDetected: llamaServer.found,
    llamaServerBaseUrl: llamaServer.baseUrl,
  };
}
