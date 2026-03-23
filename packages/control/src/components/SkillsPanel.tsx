import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  listSkills, listBuiltinSkills, createSkill, updateSkill, deleteSkill, listProviders, runSkill,
  type Skill, type CreateSkillInput, type Provider, type BuiltinSkill, type SkillTaskProfile,
} from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

const INPUT_CLS = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';
const SELECT_CLS = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const Spinner = () => (
  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>
);

interface SkillForm {
  name: string;
  description: string;
  systemPrompt: string;
  tags: string;   // comma-separated in UI, split on submit
  modelId: string;
  providerId: string;
  // Task profile — used by ModelRecommender
  taskCategories: string;   // comma-separated
  costTier: string;
  speedTier: string;
  requiresVision: boolean;
  localOk: boolean;
  reasoningDepth: string;
  privacySensitive: boolean;
}

const EMPTY_FORM: SkillForm = {
  name: '', description: '', systemPrompt: '', tags: '', modelId: '', providerId: '',
  taskCategories: '', costTier: '', speedTier: '', requiresVision: false, localOk: true,
  reasoningDepth: '', privacySensitive: false,
};

function SkillFormPanel({
  initial,
  providers,
  onSave,
  onClose,
}: {
  initial?: Skill;
  providers: Provider[];
  onSave: (skill: Skill) => void;
  onClose: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState<SkillForm>(
    initial
      ? {
          name: initial.name,
          description: initial.description,
          systemPrompt: initial.systemPrompt,
          tags: initial.tags.join(', '),
          modelId: initial.modelId ?? '',
          providerId: initial.providerId ?? '',
          taskCategories: initial.taskProfile?.taskCategories?.join(', ') ?? '',
          costTier: initial.taskProfile?.costTier ?? '',
          speedTier: initial.taskProfile?.speedTier ?? '',
          requiresVision: initial.taskProfile?.requiresVision ?? false,
          localOk: initial.taskProfile?.localOk ?? true,
          reasoningDepth: initial.taskProfile?.reasoningDepth ?? '',
          privacySensitive: initial.taskProfile?.privacySensitive ?? false,
        }
      : EMPTY_FORM
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const allModels = providers.flatMap(p =>
    (p.models ?? []).map(m => ({ label: `${m} (${p.name})`, modelId: m, providerId: p.id }))
  );

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return; }
    if (!form.systemPrompt.trim()) { setError('System prompt is required.'); return; }
    setError(null);
    setSaving(true);
    try {
      const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
      const taskCategories = form.taskCategories.split(',').map(t => t.trim()).filter(Boolean);
      const taskProfile: SkillTaskProfile = {
        ...(taskCategories.length > 0 && { taskCategories }),
        ...(form.costTier && { costTier: form.costTier as SkillTaskProfile['costTier'] }),
        ...(form.speedTier && { speedTier: form.speedTier as SkillTaskProfile['speedTier'] }),
        ...(form.reasoningDepth && { reasoningDepth: form.reasoningDepth as SkillTaskProfile['reasoningDepth'] }),
        requiresVision: form.requiresVision,
        localOk: form.localOk,
        privacySensitive: form.privacySensitive,
      };
      const hasTaskProfile = taskCategories.length > 0 || form.costTier || form.speedTier || form.requiresVision || !form.localOk || form.reasoningDepth || form.privacySensitive;
      const payload: CreateSkillInput = {
        name: form.name.trim(),
        description: form.description.trim(),
        systemPrompt: form.systemPrompt.trim(),
        tags,
        ...(form.modelId && { modelId: form.modelId }),
        ...(form.providerId && { providerId: form.providerId }),
        ...(hasTaskProfile && { taskProfile }),
      };
      const skill = initial
        ? await updateSkill(initial.id, payload)
        : await createSkill(payload);
      onSave(skill);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save skill');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-3 border-b border-zinc-800 bg-zinc-900/30 overflow-y-auto">
      <p className="text-xs text-zinc-400 font-medium">{initial ? 'Edit Skill' : 'New Skill'}</p>
      <input
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="Name *"
        className={INPUT_CLS}
      />
      <input
        value={form.description}
        onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        placeholder="Description (optional)"
        className={INPUT_CLS}
      />
      <textarea
        value={form.systemPrompt}
        onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
        placeholder="System prompt *"
        rows={5}
        className={`${INPUT_CLS} resize-none`}
      />
      <div>
        <label className="text-xs text-zinc-500 block mb-1">Tags (comma-separated)</label>
        <input
          value={form.tags}
          onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
          placeholder="e.g. writing, code, research"
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className="text-xs text-zinc-500 block mb-1">Model (optional — overrides default)</label>
        <select
          value={form.modelId ? `${form.modelId}|${form.providerId}` : ''}
          onChange={e => {
            const [modelId, providerId] = e.target.value.split('|');
            setForm(f => ({ ...f, modelId: modelId ?? '', providerId: providerId ?? '' }));
          }}
          className={SELECT_CLS}
        >
          <option value="">— Use default model —</option>
          {allModels.map(m => (
            <option key={`${m.modelId}|${m.providerId}`} value={`${m.modelId}|${m.providerId}`}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      {/* Task Profile — affects ModelRecommender routing */}
      <div className="border border-zinc-700/60 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced(s => !s)}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-800/30 hover:bg-zinc-800/60 transition-colors text-left"
        >
          <span>{showAdvanced ? '▾' : '▸'}</span>
          Task Profile
          <span className="text-zinc-700 ml-1">(model routing hints)</span>
        </button>
        {showAdvanced && (
          <div className="px-3 py-3 space-y-2 bg-zinc-900/30">
            <div>
              <label className="text-[10px] text-zinc-600 block mb-1 uppercase tracking-wide">Task categories</label>
              <input
                value={form.taskCategories}
                onChange={e => setForm(f => ({ ...f, taskCategories: e.target.value }))}
                placeholder="e.g. coding, writing, analysis"
                className={INPUT_CLS}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-zinc-600 block mb-1 uppercase tracking-wide">Cost</label>
                <select value={form.costTier} onChange={e => setForm(f => ({ ...f, costTier: e.target.value }))} className={SELECT_CLS}>
                  <option value="">auto</option>
                  <option value="local_preferred">local preferred</option>
                  <option value="cost_aware">cost aware</option>
                  <option value="quality_first">quality first</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-zinc-600 block mb-1 uppercase tracking-wide">Speed</label>
                <select value={form.speedTier} onChange={e => setForm(f => ({ ...f, speedTier: e.target.value }))} className={SELECT_CLS}>
                  <option value="">auto</option>
                  <option value="fast">fast</option>
                  <option value="normal">normal</option>
                  <option value="thorough">thorough</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-zinc-600 block mb-1 uppercase tracking-wide">Reasoning</label>
                <select value={form.reasoningDepth} onChange={e => setForm(f => ({ ...f, reasoningDepth: e.target.value }))} className={SELECT_CLS}>
                  <option value="">auto</option>
                  <option value="shallow">shallow</option>
                  <option value="medium">medium</option>
                  <option value="deep">deep</option>
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.requiresVision}
                  onChange={e => setForm(f => ({ ...f, requiresVision: e.target.checked }))}
                  className="rounded"
                />
                Requires vision
              </label>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.localOk}
                  onChange={e => setForm(f => ({ ...f, localOk: e.target.checked }))}
                  className="rounded"
                />
                Local models OK
              </label>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.privacySensitive}
                  onChange={e => setForm(f => ({ ...f, privacySensitive: e.target.checked }))}
                  className="rounded"
                />
                Privacy sensitive
              </label>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors flex items-center gap-1.5"
        >
          {saving ? <Spinner /> : null}
          {initial ? 'Save' : 'Create'}
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Run Skill Dialog ───────────────────────────────────────────────────────

interface RunSkillDialogProps {
  skill: Skill | BuiltinSkill;
  onClose: () => void;
}

function RunSkillDialog({ skill, onClose }: RunSkillDialogProps) {
  const [input, setInput]   = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const isBuiltin = !('id' in skill) || !('version' in skill);

  const handleRun = async () => {
    if (!input.trim()) return;
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      if (isBuiltin) {
        // Builtins don't have a run endpoint — show an info message
        setResult('Built-in skills run via the Command tab when selected as active skill. Use the "Run" input in the Command panel to invoke them.');
        return;
      }
      const res = await runSkill((skill as Skill).id, input.trim());
      setResult(res.output ?? '(no output)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={handleBackdrop}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[520px] max-w-[95vw] overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Run: {skill.name}</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none transition-colors">×</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleRun(); }}
            placeholder="Input for this skill…"
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleRun}
              disabled={running || !input.trim()}
              className="px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {running ? 'Running…' : 'Run'}
            </button>
            <button onClick={onClose} className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg transition-colors">Close</button>
          </div>
          {error && <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{error}</p>}
          {result && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">Output</p>
              <pre className="text-xs text-zinc-300 bg-zinc-800/50 rounded-lg p-3 whitespace-pre-wrap leading-relaxed border border-zinc-800 max-h-60 overflow-y-auto">
                {result}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SkillsPanel() {
  const [skills, setSkills]         = useState<Skill[]>([]);
  const [builtins, setBuiltins]     = useState<BuiltinSkill[]>([]);
  const [providers, setProviders]   = useState<Provider[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filterTag, setFilterTag]   = useState('');
  const [search, setSearch]         = useState('');
  const [showForm, setShowForm]     = useState(false);
  const [editing, setEditing]       = useState<Skill | null>(null);
  const [selected, setSelected]     = useState<Skill | null>(null);
  const [runningSkill, setRunningSkill] = useState<Skill | BuiltinSkill | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, b] = await Promise.all([
        listSkills(),
        listProviders().catch(() => [] as Provider[]),
        listBuiltinSkills().catch(() => [] as BuiltinSkill[]),
      ]);
      setSkills(s);
      setProviders(p);
      setBuiltins(b);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Collect all unique tags across all skills
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    skills.forEach(s => s.tags.forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [skills]);

  // Filter by selected tag and search text
  const filtered = useMemo(() => {
    let result = skills;
    if (filterTag) result = result.filter(s => s.tags.includes(filterTag));
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    return result;
  }, [skills, filterTag, search]);

  const handleSave = (skill: Skill) => {
    setSkills(prev => {
      const exists = prev.find(s => s.id === skill.id);
      return exists ? prev.map(s => s.id === skill.id ? skill : s) : [skill, ...prev];
    });
    setShowForm(false);
    setEditing(null);
    setSelected(skill);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSkill(id);
      setSkills(prev => prev.filter(s => s.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch { /* ignore */ }
    setDeleteConfirmId(null);
  };

  const openEdit = (skill: Skill) => {
    setEditing(skill);
    setShowForm(true);
    setSelected(null);
  };

  const openCreate = () => {
    setEditing(null);
    setShowForm(true);
    setSelected(null);
  };

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Skills"
        description="Reusable task templates that give your agents specialized capabilities and pre-configured behaviors."
        tip="Click a skill to view its details and run it on demand. Built-in skills are provided by Krythor. Create custom skills with your own system prompts and model preferences."
      />
      <div className="flex flex-1 min-h-0">
      {runningSkill && (
        <RunSkillDialog skill={runningSkill} onClose={() => setRunningSkill(null)} />
      )}
      {/* Left sidebar — skill list */}
      <div className="w-56 shrink-0 border-r border-zinc-800 flex flex-col">
        {/* Toolbar */}
        <div className="p-2 border-b border-zinc-800 flex items-center gap-1">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 transition-colors"
          />
          <button
            onClick={openCreate}
            className="text-xs text-brand-400 hover:text-brand-300 transition-colors shrink-0 px-1"
            title="New skill"
          >+ new</button>
        </div>

        {/* Tag filter pills */}
        {allTags.length > 0 && (
          <div className="px-2 py-1.5 border-b border-zinc-800 flex flex-wrap gap-1">
            <button
              onClick={() => setFilterTag('')}
              className={`text-xs px-1.5 py-0.5 rounded-full transition-colors ${
                !filterTag ? 'bg-brand-900/60 border border-brand-600 text-brand-300' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
              }`}
            >all</button>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setFilterTag(filterTag === tag ? '' : tag)}
                className={`text-xs px-1.5 py-0.5 rounded-full transition-colors ${
                  filterTag === tag ? 'bg-brand-900/60 border border-brand-600 text-brand-300' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'
                }`}
              >{tag}</button>
            ))}
          </div>
        )}

        {/* Skill list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loading ? (
            <div className="space-y-1 p-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-10 bg-zinc-800/50 rounded animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-6">
              <div className="text-2xl opacity-30">✦</div>
              <p className="text-zinc-500 text-xs">
                {skills.length === 0 ? 'No skills yet' : 'No matches'}
              </p>
              {skills.length === 0 && (
                <p className="text-zinc-700 text-xs">Click + new to create one</p>
              )}
            </div>
          ) : (
            filtered.map(skill => (
              <div
                key={skill.id}
                onClick={() => { setSelected(skill); if (showForm) { setShowForm(false); setEditing(null); } }}
                className={`px-3 py-2 cursor-pointer text-xs border-b border-zinc-800/50 group transition-colors ${
                  selected?.id === skill.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                }`}
              >
                <div className="flex items-center gap-1">
                  <span className="flex-1 truncate font-medium">{skill.name}</span>
                  <button
                    onClick={e => { e.stopPropagation(); openEdit(skill); }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-brand-400 shrink-0 transition-colors"
                    title="Edit"
                  >✎</button>
                  {deleteConfirmId === skill.id ? (
                    <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => void handleDelete(skill.id)}
                        className="text-red-400 hover:text-red-300 text-xs px-1 py-0.5 rounded bg-red-950/40"
                      >del</button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="text-zinc-500 hover:text-zinc-300 text-xs"
                      >×</button>
                    </div>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); setDeleteConfirmId(skill.id); }}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 shrink-0 transition-colors"
                    >✕</button>
                  )}
                </div>
                {skill.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {skill.tags.slice(0, 3).map(t => (
                      <span key={t} className="text-xs bg-zinc-700/50 text-zinc-500 px-1 rounded">{t}</span>
                    ))}
                    {skill.tags.length > 3 && (
                      <span className="text-xs text-zinc-700">+{skill.tags.length - 3}</span>
                    )}
                  </div>
                )}
                <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-700">
                  {skill.runCount > 0 ? (
                    <>
                      <span>runs: {skill.runCount}</span>
                      {skill.lastRunAt && (
                        <span title={new Date(skill.lastRunAt).toLocaleString()}>
                          · {timeAgo(skill.lastRunAt)}
                        </span>
                      )}
                    </>
                  ) : (
                    <span>never run</span>
                  )}
                  <span className="ml-auto">v{skill.version}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-2 border-t border-zinc-800 text-xs text-zinc-700">
          {skills.length} skill{skills.length !== 1 ? 's' : ''}
          {builtins.length > 0 && ` + ${builtins.length} built-in`}
          {filterTag ? ` · tag: ${filterTag}` : ''}
        </div>
      </div>

      {/* Right panel — form or detail view */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {showForm ? (
          <SkillFormPanel
            initial={editing ?? undefined}
            providers={providers}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditing(null); }}
          />
        ) : selected ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200">{selected.name}</p>
                {selected.description && (
                  <p className="text-xs text-zinc-500 mt-1">{selected.description}</p>
                )}
                {selected.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selected.tags.map(t => (
                      <span key={t} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">{t}</span>
                    ))}
                  </div>
                )}
                {selected.modelId && (
                  <p className="text-xs text-zinc-600 mt-1">model: {selected.modelId}</p>
                )}
                {selected.taskProfile && Object.keys(selected.taskProfile).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selected.taskProfile.costTier && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-amber-600 border border-zinc-700">
                        {selected.taskProfile.costTier.replace('_', ' ')}
                      </span>
                    )}
                    {selected.taskProfile.speedTier && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-blue-500 border border-zinc-700">
                        {selected.taskProfile.speedTier}
                      </span>
                    )}
                    {selected.taskProfile.reasoningDepth && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-purple-500 border border-zinc-700">
                        {selected.taskProfile.reasoningDepth} reasoning
                      </span>
                    )}
                    {selected.taskProfile.requiresVision && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">vision</span>
                    )}
                    {selected.taskProfile.privacySensitive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">private</span>
                    )}
                    {selected.taskProfile.localOk === false && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700">cloud only</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => setRunningSkill(selected)}
                  className="px-2 py-1 rounded-lg text-xs bg-brand-700 hover:bg-brand-600 text-white transition-colors"
                >Run</button>
                <button
                  onClick={() => openEdit(selected)}
                  className="px-2 py-1 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                >Edit</button>
              </div>
            </div>
            <div>
              <p className="text-xs text-zinc-600 mb-1 uppercase tracking-wider">System Prompt</p>
              <pre className="text-xs text-zinc-300 bg-zinc-800/50 rounded-lg p-3 whitespace-pre-wrap leading-relaxed border border-zinc-800">
                {selected.systemPrompt}
              </pre>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Builtins section — shown when no user skill is selected */}
            {builtins.length > 0 && (
              <div className="p-4 space-y-3">
                <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Built-in Skills</p>
                <div className="space-y-2">
                  {builtins.map(b => (
                    <div key={b.builtinId} className="bg-zinc-800/40 border border-zinc-700/50 rounded-lg p-3 flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-zinc-300">{b.name}</p>
                        <p className="text-xs text-zinc-600 mt-0.5">{b.description}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {b.tags.map(t => (
                            <span key={t} className="text-[10px] bg-zinc-700/50 text-zinc-500 px-1 rounded">{t}</span>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={() => setRunningSkill(b as unknown as Skill)}
                        className="px-2 py-1 rounded text-xs bg-brand-800/60 hover:bg-brand-700/60 text-brand-400 transition-colors shrink-0"
                      >Run</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center px-8">
              <p className="text-zinc-600 text-sm">Select a skill from the list</p>
              <p className="text-zinc-700 text-xs">or create a new one with <span className="text-brand-400">+ new</span></p>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
