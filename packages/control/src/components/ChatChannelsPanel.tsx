import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listChatChannelProviders,
  listChatChannels,
  saveChatChannel,
  updateChatChannel,
  deleteChatChannel,
  testChatChannel,
  getChatChannelPairingCode,
  type ChatChannelProviderMeta,
  type ChatChannelWithStatus,
  type ChatChannelStatus,
} from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

// ── Constants ──────────────────────────────────────────────────────────────

const INPUT_CLS =
  'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';

const PROVIDER_ICON: Record<string, string> = {
  telegram:  '📨',
  discord:   '💬',
  whatsapp:  '📱',
};

function providerIcon(type: string): string {
  return PROVIDER_ICON[type.toLowerCase()] ?? '🔌';
}

// ── Status badge ───────────────────────────────────────────────────────────

const STATUS_LABEL: Record<ChatChannelStatus, string> = {
  not_installed:     'Not Installed',
  installed:         'Installed',
  credentials_missing: 'Credentials Missing',
  awaiting_pairing:  'Awaiting Pairing',
  connected:         'Connected',
  error:             'Error',
};

const STATUS_CLS: Record<ChatChannelStatus, string> = {
  not_installed:     'bg-zinc-800 text-zinc-500 border-zinc-700',
  installed:         'bg-blue-950/50 text-blue-400 border-blue-700/60',
  credentials_missing: 'bg-amber-950/50 text-amber-400 border-amber-700/60',
  awaiting_pairing:  'bg-amber-950/50 text-amber-400 border-amber-700/60',
  connected:         'bg-emerald-950/50 text-emerald-400 border-emerald-700/60',
  error:             'bg-red-950/50 text-red-400 border-red-700/60',
};

