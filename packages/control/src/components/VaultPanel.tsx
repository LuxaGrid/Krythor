import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getVaultCatalog, installVaultSkill, removeVaultSkill, updateVaultSkill, importVaultSkillLocal,
  type VaultCatalogEntry, type VaultCatalog, type VaultSource, type VaultRisk,
} from '../api.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<VaultRisk, string> = {
  low:    'text-emerald-400 bg-emerald-950/40 border-emerald-800/40',
  medium: 'text-amber-400  bg-amber-950/40  border-amber-800/40',
  high:   'text-red-400    bg-red-950/40    border-red-800/40',
};

const SOURCE_COLORS: Record<VaultSource, string> = {
  official:  'text-sky-300   bg-sky-950/40   border-sky-800/40',
  community: 'text-purple-300 bg-purple-950/40 border-purple-800/40',
};

function RiskBadge({ risk }: { risk: VaultRisk }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${RISK_COLORS[risk]}`}>
      {risk === 'high' ? '⚠ high risk' : risk}
    </span>
  );
}

function SourceBadge({ source }: { source: VaultSource }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${SOURCE_COLORS[source]}`}>
      {source === 'official' ? 'Official' : 'Community'}
    </span>
  );
}

function PermissionTag({ perm }: { perm: string }) {
  const PERM_LABELS: Record<string, string> = {
    'memory:read':  'memory read',
    'memory:write': 'memory write',
    'internet:read': 'internet',
    'skill:invoke': 'skill chaining',
    'file:write':   'file write',
    'file:read':    'file read',
    'shell:exec':   'shell exec',
    'webhook:call': 'webhook',
  };
  const label = PERM_LABELS[perm] ?? perm;
  const high   = ['file:write', 'shell:exec', 'webhook:call'].includes(perm);
  const medium = ['internet:read', 'memory:write', 'skill:invoke', 'file:read'].includes(perm);
  const cls    = high   ? 'bg-red-950/50 text-red-300 border-red-800/40'
               : medium ? 'bg-amber-950/50 text-amber-300 border-amber-800/40'
               :          'bg-zinc-800/60 text-zinc-400 border-zinc-700/40';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>
  );
}

// ── Install Modal ─────────────────────────────────────────────────────────────

interface InstallModalProps {
  entry:     VaultCatalogEntry;
  onClose:   () => void;
  onInstalled: () => void;
}

