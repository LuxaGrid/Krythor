/**
 * Credential resolution — standalone module with no dependency on BaseProvider
 * or ModelRegistry, preventing circular imports.
 */
import type { ProviderConfig, ProviderCredential } from './types.js';

const ENCRYPTION_VERSION = 'e1:';

// Re-import of the decrypt helper — duplicated here to avoid the circular chain.
// The derive-key logic must stay in sync with ModelRegistry.ts.
import { createDecipheriv, createHash } from 'crypto';
import { hostname, platform } from 'os';

function getDerivedKey(): Buffer {
  const raw = `${hostname()}${platform()}krythor-v1`;
  return createHash('sha256').update(raw).digest();
}

function decryptSecret(ciphertext: string): string {
  if (!ciphertext.startsWith(ENCRYPTION_VERSION)) return ciphertext;
  const parts = ciphertext.slice(ENCRYPTION_VERSION.length).split(':');
  if (parts.length !== 3) return ciphertext;
  const [ivHex, tagHex, encHex] = parts as [string, string, string];
  try {
    const key = getDerivedKey();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex')).toString('utf-8') + decipher.final('utf-8');
  } catch {
    return '';
  }
}

/**
 * Returns a normalised ProviderCredential from a ProviderConfig regardless of
 * whether auth came from OAuth or an API key. Returns null if no credential is
 * configured or the stored credential is empty/tampered.
 *
 * All providers call this at request time — downstream code is auth-method-agnostic.
 */
export function resolveCredential(config: ProviderConfig): ProviderCredential | null {
  if (config.authMethod === 'oauth' && config.oauthAccount) {
    const token = decryptSecret(config.oauthAccount.accessToken);
    if (!token) return null;
    return { token, source: 'oauth' };
  }
  if (config.authMethod === 'api_key' && config.apiKey) {
    const token = decryptSecret(config.apiKey);
    if (!token) return null;
    return { token, source: 'api_key' };
  }
  if (config.authMethod === 'none') {
    return { token: '', source: 'none' };
  }
  return null;
}