function StatusBadge({ status }: { status: ChatChannelStatus }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${STATUS_CLS[status]}`}>
      {STATUS_LABEL[status]}
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

// ── Format timestamp ───────────────────────────────────────────────────────

function fmtTs(ts: number | undefined): string | null {
  if (!ts) return null;
  return new Date(ts).toLocaleString();
}

// ── Add/Edit modal ─────────────────────────────────────────────────────────

interface ModalState {
  mode: 'add' | 'edit';
  channelId?: string;
  selectedType: string;
  name: string;
  credentials: Record<string, string>;
  agentId: string;
  enabled: boolean;
}

interface AddEditModalProps {
  providers: ChatChannelProviderMeta[];
  initial: ModalState;
  onClose: () => void;
  onSave: (state: ModalState) => Promise<void>;
}

function AddEditModal({ providers, initial, onClose, onSave }: AddEditModalProps) {
  const [state, setState] = useState<ModalState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProvider = providers.find(p => p.type === state.selectedType || p.id === state.selectedType);

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleSave = async () => {
    if (!state.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!state.selectedType) {
      setError('Please select a provider.');
      return;
    }
    // Validate required credential fields
    if (selectedProvider) {
      for (const field of selectedProvider.credentialFields) {
        if (field.required && !state.credentials[field.key]?.trim()) {
          setError(`"${field.label}" is required.`);
          return;
        }
      }
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(state);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[520px] max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">
            {initial.mode === 'add' ? 'Add Chat Channel' : 'Edit Chat Channel'}
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-600 hover:text-zinc-300 text-lg leading-none p-1 transition-colors"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Provider selector — only shown when adding */}
          {initial.mode === 'add' && (
            <div>
              <label className="text-xs text-zinc-500 block mb-1.5">Provider</label>
              <div className="grid grid-cols-3 gap-2">
                {providers.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setState(s => ({ ...s, selectedType: p.type, credentials: {} }))}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs transition-colors
                      ${state.selectedType === p.type
                        ? 'border-brand-600 bg-brand-950/30 text-zinc-100'
                        : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'}`}
                  >
                    <span className="text-xl">{providerIcon(p.type)}</span>
                    <span className="font-medium">{p.displayName}</span>
                  </button>
                ))}
              </div>
              {selectedProvider?.docsUrl && (
                <p className="text-[10px] text-zinc-600 mt-1.5">
                  <a
                    href={selectedProvider.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-zinc-400 transition-colors"
                  >
                    Setup docs
                  </a>
                </p>
              )}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Name</label>
            <input
              value={state.name}
              onChange={e => setState(s => ({ ...s, name: e.target.value }))}
              placeholder="e.g. My Telegram Bot"
              className={INPUT_CLS}
            />
          </div>

          {/* Dynamic credential fields */}
          {selectedProvider && selectedProvider.credentialFields.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500 font-medium">Credentials</p>
              {selectedProvider.credentialFields.map(field => (
                <div key={field.key}>
                  <label className="text-xs text-zinc-500 block mb-1">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  <input
                    type={field.secret ? 'password' : 'text'}
                    value={state.credentials[field.key] ?? ''}
                    onChange={e =>
                      setState(s => ({
                        ...s,
                        credentials: { ...s.credentials, [field.key]: e.target.value },
                      }))
                    }
                    placeholder={'hint' in field ? (field as { hint?: string }).hint ?? '' : ''}
                    className={INPUT_CLS}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Enabled toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setState(s => ({ ...s, enabled: !s.enabled }))}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 transition-colors
                ${state.enabled ? 'border-brand-600 bg-brand-600' : 'border-zinc-600 bg-zinc-700'}`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform mt-px
                  ${state.enabled ? 'translate-x-4' : 'translate-x-0.5'}`}
              />
            </button>
            <span className="text-xs text-zinc-400">Enabled</span>
          </div>

          {error && (
            <p className="text-red-400 text-xs bg-red-950/30 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors flex items-center gap-1.5"
          >
            {saving && <Spinner />}
            {initial.mode === 'add' ? 'Add Channel' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Channel card ───────────────────────────────────────────────────────────

interface ChannelCardProps {
  channel: ChatChannelWithStatus;
  onEdit: (ch: ChatChannelWithStatus) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  onGetPairingCode: (id: string) => void;
  testResult: { ok: boolean; message: string } | null;
  testLoading: boolean;
  pairingCode: string | null;
  pairingLoading: boolean;
  deleteConfirm: boolean;
  onDeleteConfirmSet: (id: string | null) => void;
}

function ChannelCard({
  channel,
  onEdit,
  onDelete,
  onTest,
  onGetPairingCode,
  testResult,
  testLoading,
  pairingCode,
  pairingLoading,
  deleteConfirm,
  onDeleteConfirmSet,
}: ChannelCardProps) {
  const meta = channel.providerMeta;
  const isWhatsApp =
    channel.type.toLowerCase() === 'whatsapp' ||
    (meta?.type ?? '').toLowerCase() === 'whatsapp';

  return (
    <div className="border border-zinc-800 rounded-xl bg-zinc-900/60 p-4 space-y-3">
      {/* Top row */}
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none mt-0.5">
          {providerIcon(meta?.type ?? channel.type)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-zinc-100 truncate">
              {channel.displayName ?? channel.type}
            </span>
            <StatusBadge status={channel.status} />
            {!channel.enabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-zinc-800 text-zinc-600 border-zinc-700">
                disabled
              </span>
            )}
          </div>
          {channel.lastHealthCheck && (
            <p className="text-[11px] text-zinc-600 mt-0.5">
              Last check: {fmtTs(channel.lastHealthCheck)}
              {channel.lastError && (
                <span className="text-red-500 ml-2">{channel.lastError}</span>
              )}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onTest(channel.id)}
            disabled={testLoading}
            className="px-2 py-1 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1"
            title="Test connection"
          >
            {testLoading ? <Spinner /> : 'Test'}
          </button>
          <button
            onClick={() => onEdit(channel)}
            className="px-2 py-1 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Edit
          </button>
          {deleteConfirm ? (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => onDelete(channel.id)}
                className="text-red-400 hover:text-red-300 text-xs px-1.5 py-1 rounded bg-red-950/40 transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => onDeleteConfirmSet(null)}
                className="text-zinc-500 hover:text-zinc-300 text-xs px-1 py-1 transition-colors"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              onClick={() => onDeleteConfirmSet(channel.id)}
              className="px-2 py-1 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-red-400 transition-colors"
              title="Delete channel"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <p
          className={`text-xs rounded-lg px-3 py-2 ${
            testResult.ok
              ? 'bg-emerald-950/30 text-emerald-400'
              : 'bg-red-950/30 text-red-400'
          }`}
        >
          {testResult.ok ? '✓ ' : '✗ '}
          {testResult.message}
        </p>
      )}

      {/* Pairing code button (WhatsApp + awaiting_pairing) */}
      {isWhatsApp && channel.status === 'awaiting_pairing' && (
        <div className="space-y-2">
          <button
            onClick={() => onGetPairingCode(channel.id)}
            disabled={pairingLoading}
            className="text-xs px-3 py-1.5 rounded-lg bg-amber-900/30 hover:bg-amber-900/50 text-amber-400 border border-amber-700/40 transition-colors flex items-center gap-1.5"
          >
            {pairingLoading ? <Spinner /> : null}
            Get Pairing Code
          </button>
          {pairingCode && (
            <div className="bg-zinc-800 rounded-lg px-3 py-2 flex items-center gap-3">
              <span className="text-zinc-500 text-xs">Pairing code:</span>
              <span className="font-mono text-sm text-zinc-100 tracking-widest">{pairingCode}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Empty state with provider cards ───────────────────────────────────────

interface EmptyStateProps {
  providers: ChatChannelProviderMeta[];
  onAddForProvider: (type: string) => void;
}

function EmptyStateProviders({ providers, onAddForProvider }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 py-12">
      <div className="text-center">
        <p className="text-zinc-400 text-sm font-medium">No chat channels configured</p>
        <p className="text-zinc-600 text-xs mt-1">Connect a bot to let users chat through Telegram, Discord, or WhatsApp.</p>
      </div>
      {providers.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-xl">
          {providers.map(p => (
            <button
              key={p.id}
              onClick={() => onAddForProvider(p.type)}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border border-zinc-700 bg-zinc-800/40 hover:border-zinc-500 hover:bg-zinc-800 text-center transition-colors group"
            >
              <span className="text-3xl">{providerIcon(p.type)}</span>
              <span className="text-xs font-medium text-zinc-300 group-hover:text-zinc-100 transition-colors">
                {p.displayName}
              </span>
              <span className="text-[10px] text-zinc-600 leading-snug">{p.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

export function ChatChannelsPanel() {
  const [providers, setProviders] = useState<ChatChannelProviderMeta[]>([]);
  const [channels, setChannels]   = useState<ChatChannelWithStatus[]>([]);
  const [loading, setLoading]     = useState(true);

  // Modal
  const [modal, setModal] = useState<ModalState | null>(null);

  // Per-channel test state
  const [testLoading, setTestLoading] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  // Per-channel pairing code state
  const [pairingLoading, setPairingLoading] = useState<Record<string, boolean>>({});
  const [pairingCodes, setPairingCodes]     = useState<Record<string, string>>({});

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Auto-refresh interval ref
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ providers: prov }, { channels: ch }] = await Promise.all([
        listChatChannelProviders(),
        listChatChannels(),
      ]);
      setProviders(prov);
      setChannels(ch);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    intervalRef.current = setInterval(() => void load(), 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openAdd = (preselectedType = '') => {
    setModal({
      mode: 'add',
      selectedType: preselectedType,
      name: '',
      credentials: {},
      agentId: '',
      enabled: true,
    });
  };

  const openEdit = (ch: ChatChannelWithStatus) => {
    setModal({
      mode: 'edit',
      channelId: ch.id,
      selectedType: ch.type,
      name: ch.displayName ?? ch.type,
      credentials: { ...ch.credentials },
      agentId: ch.agentId ?? '',
      enabled: ch.enabled,
    });
  };

  const handleSave = async (state: ModalState) => {
    const provider = providers.find(p => p.type === state.selectedType || p.id === state.selectedType);
    if (state.mode === 'add') {
      const saved = await saveChatChannel({
        id: crypto.randomUUID(),
        type: state.selectedType,
        displayName: state.name,
        credentials: state.credentials,
        ...(state.agentId ? { agentId: state.agentId } : {}),
        enabled: state.enabled,
      });
      // Attach providerMeta for immediate display
      setChannels(prev => [
        ...prev,
        { ...saved, status: 'installed' as ChatChannelStatus, providerMeta: provider },
      ]);
    } else if (state.channelId) {
      const updated = await updateChatChannel(state.channelId, {
        displayName: state.name,
        credentials: state.credentials,
        ...(state.agentId ? { agentId: state.agentId } : {}),
        enabled: state.enabled,
      });
      setChannels(prev =>
        prev.map(ch =>
          ch.id === state.channelId
            ? { ...updated, status: ch.status, providerMeta: ch.providerMeta }
            : ch
        )
      );
    }
    // Refresh to get up-to-date status
    void load();
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteChatChannel(id);
      setChannels(prev => prev.filter(ch => ch.id !== id));
    } catch { /* ignore */ }
    setDeleteConfirmId(null);
  };

  const handleTest = async (id: string) => {
    setTestLoading(prev => ({ ...prev, [id]: true }));
    // Clear old result
    setTestResults(prev => { const next = { ...prev }; delete next[id]; return next; });
    try {
      const res = await testChatChannel(id);
      setTestResults(prev => ({
        ...prev,
        [id]: {
          ok: res.ok,
          message: res.ok
            ? `Connection OK (${res.latencyMs}ms)`
            : (res.error ?? 'Test failed'),
        },
      }));
    } catch (err) {
      setTestResults(prev => ({
        ...prev,
        [id]: { ok: false, message: err instanceof Error ? err.message : 'Test failed' },
      }));
    } finally {
      setTestLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleGetPairingCode = async (id: string) => {
    setPairingLoading(prev => ({ ...prev, [id]: true }));
    try {
      const res = await getChatChannelPairingCode(id);
      setPairingCodes(prev => ({ ...prev, [id]: res.code }));
    } catch { /* ignore */ }
    finally {
      setPairingLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Chat Channels"
        description="Inbound bot channels — connect Telegram, Discord, or WhatsApp bots to route conversations to your agents."
        tip="Add a channel by clicking '+ Add Channel'. Each channel maps to a bot token and an agent. Use 'Test' to verify the connection is live."
        actions={
          <button
            onClick={() => openAdd()}
            className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg transition-colors"
          >
            + Add Channel
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="h-24 bg-zinc-800/50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : channels.length === 0 ? (
          <EmptyStateProviders
            providers={providers}
            onAddForProvider={type => openAdd(type)}
          />
        ) : (
          <div className="p-4 space-y-3">
            {channels.map(ch => (
              <ChannelCard
                key={ch.id}
                channel={ch}
                onEdit={openEdit}
                onDelete={handleDelete}
                onTest={handleTest}
                onGetPairingCode={handleGetPairingCode}
                testResult={testResults[ch.id] ?? null}
                testLoading={testLoading[ch.id] ?? false}
                pairingCode={pairingCodes[ch.id] ?? null}
                pairingLoading={pairingLoading[ch.id] ?? false}
                deleteConfirm={deleteConfirmId === ch.id}
                onDeleteConfirmSet={setDeleteConfirmId}
              />
            ))}
          </div>
        )}
      </div>

      {modal && (
        <AddEditModal
          providers={providers}
          initial={modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
