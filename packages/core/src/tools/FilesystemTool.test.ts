import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FilesystemTool, applyMultiFilePatch } from './FilesystemTool.js';

let tmpDir: string;
let tool: FilesystemTool;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'krythor-fstest-'));
  tool = new FilesystemTool([tmpDir]);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── read_file / write_file / edit_file ────────────────────────────────────

describe('FilesystemTool.read', () => {
  it('reads a file', () => {
    writeFileSync(join(tmpDir, 'hello.txt'), 'hello world', 'utf-8');
    const res = tool.dispatch({ tool: 'read_file', path: join(tmpDir, 'hello.txt') });
    expect(res.ok).toBe(true);
    expect(res.output).toBe('hello world');
  });

  it('returns error for missing file', () => {
    const res = tool.dispatch({ tool: 'read_file', path: join(tmpDir, 'missing.txt') });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('not found');
  });

  it('denies path traversal', () => {
    const res = tool.dispatch({ tool: 'read_file', path: join(tmpDir, '../../../etc/passwd') });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('denied');
  });
});

describe('FilesystemTool.write', () => {
  it('writes a new file', () => {
    const path = join(tmpDir, 'new.txt');
    const res = tool.dispatch({ tool: 'write_file', path, content: 'hello' });
    expect(res.ok).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe('hello');
  });
});

describe('FilesystemTool.edit', () => {
  it('replaces text in a file', () => {
    const path = join(tmpDir, 'edit.txt');
    writeFileSync(path, 'foo bar baz', 'utf-8');
    const res = tool.dispatch({ tool: 'edit_file', path, old: 'bar', new: 'qux' });
    expect(res.ok).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe('foo qux baz');
  });
});

// ─── apply_multifile_patch ─────────────────────────────────────────────────

describe('applyMultiFilePatch', () => {
  it('adds a new file', () => {
    const newPath = join(tmpDir, 'added.txt');
    const patch = `*** Begin Patch
*** Add File: ${newPath}
+Hello from patch
+Second line
*** End Patch`;
    const res = applyMultiFilePatch(patch, p => {
      const abs = join(tmpDir, p.startsWith(tmpDir) ? p.slice(tmpDir.length + 1) : p);
      return abs.startsWith(tmpDir) ? abs : null;
    });
    expect(res.ok).toBe(true);
    expect(res.filesAdded).toBe(1);
    expect(readFileSync(newPath, 'utf-8')).toBe('Hello from patch\nSecond line');
  });

  it('deletes an existing file', () => {
    const path = join(tmpDir, 'todelete.txt');
    writeFileSync(path, 'gone', 'utf-8');
    const patch = `*** Begin Patch
*** Delete File: ${path}
*** End Patch`;
    const res = applyMultiFilePatch(patch, p => p.startsWith(tmpDir) ? p : null);
    expect(res.ok).toBe(true);
    expect(res.filesDeleted).toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  it('updates a file with a unified diff hunk', () => {
    const path = join(tmpDir, 'update.txt');
    writeFileSync(path, 'line1\nline2\nline3\n', 'utf-8');
    const patch = `*** Begin Patch
*** Update File: ${path}
@@ -2,1 +2,1 @@
-line2
+line2-updated
*** End Patch`;
    const res = applyMultiFilePatch(patch, p => p.startsWith(tmpDir) ? p : null);
    expect(res.ok).toBe(true);
    expect(res.filesUpdated).toBe(1);
    expect(readFileSync(path, 'utf-8')).toBe('line1\nline2-updated\nline3\n');
  });

  it('handles multiple operations in one patch', () => {
    const addPath  = join(tmpDir, 'new-file.txt');
    const delPath  = join(tmpDir, 'old-file.txt');
    writeFileSync(delPath, 'delete me', 'utf-8');
    const patch = `*** Begin Patch
*** Add File: ${addPath}
+Created
*** Delete File: ${delPath}
*** End Patch`;
    const res = applyMultiFilePatch(patch, p => p.startsWith(tmpDir) ? p : null);
    expect(res.ok).toBe(true);
    expect(res.filesAdded).toBe(1);
    expect(res.filesDeleted).toBe(1);
  });

  it('returns error when Begin Patch marker is missing', () => {
    const res = applyMultiFilePatch('no markers here', () => '/tmp/file');
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('No valid patch blocks');
  });

  it('denies paths outside allowed roots', () => {
    const patch = `*** Begin Patch
*** Add File: /etc/evil.conf
+evil
*** End Patch`;
    const res = applyMultiFilePatch(patch, () => null);
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain('denied');
  });
});

describe('FilesystemTool apply_multifile_patch dispatch', () => {
  it('dispatches apply_multifile_patch through the tool', () => {
    const newPath = join(tmpDir, 'dispatched.txt');
    const patch = `*** Begin Patch
*** Add File: ${newPath}
+Dispatched
*** End Patch`;
    const res = tool.dispatch({ tool: 'apply_multifile_patch', patch });
    expect(res.ok).toBe(true);
    expect(readFileSync(newPath, 'utf-8')).toBe('Dispatched');
  });
});
