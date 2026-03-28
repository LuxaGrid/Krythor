import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, readdirSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes, randomUUID } from 'crypto';

export type AuthMethod = 'api_key' | 'oauth' | 'none';

// ─── SecretRef ─────────────────────────────────────────────────────────────────
// Stores credentials as references instead of plaintext values.
// The runtime resolves these at startup; the wizard validates them before saving.

export type SecretRef =
  | { type: 'env';  name: string }
  | { type: 'file'; path: string }
  | { type: 'exec'; command: string };

export interface ProviderEntry {
  id: string;
  name: string;
  type: string;
  endpoint: string;          // canonical field name matching ProviderConfig
  authMethod: AuthMethod;
  apiKey?: string;
  apiKeyRef?: SecretRef;     // alternative to apiKey — resolved at runtime
  isDefault: boolean;
  isEnabled: boolean;
  models: string[];
  /** Onboarding hint for the UI. 'oauth_available' = user skipped auth; prompt them to connect. */
  setupHint?: string;
}

export interface ProvidersFile {
  version: string;
  providers: ProviderEntry[];
}

export interface AppConfig {
  selectedAgentId?: string;
  selectedModel?: string;
  onboardingComplete?: boolean;
  workspaceDir?: string;
}

export interface GatewayAuthConfig {
  mode: 'token' | 'none';
  token?: string;        // plaintext token
  tokenRef?: SecretRef;  // alternative: resolve token from env/file/exec at runtime
}

export interface GatewayConfig {
  port: number;
  bind: string;
  auth: GatewayAuthConfig;
  tailscale?: {
    enabled: boolean;
    hostname?: string;
  };
}

export interface ChannelConfig {
  telegram?:    { enabled: boolean; botToken: string };
  discord?:     { enabled: boolean; botToken: string; guildId?: string };
  slack?:       { enabled: boolean; botToken: string; appToken: string };
  whatsapp?:    { enabled: boolean; sessionDir?: string };
  googlechat?:  { enabled: boolean; webhookUrl: string };
  mattermost?:  { enabled: boolean; serverUrl: string; botToken: string; teamId?: string };
  signal?:      { enabled: boolean; apiUrl: string; phoneNumber: string };
  bluebubbles?: { enabled: boolean; serverUrl: string; password: string };
  imessage?:    { enabled: boolean; method: 'applescript' | 'bluebubbles' };
}

export interface WebSearchConfig {
  enabled: boolean;
  provider: string;
  apiKey?: string;
}

export interface RemoteClientConfig {
  mode: 'remote';
  gatewayUrl: string;
  authToken: string | SecretRef;
}

export interface SkillSeedEntry {
  name: string;
  description: string;
  systemPrompt: string;
  tags: string[];
  permissions: string[];
}

// ─── Installer ────────────────────────────────────────────────────────────────

export class Installer {
  constructor(private readonly configDir: string) {}

  ensureDirs(dataDir: string): void {
    mkdirSync(this.configDir, { recursive: true });
    mkdirSync(join(dataDir, 'memory'), { recursive: true });
  }

  hasProviders(): boolean {
    const f = join(this.configDir, 'providers.json');
    if (!existsSync(f)) return false;
    try {
      const d = JSON.parse(readFileSync(f, 'utf8')) as ProvidersFile;
      return d.providers.length > 0;
    } catch { return false; }
  }

  hasDefaultAgent(): boolean {
    const f = join(this.configDir, 'agents.json');
    if (!existsSync(f)) return false;
    try {
      const list = JSON.parse(readFileSync(f, 'utf8'));
      return Array.isArray(list) && list.length > 0;
    } catch { return false; }
  }

  addProvider(entry: Omit<ProviderEntry, 'id'>): ProviderEntry {
    const f = join(this.configDir, 'providers.json');
    let file: ProvidersFile = { version: '1', providers: [] };
    if (existsSync(f)) {
      try {
        const parsed = JSON.parse(readFileSync(f, 'utf8')) as ProvidersFile;
        file = { version: parsed.version ?? '1', providers: Array.isArray(parsed.providers) ? parsed.providers : [] };
      } catch {}
    }

    if (entry.isDefault) {
      file.providers.forEach(p => { p.isDefault = false; });
    }

    const provider: ProviderEntry = { ...entry, id: randomUUID() };
    file.providers.push(provider);
    writeFileSync(f, JSON.stringify(file, null, 2), 'utf8');
    return provider;
  }

