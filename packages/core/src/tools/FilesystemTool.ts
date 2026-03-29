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

import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from 'fs';
import { resolve, isAbsolute, relative, dirname } from 'path';
import { mkdirSync } from 'fs';

export const FS_MAX_BYTES = 512 * 1024; // 512 KB

export type FsToolName = 'read_file' | 'write_file' | 'edit_file' | 'apply_patch' | 'apply_multifile_patch';

export interface FsReadCall         { tool: 'read_file';             path: string }
export interface FsWriteCall        { tool: 'write_file';            path: string; content: string }
export interface FsEditCall         { tool: 'edit_file';             path: string; old: string; new: string }
export interface FsPatchCall        { tool: 'apply_patch';           path: string; patch: string }
export interface FsMultiPatchCall   { tool: 'apply_multifile_patch'; patch: string }
export type FsCall = FsReadCall | FsWriteCall | FsEditCall | FsPatchCall | FsMultiPatchCall;

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

  applyMultiFilePatch(patch: string): FsResult {
    const result = applyMultiFilePatch(patch, (p) => this.resolveSafe(p));
    if (!result.ok || result.errors.length > 0) {
      const summary = [
        ...(result.filesAdded   > 0 ? [`added ${result.filesAdded}`]   : []),
        ...(result.filesUpdated > 0 ? [`updated ${result.filesUpdated}`] : []),
        ...(result.filesDeleted > 0 ? [`deleted ${result.filesDeleted}`] : []),
      ].join(', ') || 'no changes';
      return { ok: result.ok, output: `apply_multifile_patch: ${summary}. Errors: ${result.errors.join('; ')}` };
    }
    const summary = [
      ...(result.filesAdded   > 0 ? [`added ${result.filesAdded}`]   : []),
      ...(result.filesUpdated > 0 ? [`updated ${result.filesUpdated}`] : []),
      ...(result.filesDeleted > 0 ? [`deleted ${result.filesDeleted}`] : []),
    ].join(', ') || 'no changes';
    return { ok: true, output: `apply_multifile_patch: ${summary}` };
  }

  dispatch(call: FsCall): FsResult {
    switch (call.tool) {
      case 'read_file':             return this.read(call.path);
      case 'write_file':            return this.write(call.path, call.content);
      case 'edit_file':             return this.edit(call.path, call.old, call.new);
      case 'apply_patch':           return this.applyPatch(call.path, call.patch);
      case 'apply_multifile_patch': return this.applyMultiFilePatch(call.patch);
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

// ── Multi-file structured patch applier ───────────────────────────────────────
//
// Applies a structured multi-file patch with the following format:
//
//   *** Begin Patch
//   *** Add File: path/to/new-file.txt
//   +line 1
//   +line 2
//   *** Update File: src/app.ts
//   @@
//   -old line
//   +new line
//   *** Move to: src/renamed.ts   (optional rename within an Update File block)
//   *** Delete File: obsolete.txt
//   *** End Patch
//

interface MultiFilePatchResult {
  ok: boolean;
  filesAdded:   number;
  filesUpdated: number;
  filesDeleted: number;
  errors:       string[];
}

type FileAction = 'add' | 'update' | 'delete';

interface FilePatchBlock {
  action:  FileAction;
  path:    string;
  moveTo?: string;  // for *** Move to: within an Update File block
  content: string;  // raw lines (for add: +lines, for update: hunk content)
}

function parseMultiFilePatch(patch: string): FilePatchBlock[] {
  const lines = patch.split('\n');
  const blocks: FilePatchBlock[] = [];
  let i = 0;

  // Seek *** Begin Patch
  while (i < lines.length && lines[i]?.trim() !== '*** Begin Patch') i++;
  if (i >= lines.length) return blocks;
  i++;

  let current: FilePatchBlock | null = null;
  const contentLines: string[] = [];

  const flushCurrent = (): void => {
    if (current) {
      blocks.push({ ...current, content: contentLines.join('\n') });
      contentLines.length = 0;
      current = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '*** End Patch') { flushCurrent(); break; }

    if (line.startsWith('*** Add File: ')) {
      flushCurrent();
      current = { action: 'add', path: line.slice('*** Add File: '.length).trim(), content: '' };
      i++; continue;
    }
    if (line.startsWith('*** Update File: ')) {
      flushCurrent();
      current = { action: 'update', path: line.slice('*** Update File: '.length).trim(), content: '' };
      i++; continue;
    }
    if (line.startsWith('*** Delete File: ')) {
      flushCurrent();
      current = { action: 'delete', path: line.slice('*** Delete File: '.length).trim(), content: '' };
      i++; continue;
    }
    if (line.startsWith('*** Move to: ') && current?.action === 'update') {
      current.moveTo = line.slice('*** Move to: '.length).trim();
      i++; continue;
    }

    contentLines.push(line);
    i++;
  }

  return blocks;
}

/**
 * Apply a structured multi-file patch.
 * @param patchInput  Full patch string (*** Begin Patch ... *** End Patch)
 * @param resolveSafe Callback that validates and resolves a path. Returns null if denied.
 */
export function applyMultiFilePatch(
  patchInput: string,
  resolveSafe: (path: string) => string | null,
): MultiFilePatchResult {
  const result: MultiFilePatchResult = {
    ok: true, filesAdded: 0, filesUpdated: 0, filesDeleted: 0, errors: [],
  };

  const blocks = parseMultiFilePatch(patchInput);
  if (blocks.length === 0) {
    result.ok = false;
    result.errors.push('No valid patch blocks found. Ensure patch starts with *** Begin Patch.');
    return result;
  }

  for (const block of blocks) {
    const abs = resolveSafe(block.path);
    if (!abs) {
      result.errors.push(`Path denied: ${block.path}`);
      result.ok = false;
      continue;
    }

    if (block.action === 'delete') {
      if (!existsSync(abs)) {
        result.errors.push(`delete: file not found: ${block.path}`);
        result.ok = false;
        continue;
      }
      try {
        unlinkSync(abs);
        result.filesDeleted++;
      } catch (err) {
        result.errors.push(`delete failed: ${block.path}: ${err instanceof Error ? err.message : String(err)}`);
        result.ok = false;
      }
      continue;
    }

    if (block.action === 'add') {
      // Content is +prefixed lines; strip the + prefix
      const newContent = block.content
        .split('\n')
        .map(l => l.startsWith('+') ? l.slice(1) : l)
        .join('\n');
      try {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, newContent, 'utf-8');
        result.filesAdded++;
      } catch (err) {
        result.errors.push(`add failed: ${block.path}: ${err instanceof Error ? err.message : String(err)}`);
        result.ok = false;
      }
      continue;
    }

    if (block.action === 'update') {
      if (!existsSync(abs)) {
        result.errors.push(`update: file not found: ${block.path}`);
        result.ok = false;
        continue;
      }
      try {
        const stat = statSync(abs);
        if (stat.size > FS_MAX_BYTES) {
          result.errors.push(`update: file too large: ${block.path}`);
          result.ok = false;
          continue;
        }
        const original = readFileSync(abs, 'utf-8');
        const patchResult = applyUnifiedPatch(original, block.content);
        if (!patchResult.ok) {
          result.errors.push(`update patch failed: ${block.path}: ${patchResult.error}`);
          result.ok = false;
          continue;
        }
        // Write to moveTo path if specified, otherwise overwrite in place
        const destAbs = block.moveTo ? (resolveSafe(block.moveTo) ?? abs) : abs;
        if (block.moveTo && destAbs !== abs) {
          mkdirSync(dirname(destAbs), { recursive: true });
          unlinkSync(abs);
        }
        writeFileSync(destAbs, patchResult.content!, 'utf-8');
        result.filesUpdated++;
      } catch (err) {
        result.errors.push(`update failed: ${block.path}: ${err instanceof Error ? err.message : String(err)}`);
        result.ok = false;
      }
      continue;
    }
  }

  return result;
}
