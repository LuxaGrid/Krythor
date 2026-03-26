import { useState, useEffect, useCallback } from 'react';
import {
  listAgents,
  health,
  fileList,
  fileRead,
  fileWrite,
  fileMkdir,
  fileDelete,
  type Agent,
  type FileDirEntry,
} from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtSize(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function isAccessDenied(err: unknown): boolean {
  if (err instanceof Error) return err.message.includes('PATH_DENIED') || err.message.includes('Access denied');
  return false;
}

function pathSegments(p: string): string[] {
  return p.replace(/\\/g, '/').split('/').filter(Boolean);
}

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

function parentPath(p: string): string {
  const segs = pathSegments(p);
  if (segs.length === 0) return '/';
  segs.pop();
  return segs.length === 0 ? '/' : '/' + segs.join('/');
}

// ── Access profile badge ────────────────────────────────────────────────────

function ProfileBadge({ profile }: { profile: string }) {
  const cls =
    profile === 'full_access'
      ? 'bg-amber-950/50 text-amber-400 border-amber-700/60'
      : profile === 'safe'
      ? 'bg-blue-950/50 text-blue-400 border-blue-700/60'
      : 'bg-zinc-800 text-zinc-400 border-zinc-700';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${cls}`}>
      {profile}
    </span>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────

const Spinner = () => (
  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// ── Breadcrumb ──────────────────────────────────────────────────────────────

function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const segs = pathSegments(path);
  return (
    <div className="flex items-center gap-1 flex-wrap text-xs font-mono">
      <button
        onClick={() => onNavigate('/')}
        className="text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        /
      </button>
      {segs.map((seg, i) => {
        const segPath = '/' + segs.slice(0, i + 1).join('/');
        const isLast = i === segs.length - 1;
        return (
          <span key={segPath} className="flex items-center gap-1">
            <span className="text-zinc-700">/</span>
            {isLast ? (
              <span className="text-zinc-200">{seg}</span>
            ) : (
              <button
                onClick={() => onNavigate(segPath)}
                className="text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {seg}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

// ── Rename inline ───────────────────────────────────────────────────────────

interface RenameRowProps {
  entry: FileDirEntry;
  onCancel: () => void;
  onCommit: (newName: string) => void;
}

function RenameRow({ entry, onCancel, onCommit }: RenameRowProps) {
  const [val, setVal] = useState(entry.name);
  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onCommit(val.trim());
          if (e.key === 'Escape') onCancel();
        }}
        className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-200 outline-none focus:border-brand-600"
      />
      <button
        onClick={() => onCommit(val.trim())}
        className="text-xs px-2 py-0.5 rounded bg-brand-700 hover:bg-brand-600 text-white transition-colors"
      >
        OK
      </button>
      <button
        onClick={onCancel}
        className="text-xs px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

// ── Directory view ──────────────────────────────────────────────────────────

interface DirViewProps {
  path: string;
  entries: FileDirEntry[];
  loading: boolean;
  error: string | null;
  agentId: string | undefined;
  onNavigate: (p: string) => void;
  onOpenFile: (entry: FileDirEntry) => void;
  onRefresh: () => void;
}

function DirView({
  path,
  entries,
  loading,
  error,
  agentId,
  onNavigate,
  onOpenFile,
  onRefresh,
}: DirViewProps) {
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newFolderPrompt, setNewFolderPrompt] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFilePrompt, setNewFilePrompt] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  const handleDelete = useCallback(async (entry: FileDirEntry) => {
    setActionError(null);
    try {
      await fileDelete(entry.path, entry.isDirectory, agentId);
      setDeleteConfirm(null);
      onRefresh();
    } catch (err) {
      setDeleteConfirm(null);
      setActionError(isAccessDenied(err)
        ? 'Access denied — agent profile does not allow access to this path'
        : err instanceof Error ? err.message : String(err));
    }
  }, [agentId, onRefresh]);

  const handleRenameCommit = useCallback(async (entry: FileDirEntry, newName: string) => {
    if (!newName || newName === entry.name) { setRenaming(null); return; }
    setActionError(null);
    const parentDir = parentPath(entry.path);
    const newPath = joinPath(parentDir, newName);
    // Use the write endpoint for files (read + write), or just mkdir for dirs.
    // Rename is not a dedicated endpoint; we re-use move semantics via a temporary approach.
    // Since there's no rename/move API exposed in the spec, we inform the user.
    // Implement via fileWrite (for files) + fileDelete (original) or just show a note.
    // The spec includes /tools/files/move — call it via req via the raw pattern.
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = (window as unknown as Record<string, unknown>)['__KRYTHOR_TOKEN__'];
      if (typeof token === 'string' && token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/tools/files/move', {
        method: 'POST',
        headers,
        body: JSON.stringify({ src: entry.path, dest: newPath, ...(agentId && { agentId }) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, unknown>;
        const msg = (data as { hint?: string; error?: string })?.hint
          ? `${(data as { error?: string }).error}: ${(data as { hint?: string }).hint}`
          : ((data as { error?: string }).error ?? `HTTP ${res.status}`);
        throw new Error(msg);
      }
      setRenaming(null);
      onRefresh();
    } catch (err) {
      setRenaming(null);
      setActionError(isAccessDenied(err)
        ? 'Access denied — agent profile does not allow access to this path'
        : err instanceof Error ? err.message : String(err));
    }
  }, [agentId, onRefresh]);

  const handleNewFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setActionError(null);
    try {
      await fileMkdir(joinPath(path, name), agentId);
      setNewFolderPrompt(false);
      setNewFolderName('');
      onRefresh();
    } catch (err) {
      setNewFolderPrompt(false);
      setNewFolderName('');
      setActionError(isAccessDenied(err)
        ? 'Access denied — agent profile does not allow access to this path'
        : err instanceof Error ? err.message : String(err));
    }
  }, [path, newFolderName, agentId, onRefresh]);

  const handleNewFile = useCallback(async () => {
    const name = newFileName.trim();
    if (!name) return;
    setActionError(null);
    try {
      await fileWrite(joinPath(path, name), '', agentId);
      setNewFilePrompt(false);
      setNewFileName('');
      onRefresh();
    } catch (err) {
      setNewFilePrompt(false);
      setNewFileName('');
      setActionError(isAccessDenied(err)
        ? 'Access denied — agent profile does not allow access to this path'
        : err instanceof Error ? err.message : String(err));
    }
  }, [path, newFileName, agentId, onRefresh]);

  const sorted = [...entries].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 flex-shrink-0">
        <button
          onClick={() => onNavigate(parentPath(path))}
          disabled={path === '/' || path === ''}
          className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Go up one level"
        >
          ↑ Up
        </button>
        <button
          onClick={onRefresh}
          className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          title="Refresh"
        >
          ↻ Refresh
        </button>
        <div className="flex-1" />
        <button
          onClick={() => { setNewFolderPrompt(true); setNewFolderName(''); }}
          className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          + New Folder
        </button>
        <button
          onClick={() => { setNewFilePrompt(true); setNewFileName(''); }}
          className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          + New File
        </button>
      </div>

      {/* New folder prompt */}
      {newFolderPrompt && (
        <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex-shrink-0">
          <span className="text-xs text-zinc-400">Folder name:</span>
          <input
            autoFocus
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleNewFolder(); if (e.key === 'Escape') setNewFolderPrompt(false); }}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-200 outline-none focus:border-brand-600"
            placeholder="new-folder"
          />
          <button onClick={handleNewFolder} className="text-xs px-2 py-0.5 rounded bg-brand-700 hover:bg-brand-600 text-white transition-colors">Create</button>
          <button onClick={() => setNewFolderPrompt(false)} className="text-xs px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors">Cancel</button>
        </div>
      )}

      {/* New file prompt */}
      {newFilePrompt && (
        <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex-shrink-0">
          <span className="text-xs text-zinc-400">File name:</span>
          <input
            autoFocus
            value={newFileName}
            onChange={e => setNewFileName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleNewFile(); if (e.key === 'Escape') setNewFilePrompt(false); }}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-200 outline-none focus:border-brand-600"
            placeholder="new-file.txt"
          />
          <button onClick={handleNewFile} className="text-xs px-2 py-0.5 rounded bg-brand-700 hover:bg-brand-600 text-white transition-colors">Create</button>
          <button onClick={() => setNewFilePrompt(false)} className="text-xs px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors">Cancel</button>
        </div>
      )}

      {/* Error */}
      {(error || actionError) && (
        <div className="mx-4 my-2 px-3 py-2 rounded-lg bg-red-950/40 border border-red-800/40 text-red-400 text-xs flex-shrink-0">
          {error || actionError}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-zinc-500 text-xs">
            <Spinner /> Loading…
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-zinc-600 text-xs">
            Directory is empty
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-950 border-b border-zinc-800">
              <tr>
                <th className="text-left px-4 py-2 text-zinc-500 font-medium">Name</th>
                <th className="text-right px-4 py-2 text-zinc-500 font-medium w-24">Size</th>
                <th className="text-left px-4 py-2 text-zinc-500 font-medium w-44">Modified</th>
                <th className="text-right px-4 py-2 text-zinc-500 font-medium w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(entry => (
                <tr
                  key={entry.path}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/50 transition-colors group"
                >
                  <td className="px-4 py-2">
                    {renaming === entry.path ? (
                      <RenameRow
                        entry={entry}
                        onCancel={() => setRenaming(null)}
                        onCommit={name => handleRenameCommit(entry, name)}
                      />
                    ) : (
                      <button
                        onClick={() => entry.isDirectory ? onNavigate(entry.path) : onOpenFile(entry)}
                        className="flex items-center gap-2 text-left hover:text-zinc-100 text-zinc-300 transition-colors max-w-full"
                      >
                        <span className="shrink-0">{entry.isDirectory ? '📁' : '📄'}</span>
                        <span className="truncate font-mono">{entry.name}</span>
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-500 font-mono tabular-nums">
                    {entry.isDirectory ? '—' : fmtSize(entry.size)}
                  </td>
                  <td className="px-4 py-2 text-zinc-500">
                    {fmtDate(entry.mtime)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setRenaming(entry.path)}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                        title="Rename"
                      >
                        Rename
                      </button>
                      {deleteConfirm === entry.path ? (
                        <>
                          <button
                            onClick={() => handleDelete(entry)}
                            className="text-[11px] px-1.5 py-0.5 rounded bg-red-900/60 hover:bg-red-800/60 text-red-400 hover:text-red-300 transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(entry.path)}
                          className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-red-950/60 text-zinc-400 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── File editor ─────────────────────────────────────────────────────────────

const MAX_EDITABLE_BYTES = 100 * 1024; // 100 KB

interface FileEditorProps {
  filePath: string;
  content: string;
  size: number;
  mtime: string | undefined;
  agentId: string | undefined;
  onClose: () => void;
}

function FileEditor({ filePath, content: initialContent, size, mtime, agentId, onClose }: FileEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooLarge = size > MAX_EDITABLE_BYTES;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await fileWrite(filePath, content, agentId);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(isAccessDenied(err)
        ? 'Access denied — agent profile does not allow access to this path'
        : err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [filePath, content, agentId]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 flex-shrink-0">
        <button
          onClick={onClose}
          className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          ← Back
        </button>
        <span className="flex-1 text-xs text-zinc-500 font-mono truncate">{filePath}</span>
        {!tooLarge && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-1 rounded bg-brand-700 hover:bg-brand-600 disabled:opacity-50 text-white transition-colors flex items-center gap-1"
          >
            {saving && <Spinner />}
            {saved ? 'Saved!' : 'Save'}
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 my-2 px-3 py-2 rounded-lg bg-red-950/40 border border-red-800/40 text-red-400 text-xs flex-shrink-0">
          {error}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {tooLarge ? (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            File too large to edit ({fmtSize(size)})
          </div>
        ) : (
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            className="flex-1 w-full bg-zinc-950 text-zinc-300 font-mono text-xs p-4 resize-none outline-none border-0 leading-relaxed"
            spellCheck={false}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-t border-zinc-800 bg-zinc-950/60 text-[10px] text-zinc-600 flex-shrink-0 font-mono">
        <span>Size: {fmtSize(size)}</span>
        {mtime && <span>Modified: {fmtDate(mtime)}</span>}
      </div>
    </div>
  );
}

// ── FileBrowserPanel ────────────────────────────────────────────────────────

interface OpenFile {
  path: string;
  content: string;
  size: number;
  mtime: string | undefined;
}

export function FileBrowserPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(undefined);
  const [agentProfile, setAgentProfile] = useState<string>('standard');
  const [currentPath, setCurrentPath] = useState<string>('');
  const [entries, setEntries] = useState<FileDirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Load agents and determine initial path from health
  useEffect(() => {
    listAgents()
      .then(list => {
        setAgents(list);
        if (list.length > 0 && list[0]) {
          setSelectedAgentId(list[0].id);
        }
      })
      .catch(() => {});

    health()
      .then(h => {
        // Use dataDir as a reasonable starting point if workspace not available
        const workspace = (h as unknown as Record<string, unknown>)['workspace'] as string | undefined;
        const startPath = workspace ?? h.dataDir ?? '';
        setCurrentPath(startPath);
      })
      .catch(() => {});
  }, []);

  // Fetch agent profile whenever selectedAgentId changes
  useEffect(() => {
    if (!selectedAgentId) { setAgentProfile('standard'); return; }
    // We can't import getAgentAccessProfile directly without a circular dep issue
    // so we do a direct fetch here — same pattern as in api.ts
    const token = (window as unknown as Record<string, unknown>)['__KRYTHOR_TOKEN__'];
    const headers: Record<string, string> = {};
    if (typeof token === 'string' && token) headers['Authorization'] = `Bearer ${token}`;
    fetch(`/api/agents/${selectedAgentId}/access-profile`, { headers })
      .then(r => r.ok ? r.json() as Promise<{ agentId: string; profile: string }> : Promise.resolve({ agentId: '', profile: 'standard' }))
      .then(data => setAgentProfile(data.profile))
      .catch(() => setAgentProfile('standard'));
  }, [selectedAgentId]);

  // List directory whenever currentPath or selectedAgentId changes
  const loadDir = useCallback(async (path: string) => {
    if (!path) return;
    setLoading(true);
    setListError(null);
    setEntries([]);
    try {
      const result = await fileList(path, selectedAgentId);
      setEntries(result.entries);
    } catch (err) {
      setListError(isAccessDenied(err)
        ? 'Access denied — agent profile does not allow access to this path'
        : err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedAgentId]);

  useEffect(() => {
    if (currentPath) loadDir(currentPath);
  }, [currentPath, loadDir]);

  const handleNavigate = useCallback((path: string) => {
    setOpenFile(null);
    setCurrentPath(path);
  }, []);

  const handleOpenFile = useCallback(async (entry: FileDirEntry) => {
    setFileLoading(true);
    setFileError(null);
    setOpenFile(null);
    try {
      const result = await fileRead(entry.path, selectedAgentId);
      setOpenFile({
        path: result.path,
        content: result.content,
        size: result.size,
        mtime: entry.mtime,
      });
    } catch (err) {
      setFileError(isAccessDenied(err)
        ? 'Access denied — agent profile does not allow access to this path'
        : err instanceof Error ? err.message : String(err));
    } finally {
      setFileLoading(false);
    }
  }, [selectedAgentId]);

  const handleCloseFile = useCallback(() => {
    setOpenFile(null);
    setFileError(null);
  }, []);

  const handleRefresh = useCallback(() => {
    if (currentPath) loadDir(currentPath);
  }, [currentPath, loadDir]);

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Panel header */}
      <PanelHeader
        title="File Browser"
        description="Browse, read, edit, and manage files on the gateway host."
        tip="Access is governed by the selected agent's profile. The 'safe' profile limits access to the workspace directory only."
        actions={
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Agent:</label>
            <select
              value={selectedAgentId ?? ''}
              onChange={e => {
                setSelectedAgentId(e.target.value || undefined);
                setOpenFile(null);
              }}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 outline-none focus:border-brand-600 transition-colors"
            >
              <option value="">(none)</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {selectedAgentId && <ProfileBadge profile={agentProfile} />}
          </div>
        }
      />

      {/* Access profile banner */}
      {agentProfile === 'safe' && (
        <div className="px-4 py-2 bg-blue-950/30 border-b border-blue-800/30 text-blue-400 text-xs flex-shrink-0">
          safe profile — access restricted to workspace
        </div>
      )}
      {agentProfile === 'full_access' && (
        <div className="px-4 py-2 bg-amber-950/30 border-b border-amber-800/30 text-amber-400 text-xs flex-shrink-0">
          full access enabled — unrestricted filesystem access
        </div>
      )}

      {/* Path input row */}
      <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex-shrink-0">
        <Breadcrumb path={currentPath} onNavigate={handleNavigate} />
        <div className="flex-1" />
        <input
          value={currentPath}
          onChange={e => setCurrentPath(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleNavigate(currentPath); }}
          placeholder="Enter path…"
          className="w-64 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 font-mono outline-none focus:border-brand-600 transition-colors placeholder-zinc-600"
        />
        <button
          onClick={() => handleNavigate(currentPath)}
          className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Go
        </button>
      </div>

      {/* File error (from file open) */}
      {fileError && !openFile && (
        <div className="mx-4 my-2 px-3 py-2 rounded-lg bg-red-950/40 border border-red-800/40 text-red-400 text-xs flex-shrink-0">
          {fileError}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {fileLoading ? (
          <div className="flex items-center justify-center h-full gap-2 text-zinc-500 text-xs">
            <Spinner /> Loading file…
          </div>
        ) : openFile ? (
          <FileEditor
            filePath={openFile.path}
            content={openFile.content}
            size={openFile.size}
            mtime={openFile.mtime}
            agentId={selectedAgentId}
            onClose={handleCloseFile}
          />
        ) : (
          <DirView
            path={currentPath}
            entries={entries}
            loading={loading}
            error={listError}
            agentId={selectedAgentId}
            onNavigate={handleNavigate}
            onOpenFile={handleOpenFile}
            onRefresh={handleRefresh}
          />
        )}
      </div>
    </div>
  );
}
