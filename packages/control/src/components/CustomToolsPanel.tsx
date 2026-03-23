import { useState, useEffect, useCallback } from 'react';
import { listCustomTools, createCustomTool, deleteCustomTool, type CustomTool, type HttpMethod } from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

const INPUT_CLS  = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';
const SELECT_CLS = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const EMPTY_FORM = {
  name: '',
  description: '',
  url: '',
  method: 'POST' as HttpMethod,
  bodyTemplate: '',
  headersRaw: '',  // JSON string for headers
};

export function CustomToolsPanel() {
  const [tools, setTools]       = useState<CustomTool[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [firing, setFiring]     = useState<string | null>(null);
  const [fireResult, setFireResult] = useState<Record<string, { ok: boolean; status?: number; body?: string; error?: string }>>({});

  const load = useCallback(async () => {
    try {
      const list = await listCustomTools();
      setTools(list);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setError(null);
    if (!form.name.trim() || !form.url.trim() || !form.description.trim()) {
      setError('Name, description, and URL are required.');
      return;
    }

    let headers: Record<string, string> | undefined;
    if (form.headersRaw.trim()) {
      try {
        headers = JSON.parse(form.headersRaw);
      } catch {
        setError('Headers must be valid JSON, e.g. {"Authorization": "Bearer token"}');
        return;
      }
    }

    setSaving(true);
    try {
      await createCustomTool({
        name:         form.name.trim(),
        description:  form.description.trim(),
        url:          form.url.trim(),
        method:       form.method,
        ...(headers ? { headers } : {}),
        ...(form.bodyTemplate.trim() ? { bodyTemplate: form.bodyTemplate.trim() } : {}),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create tool.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(name: string) {
    setDeleting(name);
    try {
      await deleteCustomTool(name);
      setTools(ts => ts.filter(t => t.name !== name));
    } catch { /* non-fatal */ }
    finally { setDeleting(null); }
  }

  async function handleFire(tool: CustomTool) {
    setFiring(tool.name);
    setFireResult(r => ({ ...r, [tool.name]: { ok: false } }));
    try {
      const testInput = 'test';
      const body = tool.bodyTemplate
        ? tool.bodyTemplate.replace('{{input}}', testInput)
        : (tool.method !== 'GET' ? JSON.stringify({ input: testInput }) : undefined);
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...tool.headers };
      const res = await fetch(tool.url, {
        method: tool.method,
        headers,
        body: tool.method !== 'GET' && body ? body : undefined,
      });
      let respBody = '';
      try { respBody = await res.text(); } catch { /* ignore */ }
      setFireResult(r => ({
        ...r,
        [tool.name]: { ok: res.ok, status: res.status, body: respBody.slice(0, 200) },
      }));
    } catch (e: unknown) {
      setFireResult(r => ({
        ...r,
        [tool.name]: { ok: false, error: e instanceof Error ? e.message : 'Request failed' },
      }));
    } finally {
      setFiring(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Custom Tools"
        description="Register webhook-backed tools that agents can call by name."
        tip="Each tool is a named webhook endpoint. When an agent calls a custom tool, Krythor sends the agent's input to your URL and returns the response. Use {{input}} in the body template as a placeholder."
      />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500">
            {loading ? 'Loading…' : `${tools.length} tool${tools.length !== 1 ? 's' : ''} registered`}
          </p>
          {!showForm && (
            <button
              onClick={() => { setShowForm(true); setError(null); }}
              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg transition-colors"
            >
              + Add tool
            </button>
          )}
        </div>

        {/* Create form */}
        {showForm && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-zinc-300">New webhook tool</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Name <span className="text-zinc-700">(unique, no spaces)</span></label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value.replace(/\s/g, '_') }))}
                  placeholder="my_tool"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Method</label>
                <select
                  value={form.method}
                  onChange={e => setForm(f => ({ ...f, method: e.target.value as HttpMethod }))}
                  className={SELECT_CLS}
                >
                  {HTTP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Description</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What this tool does (shown to the agent)"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">URL</label>
              <input
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                placeholder="https://your-endpoint.example.com/hook"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">
                Body template <span className="text-zinc-700">(optional — use {'{{input}}'} for agent input)</span>
              </label>
              <input
                value={form.bodyTemplate}
                onChange={e => setForm(f => ({ ...f, bodyTemplate: e.target.value }))}
                placeholder={'{"query": "{{input}}"}'}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">
                Headers <span className="text-zinc-700">(optional JSON object)</span>
              </label>
              <input
                value={form.headersRaw}
                onChange={e => setForm(f => ({ ...f, headersRaw: e.target.value }))}
                placeholder='{"Authorization": "Bearer token"}'
                className={INPUT_CLS}
              />
            </div>
            {error && <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors"
              >
                {saving ? 'Saving…' : 'Create tool'}
              </button>
              <button
                onClick={() => { setShowForm(false); setError(null); setForm(EMPTY_FORM); }}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Tool list */}
        {!loading && tools.length === 0 && !showForm && (
          <div className="text-center py-16 text-zinc-600 text-sm">
            No custom tools yet. Add a webhook tool to let agents call external APIs.
          </div>
        )}
        <div className="space-y-2">
          {tools.map(tool => (
            <div key={tool.name} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-zinc-200">{tool.name}</span>
                    <span className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-mono">
                      {tool.method}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5">{tool.description}</p>
                  <p className="text-xs text-zinc-700 mt-1 font-mono truncate" title={tool.url}>{tool.url}</p>
                  {tool.bodyTemplate && (
                    <p className="text-xs text-zinc-700 mt-0.5 font-mono truncate" title={tool.bodyTemplate}>
                      body: {tool.bodyTemplate}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => void handleFire(tool)}
                    disabled={firing === tool.name}
                    className="px-2 py-1 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                    title="Fire a test request to this webhook"
                  >
                    {firing === tool.name ? '…' : 'Test'}
                  </button>
                  <button
                    onClick={() => handleDelete(tool.name)}
                    disabled={deleting === tool.name}
                    className="px-2 py-1 text-xs rounded-lg bg-zinc-800 hover:bg-red-900/40 text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    {deleting === tool.name ? '…' : 'Delete'}
                  </button>
                </div>
              </div>
              {fireResult[tool.name] && (
                <div className={`mt-2 px-2 py-1.5 rounded text-[10px] font-mono border ${
                  fireResult[tool.name]!.ok
                    ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-400'
                    : 'bg-red-950/30 border-red-800/40 text-red-400'
                }`}>
                  {fireResult[tool.name]!.error
                    ? `error: ${fireResult[tool.name]!.error}`
                    : `HTTP ${fireResult[tool.name]!.status} — ${fireResult[tool.name]!.body ?? '(empty body)'}`}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
