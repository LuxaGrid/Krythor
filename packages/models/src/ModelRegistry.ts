import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID, createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { hostname, platform } from 'os';
import type { ProviderConfig, ProviderType, OAuthAccount, ProviderCredential } from './types.js';
import { resolveCredential } from './credential.js';
import { parseProviderList } from './config/validate.js';
import { atomicWriteJSON } from './config/atomicWrite.js';
import { BaseProvider } from './providers/BaseProvider.js';
import { OllamaProvider } from './providers/OllamaProvider.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';
import { AnthropicProvider } from './providers/AnthropicProvider.js';
import { OpenAICompatProvider } from './providers/OpenAICompatProvider.js';

// ─── Credential Encryption ───────────────────────────────────────────────────
// AES-256-GCM with a machine-derived key. No OS keychain dependency.
// The key is deterministic per machine so encrypted values survive process restarts.
// Format: "<hex-iv>:<hex-tag>:<hex-ciphertext>"
// Used for BOTH API keys and OAuth tokens — same scheme, same security level.

const ENCRYPTION_VERSION = 'e1:'; // prefix to detect encrypted values

function getDerivedKey(): Buffer {
  const raw = `${hostname()}${platform()}krythor-v1`;
  return createHash('sha256').update(raw).digest(); // 32 bytes
}

function encryptSecret(plaintext: string): string {
  const key = getDerivedKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENCRYPTION_VERSION + [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decryptSecret(ciphertext: string): string {
  if (!ciphertext.startsWith(ENCRYPTION_VERSION)) return ciphertext; // plaintext (legacy)
  const parts = ciphertext.slice(ENCRYPTION_VERSION.length).split(':');
  if (parts.length !== 3) return ciphertext; // malformed — return as-is
  const [ivHex, tagHex, encHex] = parts as [string, string, string];
  try {
    const key = getDerivedKey();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex')).toString('utf-8') + decipher.final('utf-8');
  } catch {
    return ''; // tampered or wrong machine key — treat as missing
  }
}

function encryptOAuthAccount(account: OAuthAccount): OAuthAccount {
  return {
    ...account,
    accessToken:  encryptSecret(account.accessToken),
    refreshToken: account.refreshToken ? encryptSecret(account.refreshToken) : undefined,
  };
}

function decryptOAuthAccount(account: OAuthAccount): OAuthAccount {
  return {
    ...account,
    accessToken:  decryptSecret(account.accessToken),
    refreshToken: account.refreshToken ? decryptSecret(account.refreshToken) : undefined,
  };
}

// resolveCredential is exported from credential.ts and re-exported via index.ts.
// ModelRegistry re-exports it for callers that import directly from this module.
export { resolveCredential };

// ─── ModelRegistry ────────────────────────────────────────────────────────────

export class ModelRegistry {
  private configPath: string;
  private providers = new Map<string, BaseProvider>();
  private configs: ProviderConfig[] = [];

  constructor(configDir: string) {
    this.configPath = join(configDir, 'providers.json');
    mkdirSync(configDir, { recursive: true });
    this.load();
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
    if (config.apiKey) config.apiKey = encryptSecret(config.apiKey);
    if (config.oauthAccount) config.oauthAccount = encryptOAuthAccount(config.oauthAccount);

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
      updates = { ...updates, apiKey: updates.apiKey ? encryptSecret(updates.apiKey) : undefined };
    }
    if (updates.oauthAccount !== undefined) {
      updates = { ...updates, oauthAccount: updates.oauthAccount ? encryptOAuthAccount(updates.oauthAccount) : undefined };
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

  private load(): void {
    if (!existsSync(this.configPath)) {
      this.configs = [];
      return;
    }
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;

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
        // Migrate plaintext API keys to encrypted
        if (cfg.apiKey && !cfg.apiKey.startsWith(ENCRYPTION_VERSION)) {
          cfg.apiKey = encryptSecret(cfg.apiKey);
          needsSave = true;
        }
        // Migrate plaintext OAuth tokens if somehow stored unencrypted
        if (cfg.oauthAccount) {
          let changed = false;
          if (cfg.oauthAccount.accessToken && !cfg.oauthAccount.accessToken.startsWith(ENCRYPTION_VERSION)) {
            cfg.oauthAccount.accessToken = encryptSecret(cfg.oauthAccount.accessToken);
            changed = true;
          }
          if (cfg.oauthAccount.refreshToken && !cfg.oauthAccount.refreshToken.startsWith(ENCRYPTION_VERSION)) {
            cfg.oauthAccount.refreshToken = encryptSecret(cfg.oauthAccount.refreshToken);
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
    if (result.apiKey) result.apiKey = decryptSecret(result.apiKey);
    if (result.oauthAccount) result.oauthAccount = decryptOAuthAccount(result.oauthAccount);
    return result;
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  private instantiate(config: ProviderConfig): BaseProvider {
    const map: Record<ProviderType, new (c: ProviderConfig) => BaseProvider> = {
      ollama:          OllamaProvider,
      openai:          OpenAIProvider,
      anthropic:       AnthropicProvider,
      'openai-compat': OpenAICompatProvider,
      gguf:            OpenAICompatProvider, // GGUF via llama-server uses OpenAI-compat API
    };
    const Cls = map[config.type];
    if (!Cls) throw new Error(`Unknown provider type: ${config.type}`);
    return new Cls(config);
  }
}
