/**
 * Tests for atomic write utility.
 *
 * Verifies:
 *   - File is written with correct content
 *   - Write is idempotent (can overwrite existing file)
 *   - No .tmp file left behind after successful write
 *   - JSON serialization via atomicWriteJSON
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { atomicWrite, atomicWriteJSON } from './atomicWrite.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'atomic-test-'));
}

describe('atomicWrite', () => {
  it('writes a file with the correct content', () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'test.txt');
    atomicWrite(filePath, 'hello world');
    expect(readFileSync(filePath, 'utf-8')).toBe('hello world');
  });

  it('overwrites an existing file', () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'test.txt');
    atomicWrite(filePath, 'first');
    atomicWrite(filePath, 'second');
    expect(readFileSync(filePath, 'utf-8')).toBe('second');
  });

  it('does not leave a .tmp file behind on success', () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'test.json');
    atomicWrite(filePath, '{}');
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
    expect(existsSync(filePath)).toBe(true);
  });

  it('creates parent directories if they do not exist', () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'nested', 'deep', 'file.txt');
    atomicWrite(filePath, 'deep content');
    expect(readFileSync(filePath, 'utf-8')).toBe('deep content');
  });
});

describe('atomicWriteJSON', () => {
  it('serialises an object to indented JSON', () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'data.json');
    atomicWriteJSON(filePath, { key: 'value', num: 42 });
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed['key']).toBe('value');
    expect(parsed['num']).toBe(42);
    // Indented — should have newlines
    expect(content).toContain('\n');
  });

  it('serialises arrays correctly', () => {
    const dir = makeTmpDir();
    const filePath = join(dir, 'list.json');
    atomicWriteJSON(filePath, [{ id: '1' }, { id: '2' }]);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Array<{ id: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.id).toBe('1');
  });
});
