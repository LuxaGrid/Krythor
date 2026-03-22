import { useState, useEffect, useCallback, useRef } from 'react';
import { listConfigFiles, readConfigFile, writeConfigFile, type ConfigFileEntry } from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

const FILE_LABELS: Record<string, { label: string; description: string }> = {
  agents:    { label: 'agents.json',    description: 'Agent definitions — name, system prompt, model, memory scope, tools' },
  providers: { label: 'providers.json', description: 'Provider configs — endpoints, API keys (masked), model lists' },
  guard:     { label: 'guard.json',     description: 'Guard rules — allowlist/denylist policies and default action' },
  app:       { label: 'app-config.json',description: 'App settings — selected model, onboarding state, log level' },
};

function jsonPretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function validate(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid JSON';
  }
}

export function ConfigEditorPanel() {
  const [files, setFiles] = useState<ConfigFileEntry[]>([]);
  const [activeKey, setActiveKey] = useState<string>('agents');
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadFiles = useCallback(async () => {
    try {
      const res = await listConfigFiles();
      setFiles(res.files);
    } catch { /* ignore */ }
  }, []);

  const loadFile = useCallback(async (key: string) => {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const res = await readConfigFile(key);
      const pretty = jsonPretty(res.content || '{}');
      setContent(pretty);
      setOriginal(pretty);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    void loadFile(activeKey);
  }, [activeKey, loadFile]);

  const handleSave = async () => {
    const validErr = validate(content);
    if (validErr) { setError(`JSON error: ${validErr}`); return; }
    setSaving(true);
    setError(null);
    try {
      await writeConfigFile(activeKey, content);
      setOriginal(content);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleFormat = () => {
    const pretty = jsonPretty(content);
    setContent(pretty);
  };

  const handleReset = () => {
    setContent(original);
    setError(null);
  };

  const isDirty = content !== original;
  const jsonError = content.trim() ? validate(content) : null;

  // Tab key inserts 2 spaces in textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newContent = content.slice(0, start) + '  ' + content.slice(end);
      setContent(newContent);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void handleSave();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Config Editor"
        description="View and edit Krythor configuration files directly. Changes take effect after the gateway reloads."
        tip="Edit agents.json, providers.json, guard.json, or app-config.json. Changes are validated as JSON before saving. Ctrl+S to save. The gateway may need a restart to pick up changes to providers or guard rules."
      />

      <div className="flex flex-1 min-h-0">
        {/* File list sidebar */}
        <div className="w-48 flex-shrink-0 border-r border-zinc-800 flex flex-col">
          <div className="px-3 py-2 border-b border-zinc-800/60">
            <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider">Config files</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {Object.entries(FILE_LABELS).map(([key, meta]) => {
              const entry = files.find(f => f.key === key);
              const isActive = activeKey === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveKey(key)}
                  className={`w-full text-left px-3 py-2.5 transition-colors border-b border-zinc-900/40 flex flex-col gap-0.5 ${
                    isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300'
                  }`}
                >
                  <span className="text-[11px] font-mono font-medium truncate">{meta.label}</span>
                  <span className="text-[9px] text-zinc-700 leading-tight">{entry?.exists ? 'exists' : 'not created'}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60">
            <span className="text-[11px] font-mono text-zinc-500 flex-1 truncate">
              {FILE_LABELS[activeKey]?.description}
            </span>
            {isDirty && (
              <span className="text-[10px] font-mono text-amber-500">unsaved</span>
            )}
            {jsonError && (
              <span className="text-[10px] font-mono text-red-400 max-w-48 truncate" title={jsonError}>
                ✗ {jsonError}
              </span>
            )}
            <button
              onClick={handleFormat}
              disabled={loading || !!jsonError}
              className="text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-600 transition-colors disabled:opacity-30"
            >
              format
            </button>
            <button
              onClick={handleReset}
              disabled={!isDirty || loading}
              className="text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-600 transition-colors disabled:opacity-30"
            >
              reset
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading || !!jsonError || !isDirty}
              className={`text-[10px] font-mono px-3 py-0.5 rounded border transition-colors disabled:opacity-30 ${
                saved
                  ? 'border-emerald-700/40 text-emerald-400 bg-emerald-950/30'
                  : 'border-brand-700/40 text-brand-400 bg-brand-950/20 hover:border-brand-500/60 hover:text-brand-300'
              }`}
            >
              {saving ? 'saving…' : saved ? '✓ saved' : 'save'}
            </button>
          </div>

          {/* Error banner */}
          {error && (
            <div className="flex-shrink-0 px-3 py-1.5 bg-red-950/40 border-b border-red-800/40 flex items-center gap-2">
              <span className="text-[11px] text-red-400 flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red-600 hover:text-red-400 text-xs">×</button>
            </div>
          )}

          {/* Editor */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-[11px] font-mono text-zinc-700">loading…</span>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => { setContent(e.target.value); setError(null); setSaved(false); }}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              className={`flex-1 w-full resize-none bg-zinc-950 font-mono text-[12px] leading-relaxed px-4 py-3 outline-none text-zinc-300 placeholder-zinc-800 ${
                jsonError ? 'border-l-2 border-red-700' : isDirty ? 'border-l-2 border-amber-700/50' : ''
              }`}
              style={{ scrollbarColor: '#27272a #09090b', tabSize: 2 }}
              placeholder="Loading…"
            />
          )}
        </div>
      </div>
    </div>
  );
}