  // Writes agents.json as a plain AgentDefinition[] array (what AgentRegistry.load() expects)
  writeDefaultAgent(): void {
    const f = join(this.configDir, 'agents.json');
    if (existsSync(f)) {
      try {
        const existing = JSON.parse(readFileSync(f, 'utf8'));
        if (Array.isArray(existing) && existing.length > 0) return; // already has agents
      } catch {}
    }
    const now = Date.now();
    const defaultAgent = [
      {
        id: 'krythor-default',
        name: 'Krythor',
        description: 'General-purpose AI assistant',
        systemPrompt: [
          'You are Krythor, a helpful local-first AI assistant.',
          'You are concise, accurate, and practical.',
          'When you have memory context available, use it to give more relevant responses.',
          'If you are unsure about something, say so clearly.',
        ].join(' '),
        memoryScope: 'session',
        maxTurns: 10,
        temperature: 0.7,
        tags: ['default'],
        createdAt: now,
        updatedAt: now,
      },
    ];
    writeFileSync(f, JSON.stringify(defaultAgent, null, 2), 'utf8');
  }

  writeAppConfig(config: Partial<AppConfig>): void {
    const f = join(this.configDir, 'app-config.json');
    let existing: Record<string, unknown> = {};
    if (existsSync(f)) {
      try { existing = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>; } catch {}
    }
    const merged = { ...existing, ...config };
    writeFileSync(f, JSON.stringify(merged, null, 2), 'utf8');
  }

  readAppConfig(): AppConfig {
    const f = join(this.configDir, 'app-config.json');
    if (!existsSync(f)) return {};
    try { return JSON.parse(readFileSync(f, 'utf8')) as AppConfig; } catch { return {}; }
  }

