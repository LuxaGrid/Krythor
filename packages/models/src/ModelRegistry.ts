import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID, createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { hostname, platform } from 'os';
import type { ProviderConfig, ProviderType } from './types.js';
import { parseProviderList } from './config/validate.js';
import { atomicWriteJSON } from './config/atomicWrite.js';
import { BaseProvider } from './providers/BaseProvider.js';
import { OllamaProvider } from './providers/OllamaProvider.js';
import { OpenAIProvider } from './providers/OpenAIProvider.js';
import { AnthropicProvider } from './providers/AnthropicProvider.js';
import { OpenAICompatProvider } from './providers/OpenAICompatProvider.js';

// ─── API Key Encryption ───────────────────────────────────────────────────────
// AES-256-GCM with a machine-derived key. No OS keychain dependency.
// The key is deterministic per machine so encrypted values survive process restarts.
// Format: "<hex-iv>:<hex-tag>:<hex-ciphertext>"

const ENCRYPTION_VERSION = 'e1:'; // prefix to detect encrypted values

function getDerivedKey(): Buffer {
  const raw = `${hostname()}${platform()}krythor-v1`;
  return createHash('sha256').update(raw).digest(); // 32 bytes
}

function encryptApiKey(plaintext: string): string {
  const key = getDerivedKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENCRYPTION_VERSION + [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decryptApiKey(ciphertext: string): string {
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
    const config: ProviderConfig = { id: randomUUID(), ...input };

    // If this is being set as default, clear previous default
    if (config.isDefault) {
      this.configs.forEach(c => { c.isDefault = false; });
    }

    if (config.apiKey) config.apiKey = encryptApiKey(config.apiKey);
    this.configs.push(config);
    // Instantiate with decrypted key so providers can use it directly
    this.providers.set(config.id, this.instantiate(this.withDecryptedKey(config)));
    this.save();
    // Return config with decrypted key to caller (route layer masks it before sending to UI)
    return this.withDecryptedKey(config);
  }

  updateProvider(id: string, updates: Partial<Omit<ProviderConfig, 'id'>>): ProviderConfig {
    const idx = this.configs.findIndex(c => c.id === id);
    if (idx === -1) throw new Error(`Provider "${id}" not found`);

    if (updates.isDefault) {
      this.configs.forEach(c => { c.isDefault = false; });
    }

    if (updates.apiKey !== undefined) {
      updates = { ...updates, apiKey: updates.apiKey ? encryptApiKey(updates.apiKey) : undefined };
    }
    this.configs[idx] = { ...this.configs[idx]!, ...updates };
    this.providers.set(id, this.instantiate(this.withDecryptedKey(this.configs[idx]!)));
    this.save();
    return this.withDecryptedKey(this.configs[idx]!);
  }

  removeProvider(id: string): void {
    const idx = this.configs.findIndex(c => c.id === id);
    if (idx === -1) throw new Error(`Provider "${id}" not found`);
    this.configs.splice(idx, 1);
    this.providers.delete(id);
    this.save();
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
    return this.configs.map(c => this.withDecryptedKey(c));
  }

  listEnabled(): BaseProvider[] {
    return this.configs
      .filter(c => c.isEnabled)
      .map(c => this.providers.get(c.id))
      .filter((p): p is BaseProvider => p !== undefined);
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

      // Migrate plaintext keys to encrypted on first load
      let needsSave = false;
      for (const cfg of this.configs) {
        if (cfg.apiKey && !cfg.apiKey.startsWith(ENCRYPTION_VERSION)) {
          cfg.apiKey = encryptApiKey(cfg.apiKey);
          needsSave = true;
        }
        this.providers.set(cfg.id, this.instantiate(this.withDecryptedKey(cfg)));
      }
      if (needsSave) this.save();
    } catch (err) {
      console.error(`[ModelRegistry] Failed to parse ${this.configPath} — starting with no providers. Error: ${err instanceof Error ? err.message : String(err)}`);
      this.configs = [];
    }
  }

  private save(): void {
    atomicWriteJSON(this.configPath, this.configs);
  }

  // ── Key helpers ────────────────────────────────────────────────────────────

  private withDecryptedKey(config: ProviderConfig): ProviderConfig {
    if (!config.apiKey) return config;
    return { ...config, apiKey: decryptApiKey(config.apiKey) };
  }

  // ── Factory ────────────────────────────────────────────────────────────────

  private instantiate(config: ProviderConfig): BaseProvider {
    const map: Record<ProviderType, new (c: ProviderConfig) => BaseProvider> = {
      ollama:        OllamaProvider,
      openai:        OpenAIProvider,
      anthropic:     AnthropicProvider,
      'openai-compat': OpenAICompatProvider,
      gguf:          OpenAICompatProvider, // GGUF via llama-server uses OpenAI-compat API
    };
    const Cls = map[config.type];
    if (!Cls) throw new Error(`Unknown provider type: ${config.type}`);
    return new Cls(config);
  }
}
