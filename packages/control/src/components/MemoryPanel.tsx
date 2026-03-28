import { useState, useEffect, useCallback } from 'react';
import { listMemory, createMemory, updateMemory, deleteMemory, pinMemory, unpinMemory, pruneMemory, compactMemory, summarizeMemory, pruneMemoryBulk, exportMemory, importMemory, memoryStatsDetailed, listMemoryTags, type MemoryEntry, type MemorySearchResult, type Health, type MemoryStatsDetailed } from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

const SCOPES = ['all', 'session', 'user', 'agent', 'workspace', 'skill'];
const PAGE_SIZE = 20;

function timeAgo(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const SCOPE_COLOR: Record<string, string> = {
  session: 'text-emerald-400', user: 'text-amber-400',
  agent: 'text-brand-400', workspace: 'text-purple-400', skill: 'text-pink-400',
};

const ENTRY_SCOPES = ['user', 'agent', 'workspace', 'skill', 'session'];

interface MemoryFormProps {
  initial?: MemoryEntry & { tags?: string[] };
  onSave: (entry: MemoryEntry) => void;
  onClose: () => void;
}

function MemoryForm({ initial, onSave, onClose }: MemoryFormProps) {
  const [title, setTitle]         = useState(initial?.title ?? '');
  const [content, setContent]     = useState(initial?.content ?? '');
  const [scope, setScope]         = useState(initial?.scope ?? 'user');
  const [tagsRaw, setTagsRaw]     = useState((initial?.tags ?? []).join(', '));
  const [importance, setImportance] = useState(String(initial?.importance ?? 50));
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) { setError('Title and content are required.'); return; }
    setSaving(true);
    setError('');
    try {
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
      const imp = Math.max(0, Math.min(100, parseInt(importance, 10) || 50));
      let entry: MemoryEntry;
      if (initial) {
        entry = await updateMemory(initial.id, { title: title.trim(), content: content.trim(), tags, importance: imp });
      } else {
        entry = await createMemory({ title: title.trim(), content: content.trim(), scope, tags, importance: imp });
      }
      onSave(entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[520px] max-w-[95vw] overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">{initial ? 'Edit Memory' : 'New Memory Entry'}</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none transition-colors">×</button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Brief summary…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Content</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={5}
              placeholder="Memory content…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Scope</label>
              <select
                value={scope}
                onChange={e => setScope(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors"
              >
                {ENTRY_SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Importance (0–100)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={importance}
                onChange={e => setImportance(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Tags (comma-separated)</label>
            <input
              value={tagsRaw}
              onChange={e => setTagsRaw(e.target.value)}
              placeholder="tag1, tag2…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors"
            />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : initial ? 'Save changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface EmptyStateProps {
  icon: string;
  title: string;
  hint?: string;
}
const EmptyState = ({ icon, title, hint }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-8">
    <div className="text-2xl opacity-30">{icon}</div>
    <p className="text-zinc-500 text-xs">{title}</p>
    {hint && <p className="text-zinc-700 text-xs">{hint}</p>}
  </div>
);

const Spinner = () => (
  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>
);

interface MemoryPanelProps {
  health?: Health | null;
}

// ── Prune Modal ────────────────────────────────────────────────────────────

interface PruneModalProps {
  onClose: () => void;
  onPruned: (deleted: number) => void;
}

function PruneModal({ onClose, onPruned }: PruneModalProps) {
  const [olderThan, setOlderThan] = useState('');
  const [tag, setTag]             = useState('');
  const [source, setSource]       = useState('');
  const [pruning, setPruning]     = useState(false);
  const [error, setError]         = useState('');

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handlePrune = async () => {
    if (!olderThan && !tag && !source) {
      setError('At least one filter is required.');
      return;
    }
    setError('');
    setPruning(true);
    try {
      const result = await pruneMemoryBulk({
        ...(olderThan && { olderThan }),
        ...(tag && { tag }),
        ...(source && { source }),
      });
      onPruned(result.deleted);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prune failed');
    } finally {
      setPruning(false);
    }
  };

  const INPUT_CLS = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={handleBackdrop}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[440px] max-w-[95vw] overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Prune Memory</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none transition-colors">×</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-zinc-500 leading-relaxed">
            Delete memory entries matching the filters below. At least one filter is required.
            Pinned entries are always preserved.
          </p>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Older than (ISO date)</label>
            <input
              value={olderThan}
              onChange={e => setOlderThan(e.target.value)}
              placeholder="e.g. 2025-01-01T00:00:00Z"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Tag</label>
            <input value={tag} onChange={e => setTag(e.target.value)} placeholder="e.g. session" className={INPUT_CLS} />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Source</label>
            <input value={source} onChange={e => setSource(e.target.value)} placeholder="e.g. agent" className={INPUT_CLS} />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg transition-colors">Cancel</button>
            <button
              onClick={handlePrune}
              disabled={pruning}
              className="px-3 py-1.5 text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {pruning ? 'Pruning…' : 'Prune'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MemoryPanel({ health }: MemoryPanelProps) {
  const [results, setResults]   = useState<MemorySearchResult[]>([]);
  const [scope, setScope]       = useState('all');
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [offset, setOffset]     = useState(0);
  const [hasMore, setHasMore]   = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<(MemoryEntry & { tags?: string[] }) | null>(null);
  const [pruning, setPruning]   = useState(false);
  const [pruneResult, setPruneResult] = useState<{ deleted: number } | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [compactResult, setCompactResult] = useState<{ compacted: number; rawPruned: number } | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeResult, setSummarizeResult] = useState<{ summarized: number } | null>(null);
  const [showPruneModal, setShowPruneModal] = useState(false);
  const [exporting, setExporting]   = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [detailedStats, setDetailedStats] = useState<MemoryStatsDetailed | null>(null);

  // Load detailed memory stats + available tags
  useEffect(() => {
    memoryStatsDetailed().then(setDetailedStats).catch(() => {});
    listMemoryTags().then(r => setAvailableTags(r.tags)).catch(() => {});
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try { await exportMemory(); } catch { /* ignore */ }
    finally { setExporting(false); }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const entries = Array.isArray(json) ? json : (json.entries ?? json.data ?? []);
        const result = await importMemory(entries);
        setImportResult(`Imported ${result.imported}, skipped ${result.skipped} duplicates.`);
        await load();
      } catch (err) {
        setImportResult(err instanceof Error ? err.message : 'Import failed.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const load = useCallback(async (pageOffset = 0, searchText = search, scopeValue = scope, tagValue = tagFilter) => {
    setLoading(true);
    try {
      const data = await listMemory({
        text: searchText || undefined,
        scope: scopeValue !== 'all' ? scopeValue : undefined,
        tags: tagValue !== 'all' ? tagValue : undefined,
        limit: PAGE_SIZE,
        offset: pageOffset,
      });
      if (pageOffset === 0) {
        setResults(data);
      } else {
        setResults(prev => [...prev, ...data]);
      }
      setHasMore(data.length === PAGE_SIZE);
      setOffset(pageOffset);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [search, scope, tagFilter]);

  // Initial load and reload when scope changes — debounce handled separately for search
  useEffect(() => { setOffset(0); void load(0); }, [load]);

  // Debounced server-side search: fires 300ms after the user stops typing
  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0);
      setResults([]);
      void load(0, search, scope);
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Immediate reload when scope or tag filter changes
  useEffect(() => {
    setOffset(0);
    setResults([]);
    void load(0, search, scope);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    setOffset(0);
    setResults([]);
    void load(0, search, scope, tagFilter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagFilter]);

  const handleLoadMore = () => { void load(offset + PAGE_SIZE); };

  const handleDelete = async (id: string) => {
    await deleteMemory(id);
    setResults(r => r.filter(x => x.entry.id !== id));
  };

  const handlePin = async (result: MemorySearchResult) => {
    const entry = result.entry;
    const updated = entry.pinned ? await unpinMemory(entry.id) : await pinMemory(entry.id);
    setResults(r => r.map(x => x.entry.id === entry.id ? { ...x, entry: updated } : x));
  };

  const handleFormSave = (entry: MemoryEntry) => {
    if (editing) {
      setResults(r => r.map(x => x.entry.id === entry.id ? { ...x, entry } : x));
    } else {
      setResults(r => [{ entry, tags: [], score: 1 }, ...r]);
    }
    setShowForm(false);
    setEditing(null);
  };

  const openEdit = (result: MemorySearchResult) => {
    setEditing({ ...result.entry, tags: result.tags });
    setShowForm(true);
  };

  const handleSummarize = async () => {
    if (!confirm('Consolidate lowest-importance entries in the current scope using AI? This requires a model provider.')) return;
    setSummarizing(true);
    setSummarizeResult(null);
    try {
      const result = await summarizeMemory(scope !== 'all' ? scope : 'user');
      setSummarizeResult(result);
      void load(0);
    } catch { /* ignore */ }
    finally { setSummarizing(false); }
  };

  const handlePrune = async () => {
    if (!confirm('Remove lowest-importance entries exceeding 10,000? Pinned entries are kept.')) return;
    setPruning(true);
    setPruneResult(null);
    try {
      const result = await pruneMemory();
      setPruneResult(result);
      void load(0); // reload to reflect deletions
    } catch { /* ignore */ }
    finally { setPruning(false); }
  };

  const handleCompact = async () => {
    if (!confirm('Compact sessions? This summarizes old conversation turns to free storage space.')) return;
    setCompacting(true);
    setCompactResult(null);
    try {
      const result = await compactMemory();
      setCompactResult(result);
    } catch { /* ignore */ }
    finally { setCompacting(false); }
  };

  // Results are already filtered server-side; use them directly
  const filtered = results;

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Memory"
        description="Persistent knowledge stored across conversations. Search, browse, pin, and manage what your agents remember."
        tip="Use the search bar to find memories by keyword or semantic meaning. Filter by scope (user, agent, etc.) or tags. Pin important memories so they're always available. Use Prune to auto-remove low-importance entries."
      />
      {showForm && (
        <MemoryForm
          initial={editing ?? undefined}
          onSave={handleFormSave}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}
      {showPruneModal && (
        <PruneModal
          onClose={() => setShowPruneModal(false)}
          onPruned={(deleted) => {
            setPruneResult({ deleted });
            void load(0);
          }}
        />
      )}
      {health?.memory?.embeddingDegraded && (
        <div className="mx-4 mt-3 px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-400 flex items-start gap-2">
          <span className="shrink-0 text-amber-500 mt-0.5">ℹ</span>
          <span>
            Semantic memory search is unavailable — no embedding provider is active.
            Keyword and stored memory features still work normally.
            {' '}To enable semantic search, add an Ollama provider in the <button className="underline hover:text-zinc-200" onClick={() => {}}>Models tab</button>.
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 p-3 border-b border-zinc-800">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search memory…"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors"
        />
        <select
          value={scope}
          onChange={e => setScope(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors"
        >
          {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {availableTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={e => setTagFilter(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors"
            title="Filter by tag"
          >
            <option value="all">all tags</option>
            {availableTags.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button
          onClick={() => load(0)}
          className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 transition-colors flex items-center gap-1"
        >
          {loading ? <Spinner /> : '↺'}
        </button>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="px-2 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 rounded-lg text-white transition-colors"
          title="New memory entry"
        >
          + New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-zinc-800/50">
        {loading && offset === 0 ? (
          <div className="divide-y divide-zinc-800/50">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="px-4 py-3">
                <div className="h-3 bg-zinc-800 rounded animate-pulse w-1/3 mb-2" />
                <div className="h-2 bg-zinc-800 rounded animate-pulse w-2/3" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 && !loading ? (
          <EmptyState
            icon="🧠"
            title="No memories found"
            hint="Memories are created automatically as you chat"
          />
        ) : (
          <>
            {filtered.map(result => {
              const entry = result.entry;
              return (
                <div key={entry.id} className="px-4 py-3 hover:bg-zinc-900/50 group transition-colors">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-xs font-medium ${SCOPE_COLOR[entry.scope] ?? 'text-zinc-400'}`}>
                          {entry.scope}
                        </span>
                        {entry.pinned && <span className="text-amber-400 text-xs">📌</span>}
                        <span className="text-zinc-600 text-xs ml-auto">{timeAgo(entry.last_used)}</span>
                      </div>
                      <p className="text-sm text-zinc-200 truncate">{entry.title}</p>
                      <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{entry.content}</p>
                      {result.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {result.tags.map(tag => (
                            <span key={tag} className="text-xs bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={() => openEdit(result)}
                        title="Edit"
                        className="text-zinc-500 hover:text-brand-400 text-xs px-1 transition-colors"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => handlePin(result)}
                        title={entry.pinned ? 'Unpin' : 'Pin'}
                        className="text-zinc-500 hover:text-amber-400 text-xs px-1 transition-colors"
                      >
                        {entry.pinned ? '⊘' : '⊕'}
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="text-zinc-500 hover:text-red-400 text-xs px-1 transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {hasMore && !loading && (
              <button
                onClick={handleLoadMore}
                className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50 transition-colors"
              >
                Load more
              </button>
            )}
            {loading && offset > 0 && (
              <p className="text-zinc-600 text-xs p-3 text-center">Loading…</p>
            )}
          </>
        )}
      </div>

      <div className="border-t border-zinc-800 px-4 py-2 flex items-center gap-2 text-xs text-zinc-600">
        <span>
          {health?.memory.totalEntries !== undefined
            ? `${health.memory.totalEntries.toLocaleString()} total`
            : `${filtered.length} shown${hasMore ? '+' : ''}`}
        </span>
        {detailedStats?.sizeEstimateBytes !== undefined && (
          <span className="text-zinc-800" title="Estimated storage size">
            · {(detailedStats.sizeEstimateBytes / 1024).toFixed(1)}KB
          </span>
        )}
        {health?.memory.embeddingProvider && (
          <span className="text-zinc-700 ml-1">{health.memory.embeddingProvider}</span>
        )}
        {health?.memory !== undefined && (
          <>
            <span className="text-zinc-800">·</span>
            {health.memory.embeddingDegraded || health.memory.embeddingProvider === 'stub'
              ? <span className="text-zinc-600">keyword search</span>
              : <span className="text-brand-500">semantic search</span>
            }
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          {summarizeResult && (
            <span className="text-blue-600">{summarizeResult.summarized} summarized</span>
          )}
          {pruneResult && (
            <span className="text-emerald-600">{pruneResult.deleted} pruned</span>
          )}
          {compactResult && (
            <span className="text-blue-500">{compactResult.compacted} compacted</span>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            title="Export all memory entries as JSON"
            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {exporting ? '…' : 'export'}
          </button>
          <label
            title="Import memory entries from a JSON file"
            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
          >
            import
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>
          {importResult && (
            <span className={`text-xs ${importResult.includes('ailed') ? 'text-red-400' : 'text-emerald-400'}`}>
              {importResult}
            </span>
          )}
          <button
            onClick={handleSummarize}
            disabled={summarizing}
            title="Consolidate lowest-importance entries using AI"
            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {summarizing ? '…' : 'summarize'}
          </button>
          <button
            onClick={() => setShowPruneModal(true)}
            title="Delete entries by filter (date, tag, source)"
            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            bulk prune
          </button>
          <button
            onClick={handleCompact}
            disabled={compacting}
            title="Compact sessions — summarize old conversation turns to free storage space"
            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {compacting ? '…' : 'compact sessions'}
          </button>
          <button
            onClick={handlePrune}
            disabled={pruning}
            title="Remove lowest-importance entries exceeding 10,000"
            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {pruning ? '…' : 'prune'}
          </button>
        </div>
      </div>
    </div>
  );
}
