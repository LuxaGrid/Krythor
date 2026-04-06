import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { ProviderConfig, ProviderType, OAuthAccount, ProviderCredential } from './types.js';
import { resolveCredential } from './credential.js';
import { parseProviderList } from './config/validate.js';
import { atomicWriteJSON } from './config/atomicWrite.js';
import { BaseProvider } from './providers/BaseProvider.js';
import { OllamaProvider } from './providers/OllamaProvider.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';
import { AnthropicProvider } from './providers/AnthropicProvider.js';
import { OpenAICompatProvider } from './providers/OpenAICompatProvider.js';
import { ClaudeAgentSdkProvider } from './providers/ClaudeAgentSdkProvider.js';

// ─── Credential Encryption ───────────────────────────────────────────────────
// AES-256-GCM with a randomly generated per-installation key stored at
// <configDir>/credential.key (hex, 32 bytes = 256 bits).
// On first start the key is generated with crypto.randomBytes and written to
// disk; on every subsequent start it is loaded from disk. The key file should
// be protected by OS file permissions (0600) and backed up alongside the data
// directory — losing it means provider credentials must be re-entered.
//
// Format: "e1:<hex-iv>:<hex-tag>:<hex-ciphertext>"
// Used for BOTH API keys and OAuth tokens — same scheme, same security level.

const ENCRYPTION_VERSION = 'e1:'; // prefix to detect encrypted values
const KEY_FILENAME = 'credential.key';

