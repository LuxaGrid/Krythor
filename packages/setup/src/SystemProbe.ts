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
}

function getConfigDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Krythor', 'config');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Krythor', 'config');
  }
  return join(homedir(), '.local', 'share', 'krythor', 'config');
}

function getDataDir(): string {
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

export async function probe(): Promise<ProbeResult> {
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  const configDir = getConfigDir();
  const dataDir = getDataDir();
  const hasExistingConfig = existsSync(join(configDir, 'providers.json'));
  const gatewayPortFree = await isPortFree(47200);
  const ollama = await detectOllama();

  return {
    nodeVersion,
    nodeVersionOk: major >= 18,
    platform: process.platform,
    dataDir,
    configDir,
    hasExistingConfig,
    gatewayPortFree,
    ollamaDetected: ollama.found,
    ollamaBaseUrl: ollama.baseUrl,
  };
}
