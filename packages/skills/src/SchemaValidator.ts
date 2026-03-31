// ─── SchemaValidator ──────────────────────────────────────────────────────────
//
// Minimal JSON Schema validator used for skill input/output validation.
// Supports the subset of JSON Schema needed for skill schemas:
//   - type: 'object' | 'string' | 'number' | 'boolean' | 'array' | 'null'
//   - properties (object)
//   - required (array of property names)
//   - items (array element schema)
//   - additionalProperties (boolean)
//
// Returns a list of validation error messages (empty = valid).
//

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonSchema = Record<string, unknown>;

function typeOf(value: JsonValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validateValue(value: JsonValue, schema: JsonSchema, path: string): string[] {
  const errors: string[] = [];

  const schemaType = schema['type'] as string | string[] | undefined;
  if (schemaType !== undefined) {
    const types = Array.isArray(schemaType) ? schemaType : [schemaType];
    const actual = typeOf(value);
    if (!types.includes(actual)) {
      errors.push(`${path}: expected type ${types.join('|')}, got ${actual}`);
      // Type mismatch — no point running further checks on the wrong type
      return errors;
    }
  }

  // Object validation
  if (typeOf(value) === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, JsonValue>;

    const required = schema['required'] as string[] | undefined;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (!(key in obj)) {
          errors.push(`${path}: missing required property "${key}"`);
        }
      }
    }

    const properties = schema['properties'] as Record<string, JsonSchema> | undefined;
    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in obj) {
          const subErrors = validateValue(obj[key] as JsonValue, propSchema, `${path}.${key}`);
          errors.push(...subErrors);
        }
      }
    }

    const additionalProperties = schema['additionalProperties'];
    if (additionalProperties === false && properties) {
      const allowed = new Set(Object.keys(properties));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          errors.push(`${path}: additional property "${key}" not allowed`);
        }
      }
    }
  }

  // Array validation
  if (Array.isArray(value)) {
    const items = schema['items'] as JsonSchema | undefined;
    if (items) {
      for (let i = 0; i < value.length; i++) {
        const subErrors = validateValue(value[i] as JsonValue, items, `${path}[${i}]`);
        errors.push(...subErrors);
      }
    }
    const minItems = schema['minItems'] as number | undefined;
    if (minItems !== undefined && value.length < minItems) {
      errors.push(`${path}: expected at least ${minItems} items, got ${value.length}`);
    }
    const maxItems = schema['maxItems'] as number | undefined;
    if (maxItems !== undefined && value.length > maxItems) {
      errors.push(`${path}: expected at most ${maxItems} items, got ${value.length}`);
    }
  }

  // String validation
  if (typeof value === 'string') {
    const minLength = schema['minLength'] as number | undefined;
    if (minLength !== undefined && value.length < minLength) {
      errors.push(`${path}: string too short (min ${minLength})`);
    }
    const maxLength = schema['maxLength'] as number | undefined;
    if (maxLength !== undefined && value.length > maxLength) {
      errors.push(`${path}: string too long (max ${maxLength})`);
    }
  }

  // Number validation
  if (typeof value === 'number') {
    const minimum = schema['minimum'] as number | undefined;
    if (minimum !== undefined && value < minimum) {
      errors.push(`${path}: value ${value} is less than minimum ${minimum}`);
    }
    const maximum = schema['maximum'] as number | undefined;
    if (maximum !== undefined && value > maximum) {
      errors.push(`${path}: value ${value} is greater than maximum ${maximum}`);
    }
  }

  return errors;
}

/**
 * Validate a parsed JSON value against a JSON Schema.
 * Returns { valid, errors }.
 */
export function validateSchema(value: unknown, schema: Record<string, unknown>): ValidationResult {
  const errors = validateValue(value as JsonValue, schema, '$');
  return { valid: errors.length === 0, errors };
}

/**
 * Attempt to parse a string as JSON and validate it against a schema.
 * Returns { valid, errors } — if the string is not valid JSON, that is an error.
 */
export function validateJsonString(raw: string, schema: Record<string, unknown>): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { valid: false, errors: ['output is not valid JSON'] };
  }
  return validateSchema(parsed, schema);
}
