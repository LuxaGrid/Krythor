import { useState, useEffect, useCallback } from 'react';
import {
  listAgents, createAgent, updateAgent, deleteAgent, runAgent,
  listRuns, agentStats, listProviders, importAgent, exportAgent,
  type Agent, type AgentRun, type AgentStats, type Provider,
} from '../api.ts';
import { useAppConfig } from '../App.tsx';
import { PanelHeader } from './PanelHeader.tsx';

const STATUS_COLOR: Record<string, string> = {
  completed: 'text-emerald-400',
  running:   'text-brand-400',
  failed:    'text-red-400',
  stopped:   'text-amber-400',
};

// ── Shared components ──────────────────────────────────────────────────────

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

// ── Input class constants ──────────────────────────────────────────────────

const INPUT_CLS = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';
const SELECT_CLS = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';

function RunRow({ run }: { run: AgentRun }) {
  const [expanded, setExpanded] = useState(false);
  const durationMs = run.completedAt ? run.completedAt - run.startedAt : null;
  const durationLabel = durationMs !== null
    ? durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
    : '…';

  return (
    <div className="border border-zinc-800 rounded-lg p-3 text-xs space-y-1">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <span className={STATUS_COLOR[run.status] ?? 'text-zinc-400'}>{run.status}</span>
        <span className="text-zinc-500 truncate flex-1">{run.input}</span>
        <span className="text-zinc-600" title="Run duration">{durationLabel}</span>
        <span className="text-zinc-700">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="pt-2 space-y-1.5 border-t border-zinc-800/60 mt-2">
          {run.output && (
            <p className="text-zinc-400 whitespace-pre-wrap leading-relaxed">{run.output}</p>
          )}
          {run.errorMessage && (
            <p className="text-red-400 bg-red-950/30 rounded-lg p-2">{run.errorMessage}</p>
          )}
          {run.status === 'failed' && run.errorMessage?.includes('No model provider') && (
            <p className="text-zinc-600 text-[10px] mt-1">Go to the Models tab to add a provider.</p>
          )}
          {run.status === 'failed' && (run.errorMessage?.includes('GGUF') || run.errorMessage?.includes('llama-server')) && (
            <p className="text-zinc-600 text-[10px] mt-1">Start llama-server before running this agent.</p>
          )}
          {run.status === 'failed' && run.errorMessage?.includes('LOCAL_SERVER_UNAVAILABLE') && (
            <p className="text-zinc-600 text-[10px] mt-1">Your local AI server is not running. Start it first.</p>
          )}
          {/* Run summary line */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pt-0.5 text-zinc-700">
            {run.modelUsed && (
              <span title="Model used for this run">model: <span className="font-mono text-zinc-600">{run.modelUsed}</span></span>
            )}
            {run.selectionReason && (
              <span title="Why this model was chosen">why: <span className="text-zinc-600">{run.selectionReason}</span></span>
            )}
            {run.fallbackOccurred && (
              <span className="text-amber-600" title="Fallback model was used">fallback</span>
            )}
            {run.memoryUsed !== undefined && run.memoryUsed > 0 && (
              <span title={`${run.memoryUsed} memory entries used`} className="text-zinc-700">mem:{run.memoryUsed}</span>
            )}
            {durationMs !== null && (
              <span title="Total run duration">duration: {durationLabel}</span>
            )}
            <span className="text-zinc-800 font-mono text-[10px]" title="Run ID">{run.id.slice(0, 8)}…</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface AgentForm {
  name: string;
  systemPrompt: string;
  description: string;
  memoryScope: string;
  modelId: string;
  providerId: string;
  temperature: number;
  maxTokens: number;
  maxTurns: number;
}

const EMPTY_FORM: AgentForm = {
  name: '', systemPrompt: '', description: '', memoryScope: 'session',
  modelId: '', providerId: '', temperature: 0.7, maxTokens: 2048, maxTurns: 5,
};

export function AgentsPanel() {
  const { config, setConfig } = useAppConfig();
  const [agents, setAgents]   = useState<Agent[]>([]);
  const [runs, setRuns]       = useState<AgentRun[]>([]);
  const [stats, setStats]     = useState<AgentStats | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [runInput, setRunInput] = useState('');
  const [running, setRunning]   = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState<AgentForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, s, p] = await Promise.all([listAgents(), agentStats(), listProviders().catch(() => [])]);
      setAgents(a);
      setStats(s);
      setProviders(p);
      // Auto-select the configured agent
      if (config.selectedAgentId && !selected) {
        const found = a.find(ag => ag.id === config.selectedAgentId);
        if (found) setSelected(found);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [config.selectedAgentId, selected]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!selected) return;
    listRuns(selected.id).then(setRuns).catch(() => {});
  }, [selected]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setCreateError(null);
    setShowForm(true);
  };

  const openEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setForm({
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      description: agent.description ?? '',
      memoryScope: agent.memoryScope,
      modelId: agent.modelId ?? '',
      providerId: '',
      temperature: agent.temperature ?? 0.7,
      maxTokens: agent.maxTokens ?? 2048,
      maxTurns: agent.maxTurns ?? 5,
    });
    setCreateError(null);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.name || !form.systemPrompt) {
      setCreateError('Name and system prompt are required.');
      return;
    }
    setCreateError(null);
    const payload = {
      name: form.name, systemPrompt: form.systemPrompt,
      description: form.description, memoryScope: form.memoryScope,
      maxTurns: form.maxTurns,
      temperature: form.temperature,
      maxTokens: form.maxTokens,
      ...(form.modelId && { modelId: form.modelId }),
      ...(form.providerId && { providerId: form.providerId }),
    };
    try {
      if (editingId) {
        const agent = await updateAgent(editingId, payload);
        setAgents(a => a.map(x => x.id === editingId ? agent : x));
        if (selected?.id === editingId) setSelected(agent);
      } else {
        const agent = await createAgent(payload);
        setAgents(a => [...a, agent]);
        setSelected(agent);
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      setEditingId(null);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to save agent');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAgent(id);
      setAgents(a => a.filter(x => x.id !== id));
      if (selected?.id === id) setSelected(null);
      if (config.selectedAgentId === id) setConfig({ selectedAgentId: undefined });
    } catch { /* ignore */ }
  };

  const handleRun = async () => {
    if (!selected || !runInput.trim() || running) return;
    setRunning(true);
    setRunError(null);
    try {
      const run = await runAgent(selected.id, runInput.trim());
      setRuns(r => [run, ...r]);
      setRunInput('');
      if (run.status === 'failed') {
        setRunError(run.errorMessage ?? 'Run failed. Check your provider is reachable in the Models tab.');
      }
      const s = await agentStats();
      setStats(s);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setRunning(false);
    }
  };

  const handleSetActive = async (agent: Agent) => {
    await setConfig({ selectedAgentId: agent.id });
  };

  const handleImport = () => {
    setImportError(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const config = JSON.parse(text) as Record<string, unknown>;
        if (!config.name || !config.systemPrompt) {
          setImportError('Invalid agent file: missing name or systemPrompt.');
          return;
        }
        const agent = await importAgent(config);
        setAgents(a => [...a, agent]);
        setSelected(agent);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Import failed');
      }
    };
    input.click();
  };

  const handleExport = async (agent: Agent) => {
    try {
      await exportAgent(agent);
    } catch { /* ignore */ }
  };

  // Gather all models from providers for the dropdown
  const allModels = providers.flatMap(p =>
    (p.models ?? []).map(m => ({ label: `${m} (${p.name})`, modelId: m, providerId: p.id }))
  );

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Agents"
        description="Create and configure AI agents. Each agent has its own personality, model, and system prompt."
        tip="Click an agent in the list to view its details and run history. Use the + button to create a new agent. You can export and import agents as JSON files."
      />
      <div className="flex flex-1 min-h-0">
      {/* Agent list */}
      <div className="w-52 shrink-0 border-r border-zinc-800 flex flex-col">
        <div className="p-2 border-b border-zinc-800 flex items-center justify-between gap-1">
          <span className="text-xs text-zinc-500 shrink-0">
            {stats ? `${stats.agentCount} agent${stats.agentCount !== 1 ? 's' : ''}` : '—'}
          </span>
          <div className="flex gap-1 items-center">
            <button
              onClick={handleImport}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Import agent from JSON file"
            >import</button>
            <button
              onClick={openCreate}
              className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >+ new</button>
          </div>
        </div>
        {importError && (
          <p className="text-red-400 text-[10px] bg-red-950/30 px-2 py-1">{importError}</p>
        )}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loading ? (
            <div className="space-y-1 p-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-8 bg-zinc-800/50 rounded animate-pulse" />
              ))}
            </div>
          ) : agents.length === 0 ? (
            <EmptyState
              icon="🤖"
              title="No agents yet"
              hint="Click + new to create one"
            />
          ) : (
            agents.map(a => (
              <div
                key={a.id}
                onClick={() => { setSelected(a); if (showForm) setShowForm(false); }}
                className={`px-3 py-2 cursor-pointer text-xs border-b border-zinc-800/50 group flex items-center gap-1 transition-colors
                  ${selected?.id === a.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'}`}
              >
                <span className="flex-1 truncate">{a.name}</span>
                {config.selectedAgentId === a.id && (
                  <span className="text-brand-500 text-xs shrink-0">●</span>
                )}
                <button
                  onClick={e => { e.stopPropagation(); openEdit(a); }}
                  className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-brand-400 shrink-0 transition-colors"
                  title="Edit agent"
                >✎</button>
                {deleteConfirmId === a.id ? (
                  <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => { void handleDelete(a.id); setDeleteConfirmId(null); }}
                      className="text-red-400 hover:text-red-300 text-xs px-1 py-0.5 rounded bg-red-950/40"
                    >del</button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="text-zinc-500 hover:text-zinc-300 text-xs"
                    >×</button>
                  </div>
                ) : (
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteConfirmId(a.id); }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 shrink-0 transition-colors"
                  >✕</button>
                )}
              </div>
            ))
          )}
        </div>
        {stats && (
          <div className="p-2 border-t border-zinc-800 text-xs text-zinc-700">
            {stats.totalRuns} total run{stats.totalRuns !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {showForm ? (
          <div className="p-4 space-y-3 border-b border-zinc-800 overflow-y-auto">
            <p className="text-xs text-zinc-400 font-medium">{editingId ? 'Edit Agent' : 'New Agent'}</p>
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
              rows={4}
              className={`${INPUT_CLS} resize-none`}
            />
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-zinc-500 block mb-1">Memory scope</label>
                <select
                  value={form.memoryScope}
                  onChange={e => setForm(f => ({ ...f, memoryScope: e.target.value }))}
                  className={SELECT_CLS}
                >
                  <option value="session">session — clears between conversations</option>
                  <option value="agent">agent — persists across all runs of this agent</option>
                  <option value="workspace">workspace — shared across all agents</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-zinc-500">Temperature</label>
                  <span className="text-xs text-zinc-400 font-mono">{form.temperature.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0} max={2} step={0.1}
                  value={form.temperature}
                  onChange={e => setForm(f => ({ ...f, temperature: parseFloat(e.target.value) }))}
                  className="w-full accent-brand-500"
                />
                <div className="flex justify-between text-xs text-zinc-700 mt-0.5">
                  <span>0.0 (precise)</span>
                  <span>2.0 (creative)</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Max Tokens</label>
                  <input
                    type="number"
                    min={100} max={32000} step={100}
                    value={form.maxTokens}
                    onChange={e => setForm(f => ({ ...f, maxTokens: parseInt(e.target.value, 10) || 2048 }))}
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Max Turns</label>
                  <input
                    type="number"
                    min={1} max={20} step={1}
                    value={form.maxTurns}
                    onChange={e => setForm(f => ({ ...f, maxTurns: parseInt(e.target.value, 10) || 5 }))}
                    className={INPUT_CLS}
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Model (optional)</label>
              <select
                value={form.modelId ? `${form.modelId}|${form.providerId}` : ''}
                onChange={e => {
                  const [modelId, providerId] = e.target.value.split('|');
                  setForm(f => ({ ...f, modelId: modelId ?? '', providerId: providerId ?? '' }));
                }}
                className={SELECT_CLS}
              >
                <option value="">— Use default provider model —</option>
                {allModels.map(m => (
                  <option key={`${m.modelId}|${m.providerId}`} value={`${m.modelId}|${m.providerId}`}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            {createError && <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{createError}</p>}
            <div className="flex gap-2">
              <button onClick={handleSubmit} className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors">
                {editingId ? 'Save' : 'Create'}
              </button>
              <button onClick={() => { setShowForm(false); setCreateError(null); }} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </div>
        ) : selected ? (
          <>
            <div className="p-3 border-b border-zinc-800 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 font-medium truncate">{selected.name}</p>
                {selected.description && <p className="text-xs text-zinc-500 mt-0.5">{selected.description}</p>}
                <p className="text-xs text-zinc-700 mt-1">
                  scope: {selected.memoryScope} · maxTurns: {selected.maxTurns}
                  {selected.modelId && ` · model: ${selected.modelId}`}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => openEdit(selected)}
                  className="px-2 py-1 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleExport(selected)}
                  className="px-2 py-1 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                  title="Download agent config as JSON"
                >
                  Export
                </button>
                <button
                  onClick={() => handleSetActive(selected)}
                  className={`px-2 py-1 rounded-lg text-xs transition-colors ${config.selectedAgentId === selected.id
                    ? 'bg-brand-900/50 text-brand-400 cursor-default'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'}`}
                >
                  {config.selectedAgentId === selected.id ? '● active' : 'set active'}
                </button>
              </div>
            </div>

            {/* Run input */}
            <div className="border-b border-zinc-800 p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  value={runInput}
                  onChange={e => setRunInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleRun()}
                  placeholder="Run agent with input…"
                  disabled={running}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors"
                />
                <button
                  onClick={handleRun}
                  disabled={running || !runInput.trim()}
                  className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors flex items-center gap-1.5"
                >
                  {running ? <Spinner /> : 'Run'}
                </button>
              </div>
              {runError && <p className="text-amber-400 text-xs bg-amber-950/30 rounded-lg p-2">{runError}</p>}
            </div>

            {/* Runs */}
            <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
              {runs.length === 0 && <p className="text-zinc-700 text-xs">No runs yet. Enter a message above to run this agent.</p>}
              {runs.map(r => <RunRow key={r.id} run={r} />)}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-8">
            <p className="text-zinc-600 text-sm">Select an agent from the list</p>
            <p className="text-zinc-700 text-xs">or create a new one with <span className="text-brand-400">+ new</span></p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
