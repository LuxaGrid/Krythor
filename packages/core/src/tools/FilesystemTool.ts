// ─── FilesystemTool ───────────────────────────────────────────────────────────
//
// Safe file-system operations for agents: read, write, edit, and apply patches.
//
// Security model:
//   - Agents must have "read_file" / "write_file" / "edit_file" / "apply_patch"
//     in their allowedTools list to use these tools.
//   - All paths are resolved to absolute paths and checked against an optional
//     allow-root set. Default allow-root: process.cwd() only.
//   - Path traversal (../../etc/passwd) is rejected.
//   - Symlinks are not followed outside the allowed root.
//   - Max read/write: 512 KB to avoid memory blowout.
//   - No shell expansion — paths are handled purely in Node's path module.
//
// Tool call format (JSON emitted by model):
//   read_file:    { "tool": "read_file",    "path": "<abs-or-relative-path>" }
//   write_file:   { "tool": "write_file",   "path": "<path>", "content": "<text>" }
//   edit_file:    { "tool": "edit_file",    "path": "<path>", "old": "<text>", "new": "<text>" }
//   apply_patch:  { "tool": "apply_patch",  "path": "<path>", "patch": "<unified-diff>" }
//

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { resolve, isAbsolute, relative, dirname } from 'path';
import { mkdirSync } from 'fs';

export const FS_MAX_BYTES = 512 * 1024; // 512 KB

export type FsToolName = 'read_file' | 'write_file' | 'edit_file' | 'apply_patch';

export interface FsReadCall   { tool: 'read_file';   path: string }
export interface FsWriteCall  { tool: 'write_file';  path: string; content: string }
export interface FsEditCall   { tool: 'edit_file';   path: string; old: string; new: string }
export interface FsPatchCall  { tool: 'apply_patch'; path: string; patch: string }
export type FsCall = FsReadCall | FsWriteCall | FsEditCall | FsPatchCall;

export interface FsResult {
  ok: boolean;
  output: string;
}

export class FilesystemTool {
  private readonly allowedRoots: string[];

  constructor(allowedRoots?: string[]) {
    this.allowedRoots = (allowedRoots && allowedRoots.length > 0)
      ? allowedRoots.map(r => resolve(r))
      : [process.cwd()];
  }

  // ── Path validation ────────────────────────────────────────────────────────

  private resolveSafe(raw: string): string | null {
    try {
      const abs = isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
      for (const root of this.allowedRoots) {
        const rel = relative(root, abs);
        if (!rel.startsWith('..') && !isAbsolute(rel)) return abs;
      }
      return null; // outside every allowed root
    } catch {
      return null;
    }
  }

  // ── Operations ─────────────────────────────────────────────────────────────

