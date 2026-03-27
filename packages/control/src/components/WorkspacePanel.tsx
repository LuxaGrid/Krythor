import { useState, useEffect, useCallback } from 'react';
import { getWorkspaceStatus, initWorkspace, getWorkspaceFile, putWorkspaceFile } from '../api.ts';
import type { WorkspaceStatus, WorkspaceFileStatus } from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

// ─── WorkspacePanel ───────────────────────────────────────────────────────────
//
// Shows workspace status, lets the user view/edit bootstrap files, and provides
// a button to re-initialise missing files.
//

const FILE_DESCRIPTIONS: Record<string, string> = {
  'AGENTS.md':    'Operating instructions + "memory" — loaded every session',
  'SOUL.md':      'Persona, boundaries, tone — loaded every session',
  'TOOLS.md':     'Tool usage notes and local conventions',
  'IDENTITY.md':  'Agent name, vibe, emoji',
  'USER.md':      'User profile and preferred address',
  'HEARTBEAT.md': 'Checklist for heartbeat runs (keep short)',
  'BOOTSTRAP.md': 'One-time first-run ritual — delete after completion',
};

function statusBadge(status: WorkspaceFileStatus['status']): React.ReactNode {
  switch (status) {
    case 'ok':
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-800/30">ok</span>;
    case 'missing':
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800/30">missing</span>;
    case 'blank':
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700">blank</span>;
    case 'truncated':
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/30">truncated</span>;
    default:
      return null;
  }
}

function fmtChars(n: number): string {
  if (n === 0) return '—';
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(1)}k`;
}

// ── Editor modal ──────────────────────────────────────────────────────────────

function FileEditor({
  name,
  onClose,
}: {
  name: string;
  onClose: () => void;
}) {
  const [content, setContent]   = useState('');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getWorkspaceFile(name)
      .then(r => { setContent(r.content); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [name]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await putWorkspaceFile(name, content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [name, content]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[700px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div>
            <span className="font-mono text-sm text-zinc-100">{name}</span>
            <span className="ml-2 text-xs text-zinc-500">{FILE_DESCRIPTIONS[name] ?? ''}</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">×</button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="text-zinc-500 text-sm">Loading…</div>
          ) : (
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              className="w-full h-64 bg-zinc-950 border border-zinc-700 rounded p-3 font-mono text-xs text-zinc-200 outline-none resize-y"
              spellCheck={false}
            />
          )}
          {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
        </div>

        <div className="px-4 py-3 border-t border-zinc-800 flex items-center gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── WorkspacePanel ────────────────────────────────────────────────────────────

export function WorkspacePanel() {
  const [status, setStatus]         = useState<WorkspaceStatus | null>(null);
  const [loading, setLoading]       = useState(false);
  const [initing, setIniting]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [editFile, setEditFile]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await getWorkspaceStatus();
      setStatus(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleInit = useCallback(async () => {
    setIniting(true);
    setError(null);
    try {
      await initWorkspace(false);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setIniting(false);
    }
  }, [load]);

  const missingCount = status?.files.filter(f => f.status === 'missing').length ?? 0;

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-200">
      <PanelHeader title="Workspace" description="Bootstrap files injected into every agent run" />

      {/* Toolbar */}
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-3">
        <button
          onClick={load}
          disabled={loading}
          className="h-7 px-3 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {missingCount > 0 && (
          <button
            onClick={handleInit}
            disabled={initing}
            className="h-7 px-3 bg-indigo-700 hover:bg-indigo-600 rounded text-xs transition-colors disabled:opacity-50"
          >
            {initing ? 'Initialising…' : `Init workspace (${missingCount} missing)`}
          </button>
        )}
        {status && (
          <span className="text-[11px] text-zinc-500 ml-auto">
            {status.dir}
          </span>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-900/10 border-b border-red-900/20">{error}</div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-auto">
        {!status ? (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            {loading ? 'Loading…' : 'No workspace data.'}
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {status.files.map(file => (
              <div
                key={file.name}
                className="flex items-center px-4 py-3 hover:bg-zinc-900/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-zinc-200">{file.name}</span>
                    {statusBadge(file.status)}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {FILE_DESCRIPTIONS[file.name] ?? ''}
                  </div>
                </div>
                <div className="flex items-center gap-4 ml-4 text-xs text-zinc-600">
                  <span title="Raw chars">{fmtChars(file.rawChars)} raw</span>
                  {file.injectedChars > 0 && file.injectedChars !== file.rawChars && (
                    <span title="Injected chars (after truncation)" className="text-amber-600">
                      {fmtChars(file.injectedChars)} injected
                    </span>
                  )}
                  <button
                    onClick={() => setEditFile(file.name)}
                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 transition-colors"
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Totals footer */}
      {status && status.files.length > 0 && (
        <div className="px-4 py-2 border-t border-zinc-800 flex items-center gap-4 text-xs text-zinc-600">
          <span>Total raw: {fmtChars(status.totalRawChars)}</span>
          <span>Total injected: {fmtChars(status.totalInjectedChars)}</span>
          <span className="ml-auto text-zinc-700">
            Files are injected into every agent run under "Project Context"
          </span>
        </div>
      )}

      {/* File editor modal */}
      {editFile && (
        <FileEditor
          name={editFile}
          onClose={() => { setEditFile(null); load(); }}
        />
      )}
    </div>
  );
}
