/**
 * @krythor/core — Atomic file write utility
 *
 * Guarantees that a config file is never left in a partially-written state
 * if the process crashes mid-write.
 *
 * Strategy:
 *   1. Write content to a .tmp sibling file
 *   2. Sync the file descriptor (flush OS buffers to disk)
 *   3. Atomically rename .tmp → target (rename is atomic on all major OS/FS combinations)
 *   4. Clean up .tmp on any error
 *
 * This ensures readers always see either the old file or the new file — never a torn write.
 */

import { writeFileSync, renameSync, unlinkSync, existsSync, openSync, fsyncSync, closeSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * Write `content` to `filePath` atomically.
 * Throws if the write or rename fails — callers should catch.
 */
export function atomicWrite(filePath: string, content: string, encoding: BufferEncoding = 'utf-8'): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp`;

  try {
    // Step 1: write to .tmp
    writeFileSync(tmpPath, content, encoding);

    // Step 2: fsync — flush OS page cache to disk
    // This prevents data loss if the machine loses power after rename but before flush.
    const fd = openSync(tmpPath, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    // Step 3: atomic rename — on POSIX this is guaranteed atomic.
    // On Windows (NTFS), renameSync uses MoveFileExW with MOVEFILE_REPLACE_EXISTING
    // which is atomic at the metadata level (not a guaranteed POSIX rename, but
    // safe for config files — the worst case is the rename fails, leaving .tmp behind).
    renameSync(tmpPath, filePath);
  } catch (err) {
    // Step 4: cleanup — remove .tmp so it doesn't confuse future reads
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}

/**
 * Serialize `value` to indented JSON and write atomically.
 */
export function atomicWriteJSON(filePath: string, value: unknown): void {
  atomicWrite(filePath, JSON.stringify(value, null, 2), 'utf-8');
}