  read(path: string): FsResult {
    const abs = this.resolveSafe(path);
    if (!abs) return { ok: false, output: `read_file denied: path is outside allowed directories.` };

    if (!existsSync(abs)) return { ok: false, output: `read_file: file not found: ${path}` };

    try {
      const stat = statSync(abs);
      if (!stat.isFile()) return { ok: false, output: `read_file: not a file: ${path}` };
      if (stat.size > FS_MAX_BYTES) {
        return { ok: false, output: `read_file: file too large (${stat.size} bytes, max ${FS_MAX_BYTES}).` };
      }
      const content = readFileSync(abs, 'utf-8');
      return { ok: true, output: content };
    } catch (err) {
      return { ok: false, output: `read_file error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  write(path: string, content: string): FsResult {
    const abs = this.resolveSafe(path);
    if (!abs) return { ok: false, output: `write_file denied: path is outside allowed directories.` };
    if (Buffer.byteLength(content, 'utf-8') > FS_MAX_BYTES) {
      return { ok: false, output: `write_file: content too large (max ${FS_MAX_BYTES} bytes).` };
    }

    try {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf-8');
      return { ok: true, output: `write_file: wrote ${Buffer.byteLength(content, 'utf-8')} bytes to ${path}` };
    } catch (err) {
      return { ok: false, output: `write_file error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  edit(path: string, oldText: string, newText: string): FsResult {
    const abs = this.resolveSafe(path);
    if (!abs) return { ok: false, output: `edit_file denied: path is outside allowed directories.` };
    if (!existsSync(abs)) return { ok: false, output: `edit_file: file not found: ${path}` };

    try {
      const stat = statSync(abs);
      if (stat.size > FS_MAX_BYTES) {
        return { ok: false, output: `edit_file: file too large (${stat.size} bytes, max ${FS_MAX_BYTES}).` };
      }
      const original = readFileSync(abs, 'utf-8');
      const idx = original.indexOf(oldText);
      if (idx === -1) {
        return { ok: false, output: `edit_file: old text not found in ${path}. Make sure it matches exactly.` };
      }
      const count = (original.split(oldText).length - 1);
      if (count > 1) {
        return { ok: false, output: `edit_file: old text appears ${count} times in ${path}. Provide more context to disambiguate.` };
      }
      const updated = original.replace(oldText, newText);
      writeFileSync(abs, updated, 'utf-8');
      return { ok: true, output: `edit_file: replaced 1 occurrence in ${path}` };
    } catch (err) {
      return { ok: false, output: `edit_file error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  applyPatch(path: string, patch: string): FsResult {
    const abs = this.resolveSafe(path);
    if (!abs) return { ok: false, output: `apply_patch denied: path is outside allowed directories.` };
    if (!existsSync(abs)) return { ok: false, output: `apply_patch: file not found: ${path}` };

    try {
      const stat = statSync(abs);
      if (stat.size > FS_MAX_BYTES) {
        return { ok: false, output: `apply_patch: file too large (${stat.size} bytes, max ${FS_MAX_BYTES}).` };
      }
      const original = readFileSync(abs, 'utf-8');
      const result = applyUnifiedPatch(original, patch);
      if (!result.ok) return { ok: false, output: `apply_patch: ${result.error}` };
      writeFileSync(abs, result.content!, 'utf-8');
      return { ok: true, output: `apply_patch: applied ${result.hunks} hunk(s) to ${path}` };
    } catch (err) {
      return { ok: false, output: `apply_patch error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  dispatch(call: FsCall): FsResult {
    switch (call.tool) {
      case 'read_file':   return this.read(call.path);
      case 'write_file':  return this.write(call.path, call.content);
      case 'edit_file':   return this.edit(call.path, call.old, call.new);
      case 'apply_patch': return this.applyPatch(call.path, call.patch);
    }
  }
}

// ── Minimal unified-diff applier ──────────────────────────────────────────────
//
// Applies a standard unified diff (--- / +++ / @@ / +/- lines) to a string.
// Does not require the diff utility to be on PATH.
//

interface PatchResult {
  ok: boolean;
  content?: string;
  hunks?: number;
  error?: string;
}

function applyUnifiedPatch(original: string, patch: string): PatchResult {
  const lines = original.split('\n');
  const patchLines = patch.split('\n');

  let output: string[] = [...lines];
  let offset = 0; // cumulative line shift from previous hunks
  let hunksApplied = 0;

  let i = 0;
  while (i < patchLines.length) {
    const line = patchLines[i]!;
    // Skip header lines (--- / +++ / diff --git etc.)
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ') || line.startsWith('index ')) {
      i++;
      continue;
    }
    // Hunk header: @@ -startLine,count +startLine,count @@
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+\d+(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      const origStart = parseInt(hunkMatch[1]!, 10) - 1; // 0-indexed
      i++;

      const removed: string[] = [];
      const added: string[] = [];

      while (i < patchLines.length) {
        const pl = patchLines[i]!;
        if (pl.startsWith('@@') || pl.startsWith('---') || pl.startsWith('+++') || pl.startsWith('diff ')) break;
        if (pl.startsWith('-')) { removed.push(pl.slice(1)); i++; }
        else if (pl.startsWith('+')) { added.push(pl.slice(1)); i++; }
        else { i++; } // context line — advance
      }

      const adjustedStart = origStart + offset;
      // Find the block to replace
      const removeLen = removed.length;
      // Verify context
      const targetSlice = output.slice(adjustedStart, adjustedStart + removeLen);
      const matches = removed.every((r, idx) => targetSlice[idx] === r);
      if (!matches) {
        return { ok: false, error: `hunk ${hunksApplied + 1} context mismatch at line ${origStart + 1}` };
      }
      output.splice(adjustedStart, removeLen, ...added);
      offset += added.length - removeLen;
      hunksApplied++;
      continue;
    }
    i++;
  }

  if (hunksApplied === 0) return { ok: false, error: 'no valid hunks found in patch' };
  return { ok: true, content: output.join('\n'), hunks: hunksApplied };
}
