import { useState, useEffect, useCallback, useRef } from 'react';
import {
  updateChatChannel,
  listPendingPairings,
  approvePairing,
  denyPairing,
  listAllowlist,
  addToAllowlist,
  removeFromAllowlist,
  listGroupAllowlist,
  addGroupToAllowlist,
  removeGroupFromAllowlist,
  type GroupEntry,
} from '../api.ts';

// ── Types ──────────────────────────────────────────────────────────────────

interface PendingRequest {
  code: string;
  senderId: string;
  senderName?: string;
  requestedAt: number;
  expiresAt: number;
  channel: string;
}

interface ChannelPolicyPanelProps {
  channelId: string;
  channelType: string;
  dmPolicy?: string;
  groupPolicy?: string;
  onPolicyChange: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const SUPPORTS_DM_POLICY    = ['telegram', 'discord', 'whatsapp'];
const SUPPORTS_GROUP_POLICY = ['telegram', 'discord'];

function relativeTime(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function countdownText(expiresAt: number): string {
  const secs = Math.floor((expiresAt - Date.now()) / 1000);
  if (secs <= 0)   return 'expired';
  if (secs < 60)   return `expires in ${secs}s`;
  if (secs < 3600) return `expires in ${Math.floor(secs / 60)}m`;
  return `expires in ${Math.floor(secs / 3600)}h`;
}

// ── Policy button row ──────────────────────────────────────────────────────

interface PolicyButtonRowProps<T extends string> {
  options: T[];
  value: T | undefined;
  onChange: (v: T) => void;
  saving: boolean;
  saved: boolean;
}

function PolicyButtonRow<T extends string>({
  options,
  value,
  onChange,
  saving,
  saved,
}: PolicyButtonRowProps<T>) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          disabled={saving}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border
            ${value === opt
              ? 'bg-brand-600 border-brand-600 text-white'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
            }
            disabled:opacity-50`}
        >
          {opt}
        </button>
      ))}
      {saved && (
        <span className="text-[10px] text-emerald-400 ml-1">Saved</span>
      )}
    </div>
  );
}

const DM_HELPER: Record<string, string> = {
  pairing:  'Unknown senders get a code — you approve access',
  allowlist: 'Only senders you\'ve added can message',
  open:     'Anyone can message the bot',
  disabled: 'Ignore all DMs',
};

const GROUP_HELPER: Record<string, string> = {
  open:      'All groups/servers can message',
  allowlist: 'Only allowed groups',
  disabled:  'Ignore all group messages',
};

// ── Pending pairing section ────────────────────────────────────────────────

function PendingPairingsSection({ channelId, dmPolicy }: { channelId: string; dmPolicy?: string }) {
  const [requests, setRequests]   = useState<PendingRequest[]>([]);
  const [loading, setLoading]     = useState(false);
  const [toasts, setToasts]       = useState<Record<string, string>>({});
  const intervalRef               = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      const { pending } = await listPendingPairings(channelId);
      setRequests(pending);
    } catch { /* ignore */ }
  }, [channelId]);

  useEffect(() => {
    if (dmPolicy !== 'pairing') return;
    setLoading(true);
    void loadRequests().finally(() => setLoading(false));
    intervalRef.current = setInterval(() => void loadRequests(), 5_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [dmPolicy, loadRequests]);

  const showToast = (code: string, msg: string) => {
    setToasts(prev => ({ ...prev, [code]: msg }));
    setTimeout(() => setToasts(prev => { const n = { ...prev }; delete n[code]; return n; }), 2500);
  };

  const handleApprove = async (req: PendingRequest) => {
    try {
      await approvePairing(channelId, req.code);
      setRequests(prev => prev.filter(r => r.code !== req.code));
      showToast(req.code, 'Approved');
    } catch { /* ignore */ }
  };

  const handleDeny = async (req: PendingRequest) => {
    try {
      await denyPairing(channelId, req.code);
      setRequests(prev => prev.filter(r => r.code !== req.code));
    } catch { /* ignore */ }
  };

  if (dmPolicy !== 'pairing') return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-300">Pending Access Requests</p>
      {loading && requests.length === 0 ? (
        <p className="text-xs text-zinc-600">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="text-xs text-zinc-600 bg-zinc-800/50 rounded-lg px-3 py-2">No pending requests</p>
      ) : (
        <div className="space-y-1.5">
          {requests.map(req => (
            <div
              key={req.code}
              className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <span className="text-xs text-zinc-200 font-medium truncate block">
                  {req.senderName ? `${req.senderName} (${req.senderId})` : req.senderId}
                </span>
                <span className="text-[10px] text-zinc-600">
                  {relativeTime(req.requestedAt)} · {countdownText(req.expiresAt)}
                </span>
              </div>
              {toasts[req.code] ? (
                <span className="text-[10px] text-emerald-400 shrink-0">{toasts[req.code]}</span>
              ) : (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => void handleApprove(req)}
                    className="px-2 py-1 text-[10px] rounded bg-emerald-900/40 hover:bg-emerald-900/70 text-emerald-400 border border-emerald-700/40 transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => void handleDeny(req)}
                    className="px-2 py-1 text-[10px] rounded bg-red-900/30 hover:bg-red-900/60 text-red-400 border border-red-700/40 transition-colors"
                  >
                    Deny
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Allowlist section ──────────────────────────────────────────────────────

function AllowlistSection({ channelId, dmPolicy }: { channelId: string; dmPolicy?: string }) {
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [input, setInput]         = useState('');
  const [adding, setAdding]       = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);

  const loadAllowlist = useCallback(async () => {
    try {
      const { allowlist: al } = await listAllowlist(channelId);
      setAllowlist(al);
    } catch { /* ignore */ }
  }, [channelId]);

  useEffect(() => {
    if (dmPolicy === 'allowlist' || dmPolicy === 'pairing') {
      void loadAllowlist();
    }
  }, [dmPolicy, loadAllowlist]);

  if (dmPolicy !== 'allowlist' && dmPolicy !== 'pairing') return null;

  const handleAdd = async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setInputError('Sender ID cannot be empty.');
      return;
    }
    setInputError(null);
    setAdding(true);
    try {
      await addToAllowlist(channelId, trimmed);
      setAllowlist(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
      setInput('');
    } catch { /* ignore */ }
    finally { setAdding(false); }
  };

  const handleRemove = async (senderId: string) => {
    try {
      await removeFromAllowlist(channelId, senderId);
      setAllowlist(prev => prev.filter(s => s !== senderId));
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-300">Approved Senders</p>
      {allowlist.length === 0 ? (
        <p className="text-xs text-zinc-600 bg-zinc-800/50 rounded-lg px-3 py-2">No senders in allowlist</p>
      ) : (
        <div className="space-y-1">
          {allowlist.map(id => (
            <div
              key={id}
              className="flex items-center gap-2 bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-1.5"
            >
              <span className="flex-1 text-xs text-zinc-300 font-mono truncate">{id}</span>
              <button
                onClick={() => void handleRemove(id)}
                className="text-zinc-600 hover:text-red-400 text-sm leading-none transition-colors px-0.5"
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-start">
        <div className="flex-1 flex flex-col gap-1">
          <input
            value={input}
            onChange={e => { setInput(e.target.value); setInputError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') void handleAdd(); }}
            placeholder="Sender ID"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors"
          />
          {inputError && <p className="text-[10px] text-red-400">{inputError}</p>}
        </div>
        <button
          onClick={() => void handleAdd()}
          disabled={adding}
          className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors shrink-0"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Group allowlist section ────────────────────────────────────────────────

function GroupAllowlistSection({ channelId, groupPolicy }: { channelId: string; groupPolicy?: string }) {
  const [groups, setGroups]         = useState<GroupEntry[]>([]);
  const [input, setInput]           = useState('');
  const [requireMention, setRequireMention] = useState(false);
  const [adding, setAdding]         = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { groups: g } = await listGroupAllowlist(channelId);
      setGroups(g);
    } catch { /* ignore */ }
  }, [channelId]);

  useEffect(() => {
    if (groupPolicy === 'allowlist') void load();
  }, [groupPolicy, load]);

  if (groupPolicy !== 'allowlist') return null;

  const handleAdd = async () => {
    const trimmed = input.trim();
    if (!trimmed) { setInputError('Group ID cannot be empty.'); return; }
    setInputError(null);
    setAdding(true);
    try {
      await addGroupToAllowlist(channelId, trimmed, requireMention);
      setGroups(prev => {
        const exists = prev.find(g => g.groupId === trimmed);
        if (exists) return prev.map(g => g.groupId === trimmed ? { ...g, requireMention } : g);
        return [...prev, { groupId: trimmed, requireMention }];
      });
      setInput('');
      setRequireMention(false);
    } catch { /* ignore */ }
    finally { setAdding(false); }
  };

  const handleRemove = async (groupId: string) => {
    try {
      await removeGroupFromAllowlist(channelId, groupId);
      setGroups(prev => prev.filter(g => g.groupId !== groupId));
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-300">Allowed Groups</p>
      {groups.length === 0 ? (
        <p className="text-xs text-zinc-600 bg-zinc-800/50 rounded-lg px-3 py-2">No groups allowed — add a group ID below</p>
      ) : (
        <div className="space-y-1">
          {groups.map(g => (
            <div key={g.groupId} className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg px-3 py-1.5">
              <div className="flex-1 min-w-0">
                <span className="text-xs text-zinc-200 font-mono truncate block">{g.groupId}</span>
                {g.requireMention && <span className="text-[10px] text-zinc-500">require @mention</span>}
              </div>
              <button
                onClick={() => void handleRemove(g.groupId)}
                className="text-[10px] px-2 py-0.5 rounded bg-zinc-700 text-zinc-500 hover:bg-red-900/40 hover:text-red-400 shrink-0"
              >remove</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-start flex-wrap">
        <input
          className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 transition-colors"
          placeholder="Group / channel ID (e.g. -1001234567890)"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void handleAdd(); }}
        />
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 whitespace-nowrap">
          <input
            type="checkbox"
            checked={requireMention}
            onChange={e => setRequireMention(e.target.checked)}
            className="accent-brand-600"
          />
          @mention
        </label>
        <button
          onClick={() => void handleAdd()}
          disabled={adding}
          className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors shrink-0"
        >Add</button>
      </div>
      {inputError && <p className="text-[10px] text-red-400">{inputError}</p>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function ChannelPolicyPanel({
  channelId,
  channelType,
  dmPolicy,
  groupPolicy,
  onPolicyChange,
}: ChannelPolicyPanelProps) {
  const type = channelType.toLowerCase();
  const hasDmPolicy    = SUPPORTS_DM_POLICY.includes(type);
  const hasGroupPolicy = SUPPORTS_GROUP_POLICY.includes(type);

  const [currentDmPolicy, setCurrentDmPolicy]       = useState<string | undefined>(dmPolicy);
  const [currentGroupPolicy, setCurrentGroupPolicy] = useState<string | undefined>(groupPolicy);
  const [dmSaving, setDmSaving]                     = useState(false);
  const [dmSaved, setDmSaved]                       = useState(false);
  const [groupSaving, setGroupSaving]               = useState(false);
  const [groupSaved, setGroupSaved]                 = useState(false);

  useEffect(() => { setCurrentDmPolicy(dmPolicy); }, [dmPolicy]);
  useEffect(() => { setCurrentGroupPolicy(groupPolicy); }, [groupPolicy]);

  const handleDmPolicyChange = async (value: string) => {
    setCurrentDmPolicy(value);
    setDmSaving(true);
    setDmSaved(false);
    try {
      await updateChatChannel(channelId, { dmPolicy: value as 'pairing' | 'allowlist' | 'open' | 'disabled' });
      setDmSaved(true);
      onPolicyChange();
      setTimeout(() => setDmSaved(false), 2500);
    } catch { /* ignore */ }
    finally { setDmSaving(false); }
  };

  const handleGroupPolicyChange = async (value: string) => {
    setCurrentGroupPolicy(value);
    setGroupSaving(true);
    setGroupSaved(false);
    try {
      await updateChatChannel(channelId, { groupPolicy: value as 'open' | 'allowlist' | 'disabled' });
      setGroupSaved(true);
      onPolicyChange();
      setTimeout(() => setGroupSaved(false), 2500);
    } catch { /* ignore */ }
    finally { setGroupSaving(false); }
  };

  if (!hasDmPolicy && !hasGroupPolicy) return null;

  return (
    <div className="border-t border-zinc-800 mt-3 pt-3 space-y-4">
      {hasDmPolicy && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400">DM Policy</p>
          <PolicyButtonRow
            options={['pairing', 'allowlist', 'open', 'disabled'] as const}
            value={currentDmPolicy as 'pairing' | 'allowlist' | 'open' | 'disabled' | undefined}
            onChange={(v) => void handleDmPolicyChange(v)}
            saving={dmSaving}
            saved={dmSaved}
          />
          {currentDmPolicy && DM_HELPER[currentDmPolicy] && (
            <p className="text-[10px] text-zinc-600">{DM_HELPER[currentDmPolicy]}</p>
          )}
        </div>
      )}

      {hasGroupPolicy && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-400">Group Policy</p>
          <PolicyButtonRow
            options={['open', 'allowlist', 'disabled'] as const}
            value={currentGroupPolicy as 'open' | 'allowlist' | 'disabled' | undefined}
            onChange={(v) => void handleGroupPolicyChange(v)}
            saving={groupSaving}
            saved={groupSaved}
          />
          {currentGroupPolicy && GROUP_HELPER[currentGroupPolicy] && (
            <p className="text-[10px] text-zinc-600">{GROUP_HELPER[currentGroupPolicy]}</p>
          )}
        </div>
      )}

      <PendingPairingsSection channelId={channelId} dmPolicy={currentDmPolicy} />
      <AllowlistSection channelId={channelId} dmPolicy={currentDmPolicy} />
      <GroupAllowlistSection channelId={channelId} groupPolicy={currentGroupPolicy} />
    </div>
  );
}
