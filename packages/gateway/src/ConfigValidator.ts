/**
 * ConfigValidator — validates providers.json on load.
 *
 * Wraps the parseProviderList logic from @krythor/models and surfaces
 * structured validation errors to the gateway logger. Invalid provider
 * entries are skipped; the gateway always continues (never crashes on
 * a bad config entry).
 *
 * ITEM 4 — Config schema validation
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseProviderList } from '@krythor/models';
import type { ProviderConfig } from '@krythor/models';
import { logger } from './logger.js';

export interface ConfigValidationResult {
  /** Parsed, valid provider configs. */
  providers: ProviderConfig[];
  /** Number of entries that failed validation and were skipped. */
  skippedCount: number;
  /** Human-readable error strings for each skipped/invalid field. */
  validationErrors: string[];
  /** True if providers.json does not exist. */
  fileNotFound: boolean;
  /** True if providers.json could not be parsed as JSON. */
  malformedJson: boolean;
}

/**
 * Load and validate providers.json from the given configDir.
 *
 * Validation rules (from parseProviderList / validateProviderConfig):
 *   - Each entry must have: id (string), name (string), type (valid ProviderType),
 *     endpoint (string).
 *   - authMethod is inferred if missing (api_key when apiKey present, else none).
 *   - models defaults to [] when missing.
 *   - Invalid entries are skipped; all valid entries are returned.
 *
 * On any error: logs a clear warning. Never throws. Never returns null.
 */
export function validateProvidersConfig(configDir: string): ConfigValidationResult {
  const filePath = join(configDir, 'providers.json');

  if (!existsSync(filePath)) {
    return {
      providers:        [],
      skippedCount:     0,
      validationErrors: [],
      fileNotFound:     true,
      malformedJson:    false,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('ConfigValidator: providers.json contains invalid JSON — no providers loaded', {
      file: filePath,
      error: msg,
      hint: 'Fix the JSON syntax error in providers.json or run: krythor setup',
    });
    return {
      providers:        [],
      skippedCount:     0,
      validationErrors: [`JSON parse error: ${msg}`],
      fileNotFound:     false,
      malformedJson:    true,
    };
  }

  const result = parseProviderList(raw);

  // Log each skipped provider with its validation errors
  if (result.skipped > 0 || result.errors.length > 0) {
    logger.warn('ConfigValidator: some providers were skipped due to validation errors', {
      skippedCount:     result.skipped,
      validProviders:   result.providers.length,
      validationErrors: result.errors,
      hint: 'Fix or remove invalid entries in providers.json, then run: krythor setup or POST /api/config/reload',
    });

    // Log each error individually so it's easy to find in log streams
    for (const err of result.errors) {
      logger.warn(`ConfigValidator: provider validation error — ${err}`, { file: filePath });
    }
  }

  if (result.providers.length > 0) {
    logger.info('ConfigValidator: providers.json loaded', {
      valid:   result.providers.length,
      skipped: result.skipped,
    });
  }

  return {
    providers:        result.providers,
    skippedCount:     result.skipped,
    validationErrors: result.errors,
    fileNotFound:     false,
    malformedJson:    false,
  };
}