  /**
   * Find the most recent pre-migration backup for the given DB file.
   */
  findLatestBackup(dbFilePath: string): string | undefined {
    const dir = join(dbFilePath, '..');
    const base = dbFilePath.split(/[\\/]/).pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return undefined;
    }
    const backups = entries
      .filter(f => f.startsWith(base + '.') && f.endsWith('.bak'))
      .sort();
    if (backups.length === 0) return undefined;
    return join(dir, backups[backups.length - 1]!);
  }

  restoreBackup(backupPath: string, dbFilePath: string): void {
    if (!existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    copyFileSync(backupPath, dbFilePath);
  }

  /**
   * Install workspace template files to the user's data directory.
   * Only copies files that do not already exist — never overwrites user edits.
   */
  installTemplates(dataDir: string, sourceDir?: string): string[] {
    const candidateSourceDirs = [
      sourceDir,
      join(__dirname, '..', '..', '..', '..', 'docs', 'templates'),
      join(__dirname, '..', '..', '..', 'docs', 'templates'),
    ].filter(Boolean) as string[];

    let resolvedSource: string | undefined;
    for (const d of candidateSourceDirs) {
      if (existsSync(d)) { resolvedSource = d; break; }
    }
    if (!resolvedSource) return [];

    const destDir = join(dataDir, 'templates');
    mkdirSync(destDir, { recursive: true });

    const installed: string[] = [];
    let entries: string[];
    try { entries = readdirSync(resolvedSource); } catch { return []; }

    for (const file of entries) {
      if (!file.endsWith('.md')) continue;
      const dest = join(destDir, file);
      if (existsSync(dest)) continue;
      try {
        copyFileSync(join(resolvedSource, file), dest);
        installed.push(file);
      } catch { /* non-fatal */ }
    }

    return installed;
  }

  writeGatewayConfig(config: GatewayConfig): void {
    const f = join(this.configDir, 'gateway.json');
    let existing: Partial<GatewayConfig> = {};
    if (existsSync(f)) {
      try { existing = JSON.parse(readFileSync(f, 'utf8')) as Partial<GatewayConfig>; } catch {}
    }
    writeFileSync(f, JSON.stringify({ ...existing, ...config }, null, 2), 'utf8');
  }

  readGatewayConfig(): Partial<GatewayConfig> {
    const f = join(this.configDir, 'gateway.json');
    if (!existsSync(f)) return {};
    try { return JSON.parse(readFileSync(f, 'utf8')) as Partial<GatewayConfig>; } catch { return {}; }
  }

  ensureGatewayDefaults(): void {
    const f = join(this.configDir, 'gateway.json');
    if (existsSync(f)) return;
    const config: GatewayConfig = {
      port: 47200,
      bind: '127.0.0.1',
      auth: {
        mode: 'token',
        token: randomBytes(32).toString('hex'),
      },
      tailscale: { enabled: false },
    };
    writeFileSync(f, JSON.stringify(config, null, 2), 'utf8');
  }

  writeChannelsConfig(config: ChannelConfig): void {
    const f = join(this.configDir, 'channels.json');
    let existing: ChannelConfig = {};
    if (existsSync(f)) {
      try { existing = JSON.parse(readFileSync(f, 'utf8')) as ChannelConfig; } catch {}
    }
    const merged: ChannelConfig = { ...existing };
    if (config.telegram)    merged.telegram    = config.telegram;
    if (config.discord)     merged.discord     = config.discord;
    if (config.slack)       merged.slack       = config.slack;
    if (config.whatsapp)    merged.whatsapp    = config.whatsapp;
    if (config.googlechat)  merged.googlechat  = config.googlechat;
    if (config.mattermost)  merged.mattermost  = config.mattermost;
    if (config.signal)      merged.signal      = config.signal;
    if (config.bluebubbles) merged.bluebubbles = config.bluebubbles;
    if (config.imessage)    merged.imessage    = config.imessage;
    writeFileSync(f, JSON.stringify(merged, null, 2), 'utf8');
  }

  writeWebSearchConfig(config: WebSearchConfig): void {
    const f = join(this.configDir, 'websearch.json');
    writeFileSync(f, JSON.stringify(config, null, 2), 'utf8');
  }

  writeStartScript(gatewayDistPath: string, scriptDir: string): void {
    mkdirSync(scriptDir, { recursive: true });
    if (process.platform === 'win32') {
      writeFileSync(join(scriptDir, 'krythor.bat'), `@echo off\nnode "${gatewayDistPath}" %*\n`, 'utf8');
    } else {
      const p = join(scriptDir, 'krythor.sh');
      writeFileSync(p, `#!/bin/sh\nexec node "${gatewayDistPath}" "$@"\n`, 'utf8');
      try { chmodSync(p, 0o755); } catch {}
    }
  }

  /** Write workspace directory to app-config and create the directory. */
  writeWorkspaceConfig(workspaceDir: string): void {
    mkdirSync(workspaceDir, { recursive: true });
    this.writeAppConfig({ workspaceDir });
  }

  /** Write remote-client.json — used when running as a thin client against a remote gateway. */
  writeRemoteClientConfig(config: RemoteClientConfig): void {
    const f = join(this.configDir, 'remote-client.json');
    writeFileSync(f, JSON.stringify(config, null, 2), 'utf8');
  }

  /**
   * Seed built-in skills into skills.json.
   * Skips any skill whose name already exists to avoid duplicating on re-run.
   */
  writeSkillsConfig(skills: SkillSeedEntry[]): void {
    const f = join(this.configDir, 'skills.json');
    let existing: Record<string, unknown>[] = [];
    if (existsSync(f)) {
      try {
        const parsed = JSON.parse(readFileSync(f, 'utf8'));
        if (Array.isArray(parsed)) existing = parsed as Record<string, unknown>[];
      } catch {}
    }
    const existingNames = new Set(existing.map(s => s['name'] as string));
    const now = Date.now();
    const toAdd = skills
      .filter(s => !existingNames.has(s.name))
      .map(s => ({
        id: randomUUID(),
        ...s,
        enabled: true,
        userInvocable: true,
        version: 1,
        runCount: 0,
        createdAt: now,
        updatedAt: now,
      }));
    if (toAdd.length > 0) {
      writeFileSync(f, JSON.stringify([...existing, ...toAdd], null, 2), 'utf8');
    }
  }

  /**
   * Validate that a SecretRef is currently resolvable.
   * Returns the resolved value, or undefined if it cannot be resolved.
   * Never throws.
   */
  resolveSecretRef(ref: SecretRef): string | undefined {
    try {
      if (ref.type === 'env') {
        const val = process.env[ref.name];
        return val && val.length > 0 ? val : undefined;
      }
      if (ref.type === 'file') {
        if (!existsSync(ref.path)) return undefined;
        return readFileSync(ref.path, 'utf8').trim() || undefined;
      }
      if (ref.type === 'exec') {
        const result = execSync(ref.command, { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })
          .toString().trim();
        return result || undefined;
      }
    } catch { /* unresolvable */ }
    return undefined;
  }

  /**
   * Generate and install a daemon supervisor unit for the current platform.
   *
   * Returns the list of files written and any manual instructions to print.
   * Does NOT start or enable the daemon — caller prints the instructions.
   */
  writeDaemonConfig(opts: {
    platform: string;
    isWSL2: boolean;
    gatewayDistPath: string;
    configDir: string;
    dataDir: string;
    tokenOrRef?: string | SecretRef;
  }): { written: string[]; instructions: string[] } {
    const { platform, isWSL2, gatewayDistPath, configDir, dataDir, tokenOrRef } = opts;
    const written: string[] = [];
    const instructions: string[] = [];
    const nodePath = process.execPath;

    // Resolve env var name for token injection
    let envLine = '';
    let tokenEnvName: string | undefined;
    if (tokenOrRef) {
      if (typeof tokenOrRef === 'string') {
        // Plaintext token — embed directly via KRYTHOR_GATEWAY_TOKEN env
        tokenEnvName = undefined; // will be embedded inline
      } else if (tokenOrRef.type === 'env') {
        tokenEnvName = tokenOrRef.name;
      } else {
        // file/exec refs cannot be inlined into supervisor units safely
        instructions.push(
          `Note: your gateway token uses a ${tokenOrRef.type} SecretRef.`,
          `Make sure the token is available before starting the daemon.`,
        );
      }
    }

    if (platform === 'darwin' && !isWSL2) {
      // ── macOS LaunchAgent ────────────────────────────────────────────────────
      const plistDir = join(homedir(), 'Library', 'LaunchAgents');
      mkdirSync(plistDir, { recursive: true });
      const plistPath = join(plistDir, 'io.krythor.gateway.plist');

      const envVars: string[] = [
        `      <key>KRYTHOR_CONFIG_DIR</key>\n      <string>${configDir}</string>`,
        `      <key>KRYTHOR_DATA_DIR</key>\n      <string>${dataDir}</string>`,
      ];
      if (typeof tokenOrRef === 'string' && tokenOrRef) {
        envVars.push(`      <key>KRYTHOR_GATEWAY_TOKEN</key>\n      <string>${tokenOrRef}</string>`);
      } else if (tokenEnvName) {
        // Reference env var — user must set it in their shell profile
        instructions.push(
          `Add to your ~/.zshrc or ~/.bash_profile:`,
          `  export ${tokenEnvName}="<your-token>"`,
        );
        envVars.push(`      <key>KRYTHOR_GATEWAY_TOKEN</key>\n      <string>$(${tokenEnvName})</string>`);
      }

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.krythor.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${gatewayDistPath}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envVars.join('\n')}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${dataDir}/gateway.log</string>
  <key>StandardErrorPath</key>
  <string>${dataDir}/gateway.err</string>
</dict>
</plist>
`;
      writeFileSync(plistPath, plist, 'utf8');
      written.push(plistPath);
      instructions.push(
        `To load now:    launchctl load "${plistPath}"`,
        `To unload:      launchctl unload "${plistPath}"`,
        `Logs:           ${dataDir}/gateway.log`,
      );

    } else if (platform === 'linux' || isWSL2) {
      // ── Linux / WSL2 systemd user unit ───────────────────────────────────────
      const systemdDir = join(homedir(), '.config', 'systemd', 'user');
      mkdirSync(systemdDir, { recursive: true });
      const unitPath = join(systemdDir, 'krythor-gateway.service');

      const envLines: string[] = [
        `Environment=KRYTHOR_CONFIG_DIR=${configDir}`,
        `Environment=KRYTHOR_DATA_DIR=${dataDir}`,
      ];
      if (typeof tokenOrRef === 'string' && tokenOrRef) {
        envLines.push(`Environment=KRYTHOR_GATEWAY_TOKEN=${tokenOrRef}`);
      } else if (tokenEnvName) {
        envLines.push(`Environment=KRYTHOR_GATEWAY_TOKEN=%${tokenEnvName}%`);
        instructions.push(
          `Set ${tokenEnvName} in your environment before enabling the unit,`,
          `or use systemd's EnvironmentFile for secrets.`,
        );
      }
      envLine = envLines.join('\n');

      const unit = `[Unit]
Description=Krythor AI Gateway
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${gatewayDistPath}
${envLine}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
      writeFileSync(unitPath, unit, 'utf8');
      written.push(unitPath);

      if (isWSL2) {
        instructions.push(
          `WSL2 systemd requires WSL version 0.67.6+. Check with: wsl --version`,
          `Enable systemd in /etc/wsl.conf: [boot]\\nsystemd=true`,
        );
      }
      instructions.push(
        `systemctl --user daemon-reload`,
        `systemctl --user enable krythor-gateway`,
        `systemctl --user start krythor-gateway`,
        `systemctl --user status krythor-gateway`,
      );

    } else if (platform === 'win32') {
      // ── Windows Task Scheduler ───────────────────────────────────────────────
      // We cannot register a task non-interactively without elevation.
      // Print the schtasks command for the user to run manually.
      const escapedNode = nodePath.replace(/"/g, '\\"');
      const escapedGateway = gatewayDistPath.replace(/"/g, '\\"');
      const schtasksCmd =
        `schtasks /Create /TN "Krythor Gateway" /TR "\\"${escapedNode}\\" \\"${escapedGateway}\\"" ` +
        `/SC ONLOGON /RL HIGHEST /F`;
      instructions.push(
        `Run this in an elevated Command Prompt to register the task:`,
        `  ${schtasksCmd}`,
        `To start now:   schtasks /Run /TN "Krythor Gateway"`,
        `To remove:      schtasks /Delete /TN "Krythor Gateway" /F`,
      );
    }

    return { written, instructions };
  }
}
