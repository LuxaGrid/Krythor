import { useState, useEffect, useCallback } from 'react';
import {
  listChannels, listChannelEvents, createChannel, updateChannel, deleteChannel, testChannel,
  type Channel, type ChannelEvent, type CreateChannelInput,
} from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

const INPUT_CLS  = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';

const EMPTY_FORM: CreateChannelInput & { secretInput: string } = {
  name:        '',
  url:         '',
  events:      [],
  secret:      '',
  secretInput: '',
  isEnabled:   true,
};

function timeAgo(ts?: string): string {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function ChannelsPanel() {
  const [channels, setChannels]       = useState<Channel[]>([]);
  const [allEvents, setAllEvents]     = useState<ChannelEvent[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showForm, setShowForm]       = useState(false);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [testing, setTesting]         = useState<string | null>(null);
  const [testResult, setTestResult]   = useState<Record<string, string>>({});
  const [togglingId, setTogglingId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [chs, evts] = await Promise.all([listChannels(), listChannelEvents()]);
      setChannels(chs);
      setAllEvents(evts.events);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggleEvent(evt: ChannelEvent) {
    setForm(f => ({
      ...f,
      events: f.events?.includes(evt)
        ? f.events.filter(e => e !== evt)
        : [...(f.events ?? []), evt],
    }));
  }

  async function handleSave() {
    setError(null);
    if (!form.name.trim() || !form.url.trim()) {
      setError('Name and URL are required.');
      return;
    }
    setSaving(true);
    try {
      await createChannel({
        name:      form.name.trim(),
        url:       form.url.trim(),
        events:    form.events,
        isEnabled: form.isEnabled,
        ...(form.secretInput.trim() ? { secret: form.secretInput.trim() } : {}),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create channel.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(ch: Channel) {
    setTogglingId(ch.id);
    try {
      const updated = await updateChannel(ch.id, { isEnabled: !ch.isEnabled });
      setChannels(cs => cs.map(c => c.id === ch.id ? updated : c));
    } catch { /* non-fatal */ }
    finally { setTogglingId(null); }
  }

  async function handleDelete(id: string) {
    try {
      await deleteChannel(id);
      setChannels(cs => cs.filter(c => c.id !== id));
    } catch { /* non-fatal */ }
  }

  async function handleTest(id: string) {
    setTesting(id);
    setTestResult(r => ({ ...r, [id]: '' }));
    try {
      const res = await testChannel(id);
      setTestResult(r => ({
        ...r,
        [id]: res.ok
          ? `✓ Delivered (HTTP ${res.statusCode})`
          : `✗ Failed${res.statusCode ? ` (HTTP ${res.statusCode})` : ''}: ${res.error ?? 'unknown'}`,
      }));
    } catch (e: unknown) {
      setTestResult(r => ({ ...r, [id]: `✗ ${e instanceof Error ? e.message : 'Error'}` }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Channels"
        description="Outbound webhooks that fire when Krythor events occur."
        tip="Channels let you push events to external systems — Slack, Notion, Make, Zapier, or your own endpoint. Leave events empty to subscribe to all events. Provide a secret for HMAC-SHA256 request signing."
      />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-500">
            {loading ? 'Loading…' : `${channels.length} channel${channels.length !== 1 ? 's' : ''}`}
          </p>
          {!showForm && (
            <button
              onClick={() => { setShowForm(true); setError(null); }}
              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg transition-colors"
            >
              + Add channel
            </button>
          )}
        </div>

        {/* Create form */}
        {showForm && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-zinc-300">New outbound channel</p>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Name</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="My Slack hook"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Webhook URL</label>
              <input
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                placeholder="https://hooks.slack.com/…"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">
                Events <span className="text-zinc-700">(none selected = all events)</span>
              </label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {allEvents.map(evt => (
                  <button
                    key={evt}
                    onClick={() => toggleEvent(evt)}
                    className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                      form.events?.includes(evt)
                        ? 'border-brand-600 bg-brand-900/40 text-brand-300'
                        : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
                    }`}
                  >
                    {evt}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">
                Secret <span className="text-zinc-700">(optional, for HMAC signing)</span>
              </label>
              <input
                type="password"
                value={form.secretInput}
                onChange={e => setForm(f => ({ ...f, secretInput: e.target.value }))}
                placeholder="webhook secret…"
                className={INPUT_CLS}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="ch-enabled"
                checked={form.isEnabled}
                onChange={e => setForm(f => ({ ...f, isEnabled: e.target.checked }))}
                className="accent-brand-600"
              />
              <label htmlFor="ch-enabled" className="text-xs text-zinc-400">Enabled</label>
            </div>
            {error && <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors"
              >
                {saving ? 'Saving…' : 'Create channel'}
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

        {/* Channel list */}
        {!loading && channels.length === 0 && !showForm && (
          <div className="text-center py-16 text-zinc-600 text-sm">
            No channels yet. Add a webhook to push Krythor events to external services.
          </div>
        )}
        <div className="space-y-2">
          {channels.map(ch => (
            <div key={ch.id} className={`bg-zinc-900 border rounded-xl p-3 transition-colors ${ch.isEnabled ? 'border-zinc-800' : 'border-zinc-800/50 opacity-60'}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-zinc-200">{ch.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${ch.isEnabled ? 'bg-green-900/30 text-green-400' : 'bg-zinc-800 text-zinc-500'}`}>
                      {ch.isEnabled ? 'enabled' : 'disabled'}
                    </span>
                    {ch.hasSecret && (
                      <span className="text-xs bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded">signed</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-600 font-mono mt-0.5 truncate" title={ch.url}>{ch.url}</p>
                  <p className="text-xs text-zinc-700 mt-0.5">
                    {ch.events.length === 0 ? 'all events' : ch.events.join(', ')}
                  </p>
                  {ch.lastDeliveryAt && (
                    <p className={`text-xs mt-0.5 ${ch.lastDeliveryStatus === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
                      Last: {ch.lastDeliveryStatus} {timeAgo(ch.lastDeliveryAt)}
                      {ch.failureCount > 0 && ` · ${ch.failureCount} failure${ch.failureCount !== 1 ? 's' : ''}`}
                    </p>
                  )}
                  {testResult[ch.id] && (
                    <p className={`text-xs mt-1 ${testResult[ch.id].startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                      {testResult[ch.id]}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => handleTest(ch.id)}
                    disabled={testing === ch.id}
                    className="px-2 py-1 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                    title="Send a test event"
                  >
                    {testing === ch.id ? '…' : 'Test'}
                  </button>
                  <button
                    onClick={() => handleToggle(ch)}
                    disabled={togglingId === ch.id}
                    className="px-2 py-1 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                  >
                    {ch.isEnabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => handleDelete(ch.id)}
                    className="px-2 py-1 text-xs rounded-lg bg-zinc-800 hover:bg-red-900/40 text-zinc-500 hover:text-red-400 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