function loadOrCreateEncryptionKey(configDir: string): Buffer {
  const keyPath = join(configDir, KEY_FILENAME);
  if (existsSync(keyPath)) {
    const hex = readFileSync(keyPath, 'utf-8').trim();
    if (hex.length === 64) return Buffer.from(hex, 'hex'); // 32 bytes
    // Key file corrupted — regenerate (credentials will need to be re-entered)
    console.error('[ModelRegistry] credential.key is malformed — regenerating. Provider credentials must be re-entered.');
  }
  const key = randomBytes(32);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(keyPath, key.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
  return key;
}

// Module-level key cache — loaded once per process, keyed by configDir.
const keyCache = new Map<string, Buffer>();

function getEncryptionKey(configDir: string): Buffer {
  const cached = keyCache.get(configDir);
  if (cached) return cached;
  const key = loadOrCreateEncryptionKey(configDir);
  keyCache.set(configDir, key);
  return key;
}

function encryptSecret(plaintext: string, configDir: string): string {
  const key = getEncryptionKey(configDir);
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENCRYPTION_VERSION + [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decryptSecret(ciphertext: string, configDir: string): string {
  if (!ciphertext.startsWith(ENCRYPTION_VERSION)) return ciphertext; // plaintext (legacy)
  const parts = ciphertext.slice(ENCRYPTION_VERSION.length).split(':');
  if (parts.length !== 3) return ciphertext; // malformed — return as-is
  const [ivHex, tagHex, encHex] = parts as [string, string, string];
  try {
    const key = getEncryptionKey(configDir);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex')).toString('utf-8') + decipher.final('utf-8');
  } catch {
    return ''; // tampered or wrong key — treat as missing
  }
}

// resolveCredential is exported from credential.ts and re-exported via index.ts.
// ModelRegistry re-exports it for callers that import directly from this module.
export { resolveCredential };

// ─── ModelRegistry ────────────────────────────────────────────────────────────

export class ModelRegistry {
  private configPath: string;
  private configDir: string;
  private providers = new Map<string, BaseProvider>();
  private configs: ProviderConfig[] = [];

  constructor(configDir: string) {
    this.configDir = configDir;
    this.configPath = join(configDir, 'providers.json');
    mkdirSync(configDir, { recursive: true });
    this.load();
  }

  private encryptOAuthAccount(account: OAuthAccount): OAuthAccount {
    return {
      ...account,
      accessToken:  encryptSecret(account.accessToken, this.configDir),
      refreshToken: account.refreshToken ? encryptSecret(account.refreshToken, this.configDir) : undefined,
    };
  }

  private decryptOAuthAccount(account: OAuthAccount): OAuthAccount {
    return {
      ...account,
      accessToken:  decryptSecret(account.accessToken, this.configDir),
      refreshToken: account.refreshToken ? decryptSecret(account.refreshToken, this.configDir) : undefined,
    };
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  addProvider(input: Omit<ProviderConfig, 'id'>): ProviderConfig {
    const config: ProviderConfig = {
      id: randomUUID(),
      ...input,
      // Ensure authMethod always has a value even for legacy callers that omit it
      authMethod: input.authMethod ?? (input.apiKey ? 'api_key' : 'none'),
    };

    // If this is being set as default, clear previous default
    if (config.isDefault) {
      this.configs.forEach(c => { c.isDefault = false; });
    }

    // Encrypt credentials before persisting
    if (config.apiKey) config.apiKey = encryptSecret(config.apiKey, this.configDir);
    if (config.oauthAccount) config.oauthAccount = this.encryptOAuthAccount(config.oauthAccount);

    this.configs.push(config);
    // Instantiate with decrypted credentials so providers can use them directly
    this.providers.set(config.id, this.instantiate(this.withDecryptedCredentials(config)));
    this.save();
    // Return config with decrypted credentials to caller (route layer masks before sending to UI)
    return this.withDecryptedCredentials(config);
  }

  updateProvider(id: string, updates: Partial<Omit<ProviderConfig, 'id'>>): ProviderConfig {
    const idx = this.configs.findIndex(c => c.id === id);
    if (idx === -1) throw new Error(`Provider "${id}" not found`);

    if (updates.isDefault) {
      this.configs.forEach(c => { c.isDefault = false; });
    }

    // Encrypt any new credentials
    if (updates.apiKey !== undefined) {
      updates = { ...updates, apiKey: updates.apiKey ? encryptSecret(updates.apiKey, this.configDir) : undefined };
    }
    if (updates.oauthAccount !== undefined) {
      updates = { ...updates, oauthAccount: updates.oauthAccount ? this.encryptOAuthAccount(updates.oauthAccount) : undefined };
    }

    this.configs[idx] = { ...this.configs[idx]!, ...updates };
    this.providers.set(id, this.instantiate(this.withDecryptedCredentials(this.configs[idx]!)));
    this.save();
    return this.withDecryptedCredentials(this.configs[idx]!);
  }

  removeProvider(id: string): void {
    const idx = this.configs.findIndex(c => c.id === id);
    if (idx === -1) throw new Error(`Provider "${id}" not found`);
    this.configs.splice(idx, 1);
    this.providers.delete(id);
    this.save();
  }

  /**
   * Store OAuth account for a provider. Encrypts tokens before persisting.
   * Sets authMethod to 'oauth' and clears any existing API key.
   */
  connectOAuth(id: string, account: OAuthAccount): ProviderConfig {
    return this.updateProvider(id, {
      authMethod: 'oauth',
      oauthAccount: account,
      apiKey: undefined, // clear API key — only one auth method active at a time
    });
  }

  /**
   * Remove OAuth credentials from a provider. Reverts authMethod to 'none'.
   */
  disconnectOAuth(id: string): ProviderConfig {
    return this.updateProvider(id, {
      authMethod: 'none',
      oauthAccount: undefined,
    });
  }

  /**
   * Update OAuth tokens (e.g. after a token refresh).
   * Only updates token fields; preserves all other account metadata.
   */
  refreshOAuthTokens(id: string, accessToken: string, refreshToken?: string, expiresAt?: number): ProviderConfig {
    const cfg = this.configs.find(c => c.id === id);
    if (!cfg) throw new Error(`Provider "${id}" not found`);
    if (!cfg.oauthAccount) throw new Error(`Provider "${id}" has no OAuth account`);

    const updated: OAuthAccount = {
      ...cfg.oauthAccount,
      accessToken,
      ...(refreshToken !== undefined && { refreshToken }),
      ...(expiresAt !== undefined && { expiresAt }),
    };
    return this.updateProvider(id, { oauthAccount: updated });
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  getProvider(id: string): BaseProvider | null {
    return this.providers.get(id) ?? null;
  }

  getDefaultProvider(): BaseProvider | null {
    const cfg = this.configs.find(c => c.isDefault && c.isEnabled);
    return cfg ? (this.providers.get(cfg.id) ?? null) : null;
  }

  listConfigs(): ProviderConfig[] {
    return this.configs.map(c => this.withDecryptedCredentials(c));
  }

  listEnabled(): BaseProvider[] {
    return this.configs
      .filter(c => c.isEnabled)
      .map(c => this.providers.get(c.id))
      .filter((p): p is BaseProvider => p !== undefined);
  }

  /** Resolve normalised credential for a provider (auth-method-agnostic). */
  getCredential(id: string): ProviderCredential | null {
    const cfg = this.configs.find(c => c.id === id);
    if (!cfg) return null;
    return resolveCredential(cfg);
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /**
   * Apply ${ENV_VAR_NAME} substitution to string values in the JSON.
   * Only string fields are affected. Missing env vars log a warning and leave
   * the placeholder in place. This runs on the raw JSON string before parsing
   * so the substitution is applied uniformly to all string fields.
   */
  private static substituteEnvVars(jsonStr: string): string {
    return jsonStr.replace(/"\$\{([^}]+)\}"/g, (_match, varName: string) => {
      const value = process.env[varName];
      if (value === undefined) {
        // Log a warning — missing env vars are a common config mistake
        console.warn(
          `[ModelRegistry] providers.json: env var \${${varName}} is not set — ` +
          'leaving placeholder in place.',
        );
        return JSON.stringify(`\${${varName}}`);
      }
      return JSON.stringify(value);
    });
  }

  private load(): void {
    if (!existsSync(this.configPath)) {
      this.configs = [];
      return;
    }
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      // Apply ${ENV_VAR} substitution before parsing — allows secrets to live in
      // environment variables rather than being stored in providers.json.
      // Example: { "apiKey": "${ANTHROPIC_API_KEY}" }
      const substituted = ModelRegistry.substituteEnvVars(raw);
      const parsed = JSON.parse(substituted) as unknown;

      const { providers, skipped, errors } = parseProviderList(parsed);

      if (errors.length > 0) {
        console.error(`[ModelRegistry] Validation warnings in ${this.configPath}:\n${errors.join('\n')}`);
      }
      if (skipped > 0) {
        console.error(`[ModelRegistry] Skipped ${skipped} invalid provider(s) from ${this.configPath}`);
      }

      this.configs = providers;

      // Migrate legacy providers: add authMethod if missing, encrypt plaintext keys
      let needsSave = false;
      for (const cfg of this.configs) {
        // Backfill authMethod for configs written before dual-auth
        if (!cfg.authMethod) {
          cfg.authMethod = cfg.apiKey ? 'api_key' : 'none';
          needsSave = true;
        }
        // Strip 'models/' prefix that Gemini's API injects into model IDs
        if (cfg.models?.some(m => m.startsWith('models/'))) {
          cfg.models = cfg.models.map(m => m.replace(/^models\//, ''));
          needsSave = true;
        }
        // Filter out non-chat model types persisted from earlier runs
        // (Gemini returns imagen, veo, tts, embeddings, robotics, etc.)
        if (cfg.models && cfg.models.length > 0) {
          const nonChat = [
            'embedding', 'imagen', 'veo', 'tts', 'aqa', 'lyria',
            'robotics', 'computer-use', 'deep-research', 'audio-latest',
            'native-audio', 'realtime', 'live-preview', 'image-preview',
            'clip-preview',
          ];
          const filtered = cfg.models.filter(id =>
            !nonChat.some(nc => id.toLowerCase().includes(nc)),
          );
          if (filtered.length !== cfg.models.length) {
            cfg.models = filtered;
            needsSave = true;
          }
        }
        // Migrate plaintext API keys to encrypted
        if (cfg.apiKey && !cfg.apiKey.startsWith(ENCRYPTION_VERSION)) {
          cfg.apiKey = encryptSecret(cfg.apiKey, this.configDir);
          needsSave = true;
        }
        // Migrate plaintext OAuth tokens if somehow stored unencrypted
        if (cfg.oauthAccount) {
          let changed = false;
          if (cfg.oauthAccount.accessToken && !cfg.oauthAccount.accessToken.startsWith(ENCRYPTION_VERSION)) {
            cfg.oauthAccount.accessToken = encryptSecret(cfg.oauthAccount.accessToken, this.configDir);
            changed = true;
          }
          if (cfg.oauthAccount.refreshToken && !cfg.oauthAccount.refreshToken.startsWith(ENCRYPTION_VERSION)) {
            cfg.oauthAccount.refreshToken = encryptSecret(cfg.oauthAccount.refreshToken, this.configDir);
            changed = true;
          }
          if (changed) needsSave = true;
        }
        this.providers.set(cfg.id, this.instantiate(this.withDecryptedCredentials(cfg)));
      }
      if (needsSave) this.save();
    } catch (err) {
      console.error(`[ModelRegistry] Failed to parse ${this.configPath} — starting with no providers. Error: ${err instanceof Error ? err.message : String(err)}`);
      this.configs = [];
    }
  }

  /**
   * Reload providers from disk without restarting the process.
   *
   * Called by the gateway's config watcher when providers.json changes.
   * Replaces the in-memory provider list and provider instances with a
   * fresh parse of the on-disk file. Existing circuit-breaker state in
   * ModelRouter is preserved — this is intentional so a reload does not
   * reset an open circuit for a provider that was already failing.
   */
  reload(): void {
    this.providers.clear();
    this.load();
  }

  private save(): void {
    atomicWriteJSON(this.configPath, this.configs);
  }

  // ── Credential helpers ────────────────────────────────────────────────────

  private withDecryptedCredentials(config: ProviderConfig): ProviderConfig {
    const result = { ...config };
    if (result.apiKey) result.apiKey = decryptSecret(result.apiKey, this.configDir);
    if (result.oauthAccount) result.oauthAccount = this.decryptOAuthAccount(result.oauthAccount);
    return result;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  private instantiate(config: ProviderConfig): BaseProvider {
    const map: Record<ProviderType, new (c: ProviderConfig) => BaseProvider> = {
      ollama:              OllamaProvider,
      openai:              OpenAIProvider,
      anthropic:           AnthropicProvider,
      'openai-compat':     OpenAICompatProvider,
      gguf:                OpenAICompatProvider, // GGUF via llama-server uses OpenAI-compat API
      'claude-agent-sdk':  ClaudeAgentSdkProvider,
    };
    const Cls = map[config.type];
    if (!Cls) throw new Error(`Unknown provider type: ${config.type}`);
    return new Cls(config);
  }
}
