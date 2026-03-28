/**
 * StructuredOutputValidator — validates a model's text response against the
 * responseFormat declared on an InferenceRequest.
 *
 * This module intentionally avoids a heavy JSON Schema library (ajv, etc.) to
 * keep the dependency footprint minimal.  It performs lightweight structural
 * checks:
 *   - JSON.parse succeeds (both json_object and json_schema)
 *   - Top-level type matches the schema's "type" field (if present)
 *   - Required properties are present (if "required" array is present)
 *
 * These checks catch the most common model failures (not producing JSON at
 * all, producing an array when an object was expected, omitting required keys)
 * without requiring a full AJV install.  Deep type checking of nested values
 * is left to the caller.
 */

import type { ResponseFormat } from './types.js';
import { StructuredOutputError } from './StructuredOutputError.js';

/**
 * Validate `output` against `format`.
 *
 * Returns the parsed JSON value on success.
 * Throws `StructuredOutputError` on failure.
 */
export function validateStructuredOutput(output: string, format: ResponseFormat): unknown {
  // Step 1 — extract JSON from the output.  Models sometimes wrap the JSON
  // in markdown code fences; strip those before parsing.
  const cleaned = extractJson(output);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new StructuredOutputError(
      'Model response is not valid JSON',
      output,
      e instanceof Error ? e.message : String(e),
    );
  }

  if (format.type === 'json_schema' && format.schema) {
    const err = checkSchema(parsed, format.schema);
    if (err) {
      throw new StructuredOutputError(
        `Model response does not conform to the required JSON schema: ${err}`,
        output,
        err,
      );
    }
  }

  return parsed;
}

/** Strip markdown code fences if present, then trim whitespace. */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  // Match ```json ... ``` or ``` ... ```
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed;
}

/** Very lightweight JSON Schema structural check (no external deps). */
function checkSchema(value: unknown, schema: Record<string, unknown>): string | null {
  const schemaType = schema['type'] as string | undefined;
  if (schemaType) {
    const actualType = getJsonType(value);
    if (actualType !== schemaType) {
      return `expected type "${schemaType}" but got "${actualType}"`;
    }
  }

  if (schemaType === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const required = schema['required'] as string[] | undefined;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (!(key in obj)) {
          return `missing required property "${key}"`;
        }
      }
    }
  }

  return null;
}

function getJsonType(value: unknown): string {
  if (value === null)           return 'null';
  if (Array.isArray(value))     return 'array';
  return typeof value;          // 'object', 'string', 'number', 'boolean'
}
