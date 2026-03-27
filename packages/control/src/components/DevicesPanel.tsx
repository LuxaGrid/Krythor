import { useState, useEffect, useCallback } from 'react';
import { listDevices, approveDevice, denyDevice, removeDevice, updateDeviceLabel, listNodes } from '../api.ts';
import type { PairedDevice, ConnectedNode } from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

// ─── DevicesPanel ─────────────────────────────────────────────────────────────
//
// Shows all paired + pending devices. Lets the owner approve, deny, remove,
// or rename devices. Pending devices show a prominent approval prompt.
//

function fmtTime(ts: number | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function statusBadge(status: PairedDevice['status']): React.ReactNode {
  switch (status) {
    case 'approved':
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-800/30">approved</span>;
    case 'pending':
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-800/30 animate-pulse">pending</span>;
    case 'denied':
      return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800/30">denied</span>;
    default:
      return null;
  }
}

// ── Edit label modal ──────────────────────────────────────────────────────────

function LabelEditor({
  device,
  onSave,
  onClose,
}: {
  device: PairedDevice;
  onSave: (label: string) => Promise<void>;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(device.label ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      await onSave(label.trim());
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-5 w-80 flex flex-col gap-3">
        <p className="text-xs font-semibold text-zinc-300">Rename device</p>
        <p className="text-[11px] text-zinc-500 font-mono break-all">{device.deviceId}</p>
        <input
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-blue-500"
          placeholder="Label (optional)"
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onClose(); }}
          autoFocus
        />
        {err && <p className="text-[11px] text-red-400">{err}</p>}
        <div className="flex gap-2 justify-end">
          <button
            className="text-xs px-3 py-1 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            onClick={onClose}
          >Cancel</button>
          <button
            className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
            onClick={save}
            disabled={saving}
          >{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Device row ────────────────────────────────────────────────────────────────

function DeviceRow({
  device,
  isLive,
  onApprove,
  onDeny,
  onRemove,
  onRename,
}: {
  device: PairedDevice;
  isLive: boolean;
  onApprove: () => void;
  onDeny: () => void;
  onRemove: () => void;
  onRename: () => void;
}) {
  const displayName = device.label ?? device.deviceFamily ?? device.deviceId;

  return (
    <div className={`rounded-lg border p-3 flex flex-col gap-2 ${device.status === 'pending' ? 'border-amber-700/50 bg-amber-950/10' : 'border-zinc-800 bg-zinc-900/50'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-200 truncate">{displayName}</span>
            {statusBadge(device.status)}
            {isLive && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 border border-blue-800/30">live</span>
            )}
          </div>
          <span className="text-[10px] text-zinc-600 font-mono truncate">{device.deviceId}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {device.status === 'approved' && (
            <button
              className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              onClick={onRename}
              title="Rename"
            >rename</button>
          )}
          {device.status === 'pending' && (
            <>
              <button
                className="text-[10px] px-2 py-0.5 rounded bg-emerald-700/60 text-emerald-300 hover:bg-emerald-600/60 border border-emerald-700/40"
                onClick={onApprove}
              >Approve</button>
              <button
                className="text-[10px] px-2 py-0.5 rounded bg-red-900/50 text-red-400 hover:bg-red-800/50 border border-red-800/40"
                onClick={onDeny}
              >Deny</button>
            </>
          )}
          {device.status === 'denied' && (
            <button
              className="text-[10px] px-2 py-0.5 rounded bg-emerald-700/60 text-emerald-300 hover:bg-emerald-600/60 border border-emerald-700/40"
              onClick={onApprove}
            >Approve</button>
          )}
          <button
            className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-500 hover:bg-red-900/40 hover:text-red-400"
            onClick={onRemove}
            title="Remove / forget"
          >remove</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        <span className="text-[10px] text-zinc-500">platform: <span className="text-zinc-400">{device.platform}</span></span>
        <span className="text-[10px] text-zinc-500">role: <span className="text-zinc-400">{device.role}</span></span>
        {device.caps && device.caps.length > 0 && (
          <span className="text-[10px] text-zinc-500">caps: <span className="text-zinc-400">{device.caps.join(', ')}</span></span>
        )}
        <span className="text-[10px] text-zinc-500">requested: <span className="text-zinc-400">{fmtTime(device.requestedAt)}</span></span>
        {device.approvedAt && (
          <span className="text-[10px] text-zinc-500">approved: <span className="text-zinc-400">{fmtTime(device.approvedAt)}</span></span>
        )}
        <span className="text-[10px] text-zinc-500">last seen: <span className="text-zinc-400">{fmtTime(device.lastSeenAt)}</span></span>
      </div>
    </div>
  );
}

// ── DevicesPanel ──────────────────────────────────────────────────────────────

export function DevicesPanel() {
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [nodes, setNodes] = useState<ConnectedNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [renaming, setRenaming] = useState<PairedDevice | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'denied'>('all');

  const load = useCallback(async () => {
    try {
      const [devRes, nodeRes] = await Promise.allSettled([listDevices(), listNodes()]);
      if (devRes.status === 'fulfilled') setDevices(devRes.value.devices);
      if (nodeRes.status === 'fulfilled') setNodes(nodeRes.value.nodes);
      setErr('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh every 10 s to pick up new pairing requests
  useEffect(() => {
    const t = setInterval(() => { void load(); }, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const handleApprove = async (id: string) => {
    try {
      await approveDevice(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeny = async (id: string) => {
    try {
      await denyDevice(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeDevice(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRename = async (id: string, label: string) => {
    await updateDeviceLabel(id, label);
    await load();
  };

  const connectedNodeIds = new Set(nodes.map(n => n.deviceId));
  const filtered = devices.filter(d => filter === 'all' || d.status === filter);
  const pendingCount = devices.filter(d => d.status === 'pending').length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PanelHeader
        title="Devices"
        description={`${devices.length} device${devices.length !== 1 ? 's' : ''} registered${pendingCount > 0 ? ` · ${pendingCount} pending approval` : ''}`}
        actions={
          <button
            className="text-xs px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            onClick={() => { setLoading(true); void load(); }}
          >Refresh</button>
        }
      />

      {pendingCount > 0 && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-amber-950/20 border border-amber-700/40 text-xs text-amber-400 flex items-center gap-2">
          <span className="text-base">⚠</span>
          <span>{pendingCount} device{pendingCount !== 1 ? 's' : ''} awaiting approval</span>
        </div>
      )}

      <div className="flex gap-1 px-3 pt-2">
        {(['all', 'pending', 'approved', 'denied'] as const).map(f => (
          <button
            key={f}
            className={`text-[11px] px-2.5 py-0.5 rounded capitalize ${filter === f ? 'bg-zinc-700 text-zinc-200' : 'bg-zinc-800/60 text-zinc-500 hover:text-zinc-300'}`}
            onClick={() => setFilter(f)}
          >{f}{f === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
        {loading && <p className="text-xs text-zinc-500 text-center pt-6">Loading…</p>}
        {!loading && err && <p className="text-xs text-red-400">{err}</p>}
        {!loading && !err && filtered.length === 0 && (
          <p className="text-xs text-zinc-600 text-center pt-6">
            {filter === 'all' ? 'No devices registered yet.' : `No ${filter} devices.`}
          </p>
        )}
        {filtered.map(d => (
          <DeviceRow
            key={d.deviceId}
            device={d}
            isLive={connectedNodeIds.has(d.deviceId)}
            onApprove={() => void handleApprove(d.deviceId)}
            onDeny={() => void handleDeny(d.deviceId)}
            onRemove={() => void handleRemove(d.deviceId)}
            onRename={() => setRenaming(d)}
          />
        ))}
      </div>

      {renaming && (
        <LabelEditor
          device={renaming}
          onSave={(label) => handleRename(renaming.deviceId, label)}
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  );
}