function InstallModal({ entry, onClose, onInstalled }: InstallModalProps) {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');

  const doInstall = async () => {
    setBusy(true); setErr('');
    try {
      await installVaultSkill(entry.id);
      onInstalled();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Install failed');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-zinc-100 font-semibold text-base">{entry.name}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <SourceBadge source={entry.source} />
              <RiskBadge risk={entry.risk} />
              <span className="text-zinc-600 text-[10px]">v{entry.version}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none mt-0.5">×</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-zinc-300 text-sm leading-relaxed">{entry.description}</p>

          <div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1.5">Permissions requested</p>
            {entry.permissions.length === 0 ? (
              <p className="text-zinc-600 text-xs">No special permissions required.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {entry.permissions.map(p => <PermissionTag key={p} perm={p} />)}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-zinc-500 text-[10px] uppercase tracking-wide mb-0.5">Category</p>
              <p className="text-zinc-300">{entry.category}</p>
            </div>
            <div>
              <p className="text-zinc-500 text-[10px] uppercase tracking-wide mb-0.5">Compatibility</p>
              <p className="text-zinc-300">Krythor ≥ {entry.minKrythorVersion}</p>
            </div>
            <div>
              <p className="text-zinc-500 text-[10px] uppercase tracking-wide mb-0.5">Author</p>
              <p className="text-zinc-300">{entry.author}</p>
            </div>
          </div>

          {entry.risk === 'high' && (
            <div className="px-3 py-2 bg-red-950/30 border border-red-800/40 rounded-lg text-xs text-red-300">
              This skill requests high-sensitivity permissions. Review carefully before installing.
            </div>
          )}
          {entry.source === 'community' && (
            <div className="px-3 py-2 bg-purple-950/30 border border-purple-800/40 rounded-lg text-xs text-purple-300">
              Community skill — not reviewed by Krythor. Install only from sources you trust.
            </div>
          )}

          {err && <p className="text-red-400 text-xs">{err}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-zinc-400 hover:text-zinc-200 text-sm transition-colors"
          >Cancel</button>
          <button
            onClick={() => void doInstall()}
            disabled={busy}
            className="px-4 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >{busy ? 'Installing…' : 'Install skill'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Local Import Modal ────────────────────────────────────────────────────────

interface LocalImportModalProps {
  onClose:    () => void;
  onImported: () => void;
}

function LocalImportModal({ onClose, onImported }: LocalImportModalProps) {
  const [json,  setJson]  = useState('');
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = async () => {
    setErr('');
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(json) as Record<string, unknown>;
    } catch {
      setErr('Invalid JSON — paste a valid skill JSON file.');
      return;
    }
    if (!pkg['name'] || !pkg['systemPrompt']) {
      setErr('Skill JSON must include "name" and "systemPrompt" fields.');
      return;
    }
    setBusy(true);
    try {
      await importVaultSkillLocal(pkg);
      onImported();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed');
      setBusy(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setJson(String(ev.target?.result ?? ''));
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-zinc-100 font-semibold">Import skill from file</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg">×</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-zinc-400 text-xs">Paste a skill JSON or select a .json file to import as a Community skill.</p>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            onChange={onFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors"
          >Choose file…</button>
          <textarea
            value={json}
            onChange={e => setJson(e.target.value)}
            placeholder='{"name": "My Skill", "systemPrompt": "You are...", "description": "..."}'
            rows={8}
            className="w-full bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-300 text-xs font-mono resize-none focus:outline-none focus:border-zinc-500"
          />
          {err && <p className="text-red-400 text-xs">{err}</p>}
        </div>
        <div className="px-5 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-zinc-400 hover:text-zinc-200 text-sm">Cancel</button>
          <button
            onClick={() => void doImport()}
            disabled={busy || !json.trim()}
            className="px-4 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >{busy ? 'Importing…' : 'Import'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Skill Card ────────────────────────────────────────────────────────────────

interface SkillCardProps {
  entry:       VaultCatalogEntry;
  onInstall:   (e: VaultCatalogEntry) => void;
  onRemove:    (vaultId: string) => void;
  onUpdate:    (vaultId: string) => void;
  busy:        string | null;
}

function SkillCard({ entry, onInstall, onRemove, onUpdate, busy }: SkillCardProps) {
  const isBusy = busy === entry.id;

  return (
    <div className={`bg-zinc-900/60 border rounded-xl p-4 flex flex-col gap-3 transition-colors ${
      entry.installed ? 'border-brand-800/40' : 'border-zinc-800/60 hover:border-zinc-700'
    }`}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-zinc-100 font-medium text-sm truncate">{entry.name}</span>
            {entry.installed && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-900/60 border border-brand-700/40 text-brand-300">installed</span>
            )}
            {entry.updateAvailable && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700/40 text-amber-300">update</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <SourceBadge source={entry.source} />
            <RiskBadge risk={entry.risk} />
            <span className="text-zinc-600 text-[10px]">{entry.category}</span>
            <span className="text-zinc-700 text-[10px]">v{entry.version}</span>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-zinc-400 text-xs leading-relaxed line-clamp-3">{entry.description}</p>

      {/* Permissions */}
      {entry.permissions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.permissions.map(p => <PermissionTag key={p} perm={p} />)}
        </div>
      )}

      {/* Tags */}
      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.tags.map(t => (
            <span key={t} className="text-[10px] text-zinc-600 bg-zinc-800/40 px-1.5 py-0.5 rounded">
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-auto pt-1">
        {!entry.installed ? (
          <button
            onClick={() => onInstall(entry)}
            disabled={isBusy}
            className="px-3 py-1.5 bg-brand-700 hover:bg-brand-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
          >{isBusy ? 'Installing…' : 'Install'}</button>
        ) : (
          <>
            {entry.updateAvailable && (
              <button
                onClick={() => onUpdate(entry.id)}
                disabled={isBusy}
                className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
              >{isBusy ? 'Updating…' : 'Update'}</button>
            )}
            <button
              onClick={() => onRemove(entry.id)}
              disabled={isBusy}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-red-900/40 disabled:opacity-50 text-zinc-400 hover:text-red-300 text-xs rounded-lg transition-colors border border-zinc-700/40"
            >{isBusy ? '…' : 'Remove'}</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── VaultPanel ────────────────────────────────────────────────────────────────

const ALL_CATEGORIES = 'All Categories';
const ALL_SOURCES    = 'all';

export function VaultPanel() {
  const [catalog,        setCatalog]       = useState<VaultCatalog | null>(null);
  const [loading,        setLoading]       = useState(true);
  const [error,          setError]         = useState('');
  const [search,         setSearch]        = useState('');
  const [category,       setCategory]      = useState(ALL_CATEGORIES);
  const [sourceFilter,   setSourceFilter]  = useState<VaultSource | 'all'>(ALL_SOURCES);
  const [showInstalled,  setShowInstalled] = useState(false);
  const [showUpdates,    setShowUpdates]   = useState(false);
  const [installTarget,  setInstallTarget] = useState<VaultCatalogEntry | null>(null);
  const [showImport,     setShowImport]    = useState(false);
  const [busy,           setBusy]          = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const cat = await getVaultCatalog();
      setCatalog(cat);
      setError('');
    } catch {
      setError('Could not load Vault catalog. Check that the gateway is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleRemove = async (vaultId: string) => {
    setBusy(vaultId);
    try { await removeVaultSkill(vaultId); await load(); }
    catch { /* no-op */ }
    setBusy(null);
  };

  const handleUpdate = async (vaultId: string) => {
    setBusy(vaultId);
    try { await updateVaultSkill(vaultId); await load(); }
    catch { /* no-op */ }
    setBusy(null);
  };

  const categories = catalog
    ? [ALL_CATEGORIES, ...Array.from(new Set(catalog.skills.map(s => s.category))).sort()]
    : [ALL_CATEGORIES];

  const filtered = (catalog?.skills ?? []).filter(entry => {
    if (showInstalled && !entry.installed)       return false;
    if (showUpdates   && !entry.updateAvailable) return false;
    if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false;
    if (category !== ALL_CATEGORIES && entry.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !entry.name.toLowerCase().includes(q) &&
        !entry.description.toLowerCase().includes(q) &&
        !entry.tags.some(t => t.toLowerCase().includes(q)) &&
        !entry.category.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const installedCount = catalog?.skills.filter(s => s.installed).length ?? 0;
  const updatesCount   = catalog?.updatable.length ?? 0;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-base font-semibold text-zinc-100">Krythor Vault</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              Browse and install reusable skills.
              {installedCount > 0 && ` ${installedCount} installed.`}
              {updatesCount   > 0 && ` ${updatesCount} update${updatesCount > 1 ? 's' : ''} available.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors border border-zinc-700/40"
            >Import local</button>
            <button
              onClick={() => void load()}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors"
              title="Refresh catalog"
            >↺</button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Search skills…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[180px] bg-zinc-800/60 border border-zinc-700 rounded-lg px-3 py-1.5 text-zinc-300 text-xs placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-300 text-xs focus:outline-none"
          >
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value as VaultSource | 'all')}
            className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-2 py-1.5 text-zinc-300 text-xs focus:outline-none"
          >
            <option value="all">All sources</option>
            <option value="official">Official</option>
            <option value="community">Community</option>
          </select>
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-zinc-400 whitespace-nowrap">
            <input
              type="checkbox"
              checked={showInstalled}
              onChange={e => setShowInstalled(e.target.checked)}
              className="w-3 h-3 rounded accent-brand-500"
            />
            Installed
          </label>
          {updatesCount > 0 && (
            <label className="flex items-center gap-1.5 cursor-pointer text-xs text-amber-400 whitespace-nowrap">
              <input
                type="checkbox"
                checked={showUpdates}
                onChange={e => setShowUpdates(e.target.checked)}
                className="w-3 h-3 rounded accent-amber-500"
              />
              Updates ({updatesCount})
            </label>
          )}
        </div>

        {catalog?.note && (
          <p className="mt-2 text-xs text-zinc-600">{catalog.note}</p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading && (
          <div className="flex items-center justify-center py-16 text-zinc-600 text-sm">Loading catalog…</div>
        )}
        {error && (
          <div className="text-red-400 text-sm py-8 text-center">{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="text-zinc-600 text-sm py-8 text-center">
            {search || category !== ALL_CATEGORIES || sourceFilter !== 'all' || showInstalled || showUpdates
              ? 'No skills match your filters.'
              : 'No skills in catalog.'}
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(entry => (
              <SkillCard
                key={entry.id}
                entry={entry}
                onInstall={setInstallTarget}
                onRemove={id => void handleRemove(id)}
                onUpdate={id => void handleUpdate(id)}
                busy={busy}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {installTarget && (
        <InstallModal
          entry={installTarget}
          onClose={() => setInstallTarget(null)}
          onInstalled={() => void load()}
        />
      )}
      {showImport && (
        <LocalImportModal
          onClose={() => setShowImport(false)}
          onImported={() => void load()}
        />
      )}
    </div>
  );
}
