import { useState, useEffect, useCallback } from 'react';
import {
  listPeers,
  createPeer,
  updatePeer,
  deletePeer,
  probePeer,
  type GatewayPeer,
} from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

// ─── PeersPanel ───────────────────────────────────────────────────────────────
//
// Manage gateway peer connections — other Krythor instances on the LAN
// or internet. Supports manual registration, health probing, and mDNS
// auto-discovered peers (read-only, shown with source badge).
//

function healthBadge(peer: GatewayPeer): React.ReactNode {
  if (peer.healthy === true) {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-800/30">
      {peer.latencyMs != null ? `${peer.latencyMs}ms` : 'healthy'}
    </span>;
  }
  if (peer.healthy === false) {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800/30">unreachable</span>;
  }
  return <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-600">unprobed</span>;
}

function sourceBadge(source: GatewayPeer['source']): React.ReactNode {
  if (source === 'mdns') {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-500 border border-blue-800/30">mDNS</span>;
  }
  if (source === 'auto') {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-500 border border-purple-800/30">auto</span>;
  }
  return null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─── Add peer form ────────────────────────────────────────────────────────────

interface AddFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

function AddForm({ onCreated, onCancel }: AddFormProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) { setError('Name and URL are required.'); return; }
    setSaving(true);
    setError('');
    try {
      const parsedTags: Record<string, string> = {};
      for (const line of tags.split('\n')) {
        const idx = line.indexOf(':');
        if (idx > 0) parsedTags[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
      await createPeer({
        name: name.trim(),
        url: url.trim(),
        ...(authToken.trim() && { authToken: authToken.trim() }),
        ...(Object.keys(parsedTags).length > 0 && { tags: parsedTags }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const cls = 'bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600';

  return (
    <form onSubmit={handleSubmit} className="border border-zinc-700 rounded-lg p-4 space-y-3 bg-zinc-900/60">
      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Add Peer Gateway</div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-zinc-600">Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Home server" className={cls} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-zinc-600">URL *</label>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="http://192.168.1.10:47200" className={cls} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-zinc-600">Auth token (optional)</label>
        <input type="password" value={authToken} onChange={e => setAuthToken(e.target.value)} placeholder="Bearer token for the remote gateway" className={cls} />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-zinc-600">Tags — key: value, one per line (optional)</label>
        <textarea
          value={tags}
          onChange={e => setTags(e.target.value)}
          placeholder={"environment: prod\nregion: us-east\nowner: ops"}
          rows={3}
          className={`${cls} resize-none`}
        />
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="px-4 py-1.5 bg-brand-700 hover:bg-brand-600 disabled:opacity-40 text-white text-xs rounded transition-colors">
          {saving ? 'Adding…' : 'Add Peer'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded transition-colors">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Peer row ──────────────────────────────────────────────────────────────────

function PeerRow({
  peer,
  onToggle,
  onProbe,
  onDelete,
  probing,
  toggling,
  deleting,
}: {
  peer: GatewayPeer;
  onToggle: () => void;
  onProbe: () => void;
  onDelete: () => void;
  probing: boolean;
  toggling: boolean;
  deleting: boolean;
}) {
  const isManual = peer.source === 'manual';

  return (
    <div className={`border rounded-lg p-3 flex flex-col gap-2 ${peer.isEnabled ? 'border-zinc-700 bg-zinc-900/40' : 'border-zinc-800 bg-zinc-950/40 opacity-60'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-zinc-200">{peer.name}</span>
            {healthBadge(peer)}
            {sourceBadge(peer.source)}
            {!peer.isEnabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-600">disabled</span>
            )}
          </div>
          <span className="text-[10px] text-zinc-500 font-mono truncate">{peer.url}</span>
          {peer.gatewayId && (
            <span className="text-[10px] text-zinc-600 font-mono truncate">id: {peer.gatewayId}</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onProbe}
            disabled={probing}
            title="Health check"
            className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-40"
          >{probing ? '…' : 'Probe'}</button>
          {isManual && (
            <>
              <button
                onClick={onToggle}
                disabled={toggling}
                className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 disabled:opacity-40"
              >{toggling ? '…' : peer.isEnabled ? 'Disable' : 'Enable'}</button>
              <button
                onClick={onDelete}
                disabled={deleting}
                title="Remove peer"
                className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-500 hover:bg-red-900/40 hover:text-red-400 disabled:opacity-40"
              >{deleting ? '…' : 'Remove'}</button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px]">
        {peer.version && <span className="text-zinc-600">v<span className="text-zinc-400">{peer.version}</span></span>}
        {peer.platform && <span className="text-zinc-600">platform: <span className="text-zinc-400">{peer.platform}</span></span>}
        {peer.capabilities && peer.capabilities.length > 0 && (
          <span className="text-zinc-600">caps: <span className="text-zinc-400">{peer.capabilities.slice(0, 5).join(', ')}{peer.capabilities.length > 5 ? '…' : ''}</span></span>
        )}
        {peer.lastSeenAt && <span className="text-zinc-600">seen: <span className="text-zinc-400">{timeAgo(peer.lastSeenAt)}</span></span>}
        {peer.lastHealthAt && <span className="text-zinc-600">checked: <span className="text-zinc-400">{timeAgo(peer.lastHealthAt)}</span></span>}
        {peer.authToken && <span className="text-zinc-600">auth: <span className="text-zinc-400">{peer.authToken}</span></span>}
      </div>

      {peer.tags && Object.keys(peer.tags).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(peer.tags).map(([k, v]) => (
            <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
              {k}: {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function PeersPanel() {
  const [peers, setPeers] = useState<GatewayPeer[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPeers();
      setPeers(Array.isArray(data.peers) ? data.peers : []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleProbe = async (id: string) => {
    setProbingId(id);
    try {
      const result = await probePeer(id);
      setPeers(prev => prev.map(p => p.id === id ? {
        ...p,
        healthy: result.healthy,
        latencyMs: result.latencyMs,
        lastHealthAt: new Date().toISOString(),
      } : p));
    } catch { /* ignore */ }
    finally { setProbingId(null); }
  };

  const handleToggle = async (peer: GatewayPeer) => {
    setTogglingId(peer.id);
    try {
      const updated = await updatePeer(peer.id, { isEnabled: !peer.isEnabled });
      setPeers(prev => prev.map(p => p.id === peer.id ? { ...p, ...updated } : p));
    } catch { /* ignore */ }
    finally { setTogglingId(null); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this peer?')) return;
    setDeletingId(id);
    try {
      await deletePeer(id);
      setPeers(prev => prev.filter(p => p.id !== id));
    } catch { /* ignore */ }
    finally { setDeletingId(null); }
  };

  const healthyCount = peers.filter(p => p.healthy === true).length;
  const mdnsCount = peers.filter(p => p.source === 'mdns').length;

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Gateway Peers"
        description={`${peers.length} peer${peers.length !== 1 ? 's' : ''}${healthyCount > 0 ? ` · ${healthyCount} healthy` : ''}${mdnsCount > 0 ? ` · ${mdnsCount} mDNS` : ''}`}
        tip="Peers are other Krythor gateway instances. mDNS peers are auto-discovered on your LAN and expire after 5 minutes of silence."
      />

      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
        <button
          onClick={() => setShowAdd(s => !s)}
          className="px-3 py-1.5 bg-brand-700 hover:bg-brand-600 text-white text-xs rounded transition-colors"
        >+ Add Peer</button>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-400 text-xs rounded transition-colors"
        >{loading ? '…' : 'Refresh'}</button>
        {error && <span className="text-xs text-red-400 ml-2">{error}</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {showAdd && (
          <AddForm
            onCreated={() => { setShowAdd(false); void load(); }}
            onCancel={() => setShowAdd(false)}
          />
        )}

        {peers.length === 0 && !loading && !showAdd && (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <span className="text-zinc-600 text-sm">No peers discovered yet</span>
            <span className="text-zinc-700 text-xs">Add a peer manually or wait for mDNS auto-discovery on the LAN</span>
          </div>
        )}

        {peers.map(peer => (
          <PeerRow
            key={peer.id}
            peer={peer}
            onProbe={() => void handleProbe(peer.id)}
            onToggle={() => void handleToggle(peer)}
            onDelete={() => void handleDelete(peer.id)}
            probing={probingId === peer.id}
            toggling={togglingId === peer.id}
            deleting={deletingId === peer.id}
          />
        ))}
      </div>
    </div>
  );
}
