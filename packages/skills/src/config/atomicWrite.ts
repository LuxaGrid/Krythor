/**
 * @krythor/skills — Atomic file write utility
 *
 * Duplicated from @krythor/core — skills has no dep on core to avoid circular imports.
 * Strategy: write to .tmp → fsync → rename (atomic at OS level).
 */

import { writeFileSync, renameSync, unlinkSync, existsSync, openSync, fsyncSync, closeSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export function atomicWrite(filePath: string, content: string, encoding: BufferEncoding = 'utf-8'): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp`;

  try {
    writeFileSync(tmpPath, content, encoding);

    const fd = openSync(tmpPath, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

export function atomicWriteJSON(filePath: string, value: unknown): void {
  atomicWrite(filePath, JSON.stringify(value, null, 2), 'utf-8');
}
