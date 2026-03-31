import { useState, useEffect, useCallback } from 'react';
import {
  getTalentDashboard,
  listTalents,
  getTalent,
  createTalent,
  updateTalent,
  deleteTalent,
  getTalentInteractions,
  addTalentInteraction,
  getTalentOutreach,
  createTalentOutreach,
  updateTalentOutreach,
  getPendingOutreach,
  rankTalent,
  type TalentProfile,
  type TalentInteraction,
  type TalentOutreach,
  type TalentDashboard,
  type RankResult,
} from '../api.ts';

// ── Style constants ───────────────────────────────────────────────────────────

const INPUT_CLS = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';
const SELECT_CLS = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';
const BTN_PRIMARY = 'px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs rounded-lg transition-colors disabled:opacity-40';
const BTN_GHOST   = 'px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg border border-zinc-700 transition-colors';
const BTN_DANGER  = 'px-3 py-1.5 bg-red-800 hover:bg-red-700 text-white text-xs rounded-lg transition-colors';

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function TrustBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-zinc-400">{pct}%</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'active' ? 'bg-green-900/40 text-green-400 border-green-800'
    : status === 'blocked' ? 'bg-red-900/40 text-red-400 border-red-800'
    : 'bg-zinc-800 text-zinc-500 border-zinc-700';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{status}</span>;
}

// ── View types ────────────────────────────────────────────────────────────────

type View = 'dashboard' | 'directory' | 'detail' | 'matcher' | 'outreach-queue' | 'create' | 'edit';

// ── Dashboard View ────────────────────────────────────────────────────────────

function DashboardView({
  onNavigate,
}: {
  onNavigate: (view: View) => void;
}) {
  const [stats, setStats] = useState<TalentDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTalentDashboard();
      setStats(data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="p-6 text-xs text-zinc-500">Loading...</div>;
  if (error)   return <div className="p-6 text-xs text-red-400">{error}</div>;
  if (!stats)  return null;

  const cards = [
    { label: 'Active Profiles',     value: stats.totalActive },
    { label: 'Total Profiles',      value: stats.totalProfiles },
    { label: 'Preferred',           value: stats.preferredCount },
    { label: 'Used Last 30d',       value: stats.recentlyUsedCount },
    { label: 'Contacted Last 90d',  value: stats.recentlyContactedCount },
    { label: 'Pending Outreach',    value: stats.pendingOutreachCount },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Talent Marketplace</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Your private directory of trusted vendors and contacts</p>
        </div>
        <div className="flex gap-2">
          <button className={BTN_GHOST} onClick={() => onNavigate('directory')}>Browse Directory</button>
          <button className={BTN_PRIMARY} onClick={() => onNavigate('matcher')}>Find Talent</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {cards.map(c => (
          <div key={c.label} className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
            <div className="text-2xl font-bold text-zinc-100">{c.value}</div>
            <div className="text-xs text-zinc-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button className={BTN_GHOST} onClick={() => onNavigate('directory')}>Directory</button>
        <button className={BTN_GHOST} onClick={() => onNavigate('outreach-queue')}>Outreach Queue</button>
        <button className={BTN_GHOST} onClick={() => onNavigate('create')}>Add Talent</button>
      </div>
    </div>
  );
}

// ── Directory View ────────────────────────────────────────────────────────────

function DirectoryView({
  onSelect,
  onNavigate,
}: {
  onSelect: (t: TalentProfile) => void;
  onNavigate: (view: View) => void;
}) {
  const [talents, setTalents]     = useState<TalentProfile[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [search, setSearch]       = useState('');
  const [category, setCategory]   = useState('');
  const [state, setState]         = useState('');
  const [status, setStatus]       = useState('');
  const [preferredOnly, setPref]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filter: Record<string, string> = {};
      if (search)       filter['keywords'] = search;
      if (category)     filter['category'] = category;
      if (state)        filter['state'] = state;
      if (status)       filter['status'] = status;
      if (preferredOnly) filter['preferred'] = 'true';
      const data = await listTalents(filter);
      setTalents(data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [search, category, state, status, preferredOnly]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 flex items-center gap-2 flex-wrap">
        <button className={BTN_GHOST} onClick={() => onNavigate('dashboard')}>Back</button>
        <h2 className="text-sm font-semibold text-zinc-200 flex-1">Talent Directory</h2>
        <button className={BTN_PRIMARY} onClick={() => onNavigate('create')}>+ Add</button>
      </div>

      {/* Filters */}
      <div className="p-3 border-b border-zinc-800 flex gap-2 flex-wrap">
        <input
          className={INPUT_CLS + ' max-w-[180px]'}
          placeholder="Search name, tags..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <input className={INPUT_CLS + ' max-w-[120px]'} placeholder="Category" value={category} onChange={e => setCategory(e.target.value)} />
        <input className={INPUT_CLS + ' max-w-[80px]'}  placeholder="State"    value={state}    onChange={e => setState(e.target.value)} />
        <select className={SELECT_CLS + ' max-w-[100px]'} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="blocked">Blocked</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={preferredOnly} onChange={e => setPref(e.target.checked)} className="accent-brand-600" />
          Preferred only
        </label>
      </div>

      {/* List */}
      {loading && <div className="p-6 text-xs text-zinc-500">Loading...</div>}
      {error   && <div className="p-4 text-xs text-red-400">{error}</div>}
      {!loading && !error && (
        <div className="flex-1 overflow-y-auto">
          {talents.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-600">No talent found. Add contacts to get started.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800">
                <tr>
                  <th className="text-left px-4 py-2 text-zinc-500 font-normal">Name</th>
                  <th className="text-left px-4 py-2 text-zinc-500 font-normal">Category</th>
                  <th className="text-left px-4 py-2 text-zinc-500 font-normal">Location</th>
                  <th className="text-left px-4 py-2 text-zinc-500 font-normal">Trust</th>
                  <th className="text-left px-4 py-2 text-zinc-500 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {talents.map(t => (
                  <tr
                    key={t.id}
                    onClick={() => onSelect(t)}
                    className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        {t.preferred && <span className="text-yellow-400 text-[10px]">★</span>}
                        <span className="text-zinc-200 font-medium">{t.displayName}</span>
                        {t.companyName && <span className="text-zinc-500">({t.companyName})</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-zinc-400">{t.category}{t.subcategory ? ` / ${t.subcategory}` : ''}</td>
                    <td className="px-4 py-2 text-zinc-400">{[t.city, t.state].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-4 py-2"><TrustBar score={t.trustScore} /></td>
                    <td className="px-4 py-2"><StatusBadge status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── Detail View ───────────────────────────────────────────────────────────────

function DetailView({
  talentId,
  onBack,
  onEdit,
}: {
  talentId: string;
  onBack: () => void;
  onEdit: (t: TalentProfile) => void;
}) {
  const [talent, setTalent]           = useState<TalentProfile | null>(null);
  const [interactions, setInteractions] = useState<TalentInteraction[]>([]);
  const [outreach, setOutreach]         = useState<TalentOutreach[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [showOutreachForm, setShowOutreachForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, ints, outs] = await Promise.all([
        getTalent(talentId),
        getTalentInteractions(talentId),
        getTalentOutreach(talentId),
      ]);
      setTalent(t);
      setInteractions(ints);
      setOutreach(outs);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [talentId]);

  useEffect(() => { void load(); }, [load]);

  const togglePreferred = async () => {
    if (!talent) return;
    try {
      const updated = await updateTalent(talent.id, { preferred: !talent.preferred });
      setTalent(updated as TalentProfile);
    } catch (e) { console.error(e); }
  };

  const toggleBlock = async () => {
    if (!talent) return;
    const newStatus = talent.status === 'blocked' ? 'active' : 'blocked';
    try {
      const updated = await updateTalent(talent.id, { status: newStatus });
      setTalent(updated as TalentProfile);
    } catch (e) { console.error(e); }
  };

  const deactivate = async () => {
    if (!talent) return;
    try {
      const updated = await updateTalent(talent.id, { status: 'inactive' });
      setTalent(updated as TalentProfile);
    } catch (e) { console.error(e); }
  };

  if (loading) return <div className="p-6 text-xs text-zinc-500">Loading...</div>;
  if (error || !talent) return <div className="p-6 text-xs text-red-400">{error || 'Talent not found'}</div>;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 flex items-center gap-2">
        <button className={BTN_GHOST} onClick={onBack}>Back</button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {talent.preferred && <span className="text-yellow-400">★</span>}
            <h2 className="text-sm font-semibold text-zinc-200">{talent.displayName}</h2>
            {talent.companyName && <span className="text-xs text-zinc-500">{talent.companyName}</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <StatusBadge status={talent.status} />
            <span className="text-xs text-zinc-500">{talent.category}{talent.subcategory ? ` / ${talent.subcategory}` : ''}</span>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button className={BTN_GHOST} onClick={() => onEdit(talent)}>Edit</button>
          <button className={BTN_GHOST} onClick={togglePreferred}>{talent.preferred ? 'Unprefer' : 'Prefer'}</button>
          <button className={BTN_GHOST} onClick={toggleBlock}>{talent.status === 'blocked' ? 'Unblock' : 'Block'}</button>
          {talent.status !== 'inactive' && <button className={BTN_GHOST} onClick={deactivate}>Deactivate</button>}
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* Profile Info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Contact</div>
            {talent.email && <div className="text-xs text-zinc-300">{talent.email}</div>}
            {talent.phone && <div className="text-xs text-zinc-300">{talent.phone}</div>}
            {talent.website && <div className="text-xs text-zinc-300">{talent.website}</div>}
            {!talent.email && !talent.phone && !talent.website && <div className="text-xs text-zinc-600">No contact info</div>}
          </div>
          <div className="space-y-2">
            <div className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Location</div>
            <div className="text-xs text-zinc-300">{[talent.city, talent.state, talent.zip].filter(Boolean).join(', ') || '—'}</div>
            {talent.serviceAreas.length > 0 && (
              <div className="text-xs text-zinc-400">Serves: {talent.serviceAreas.join(', ')}</div>
            )}
          </div>
        </div>

        {/* Trust Score Breakdown */}
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-3 space-y-2">
          <div className="text-xs text-zinc-400 font-medium">Trust Score</div>
          <TrustBar score={talent.trustScore} />
          <div className="grid grid-cols-3 gap-2 text-[10px] text-zinc-500">
            <span>Successful: {talent.successfulJobsCount}</span>
            <span>Declined: {talent.declinedJobsCount}</span>
            <span>No-response: {talent.noResponseCount}</span>
            <span>Response rate: {Math.round(talent.responseRate * 100)}%</span>
            {talent.avgResponseTimeHours !== undefined && (
              <span>Avg response: {talent.avgResponseTimeHours.toFixed(0)}h</span>
            )}
          </div>
        </div>

        {/* Description / Notes */}
        {(talent.description || talent.notes) && (
          <div className="space-y-1">
            {talent.description && <div className="text-xs text-zinc-300">{talent.description}</div>}
            {talent.notes && <div className="text-xs text-zinc-400 italic">{talent.notes}</div>}
          </div>
        )}

        {/* Tags & Specialties */}
        {(talent.tags.length > 0 || talent.specialties.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {talent.tags.map(tag => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-brand-600/20 text-brand-400 rounded border border-brand-600/30">{tag}</span>
            ))}
            {talent.specialties.map(s => (
              <span key={s} className="text-[10px] px-1.5 py-0.5 bg-zinc-700 text-zinc-400 rounded">{s}</span>
            ))}
          </div>
        )}

        {/* Pricing */}
        {(talent.costBand || talent.hourlyRateCents) && (
          <div className="text-xs text-zinc-400">
            {talent.costBand && <span>Cost band: {talent.costBand}</span>}
            {talent.hourlyRateCents && <span> — ${(talent.hourlyRateCents / 100).toFixed(0)}/hr</span>}
          </div>
        )}

        {/* Interactions */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-zinc-400 font-medium">Interactions ({interactions.length})</div>
            <button className={BTN_GHOST + ' text-[10px]'} onClick={() => setShowNoteForm(v => !v)}>
              {showNoteForm ? 'Cancel' : '+ Add Note'}
            </button>
          </div>
          {showNoteForm && (
            <NoteForm talentId={talent.id} onAdded={() => { setShowNoteForm(false); void load(); }} />
          )}
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {interactions.length === 0 && <div className="text-xs text-zinc-600">No interactions yet.</div>}
            {interactions.map(i => (
              <div key={i.id} className="bg-zinc-800 border border-zinc-700/50 rounded-lg p-2">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] text-zinc-500 capitalize">{i.type}</span>
                  {i.outcome && <span className={`text-[10px] px-1 rounded ${i.outcome === 'success' ? 'text-green-400' : i.outcome === 'declined' ? 'text-red-400' : 'text-zinc-500'}`}>{i.outcome}</span>}
                  <span className="text-[10px] text-zinc-600 ml-auto">{timeAgo(i.createdAt)}</span>
                </div>
                <div className="text-xs text-zinc-300">{i.content}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Outreach */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-zinc-400 font-medium">Outreach ({outreach.length})</div>
            <button className={BTN_GHOST + ' text-[10px]'} onClick={() => setShowOutreachForm(v => !v)}>
              {showOutreachForm ? 'Cancel' : '+ Request Outreach'}
            </button>
          </div>
          {showOutreachForm && (
            <OutreachForm talentId={talent.id} onAdded={() => { setShowOutreachForm(false); void load(); }} />
          )}
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {outreach.length === 0 && <div className="text-xs text-zinc-600">No outreach records.</div>}
            {outreach.map(o => (
              <div key={o.id} className="bg-zinc-800 border border-zinc-700/50 rounded-lg p-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1 rounded border ${o.status === 'sent' ? 'text-green-400 border-green-800' : o.status === 'denied' ? 'text-red-400 border-red-800' : 'text-zinc-400 border-zinc-700'}`}>{o.status}</span>
                  {o.channel && <span className="text-[10px] text-zinc-500">{o.channel}</span>}
                  <span className="text-[10px] text-zinc-600 ml-auto">{timeAgo(o.createdAt)}</span>
                </div>
                <div className="text-xs text-zinc-400 mt-0.5 truncate">{o.messagePreview}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Note Form ─────────────────────────────────────────────────────────────────

function NoteForm({ talentId, onAdded }: { talentId: string; onAdded: () => void }) {
  const [type, setType]       = useState('note');
  const [content, setContent] = useState('');
  const [outcome, setOutcome] = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const submit = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await addTalentInteraction(talentId, {
        talentId,
        type,
        content: content.trim(),
        outcome: outcome || undefined,
      });
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setSaving(false);
    }
  };

  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 space-y-2">
      <div className="flex gap-2">
        <select className={SELECT_CLS} value={type} onChange={e => setType(e.target.value)}>
          <option value="note">Note</option>
          <option value="outcome">Outcome</option>
          <option value="outreach">Outreach</option>
          <option value="availability_request">Availability Request</option>
        </select>
        <select className={SELECT_CLS} value={outcome} onChange={e => setOutcome(e.target.value)}>
          <option value="">No outcome</option>
          <option value="success">Success</option>
          <option value="declined">Declined</option>
          <option value="no_response">No Response</option>
          <option value="pending">Pending</option>
        </select>
      </div>
      <textarea
        className={INPUT_CLS + ' h-16 resize-none'}
        placeholder="Content..."
        value={content}
        onChange={e => setContent(e.target.value)}
      />
      {error && <div className="text-xs text-red-400">{error}</div>}
      <button className={BTN_PRIMARY} onClick={submit} disabled={saving || !content.trim()}>
        {saving ? 'Saving...' : 'Add Note'}
      </button>
    </div>
  );
}

// ── Outreach Form ─────────────────────────────────────────────────────────────

function OutreachForm({ talentId, onAdded }: { talentId: string; onAdded: () => void }) {
  const [channel, setChannel]   = useState('email');
  const [message, setMessage]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const submit = async () => {
    if (!message.trim()) return;
    setSaving(true);
    try {
      await createTalentOutreach(talentId, {
        talentId,
        channel,
        messagePreview: message.trim(),
        status: 'pending',
      });
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setSaving(false);
    }
  };

  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 space-y-2">
      <select className={SELECT_CLS} value={channel} onChange={e => setChannel(e.target.value)}>
        <option value="email">Email</option>
        <option value="phone">Phone</option>
        <option value="sms">SMS</option>
        <option value="slack">Slack</option>
        <option value="other">Other</option>
      </select>
      <textarea
        className={INPUT_CLS + ' h-16 resize-none'}
        placeholder="Message..."
        value={message}
        onChange={e => setMessage(e.target.value)}
      />
      {error && <div className="text-xs text-red-400">{error}</div>}
      <button className={BTN_PRIMARY} onClick={submit} disabled={saving || !message.trim()}>
        {saving ? 'Sending...' : 'Queue Outreach'}
      </button>
    </div>
  );
}

// ── Matcher View ──────────────────────────────────────────────────────────────

function MatcherView({ onBack }: { onBack: () => void }) {
  const [query, setQuery]         = useState('');
  const [category, setCategory]   = useState('');
  const [location, setLocation]   = useState('');
  const [urgency, setUrgency]     = useState<'low' | 'medium' | 'high'>('medium');
  const [results, setResults]     = useState<RankResult[] | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [outreachTarget, setOutreachTarget] = useState<TalentProfile | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResults(null);
    setError('');
    try {
      const res = await rankTalent({ query, category: category || undefined, location: location || undefined, urgency });
      setResults(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ranking failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-zinc-800 flex items-center gap-2">
        <button className={BTN_GHOST} onClick={onBack}>Back</button>
        <h2 className="text-sm font-semibold text-zinc-200">Find Talent</h2>
      </div>

      <div className="p-4 space-y-3 border-b border-zinc-800">
        <textarea
          className={INPUT_CLS + ' h-16 resize-none'}
          placeholder="Describe what you need (e.g. 'need a licensed plumber in Austin for emergency pipe repair')"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap">
          <input className={INPUT_CLS + ' max-w-[140px]'} placeholder="Category" value={category} onChange={e => setCategory(e.target.value)} />
          <input className={INPUT_CLS + ' max-w-[120px]'} placeholder="Location" value={location} onChange={e => setLocation(e.target.value)} />
          <select className={SELECT_CLS + ' max-w-[100px]'} value={urgency} onChange={e => setUrgency(e.target.value as typeof urgency)}>
            <option value="low">Low urgency</option>
            <option value="medium">Medium urgency</option>
            <option value="high">High urgency</option>
          </select>
          <button className={BTN_PRIMARY} onClick={search} disabled={loading || !query.trim()}>
            {loading ? 'Searching...' : 'Find'}
          </button>
        </div>
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {results === null && !loading && (
          <div className="text-xs text-zinc-600 text-center py-8">Enter a description above to find matching talent.</div>
        )}

        {outreachTarget && (
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-zinc-200">Draft Outreach to {outreachTarget.displayName}</div>
              <button className="text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setOutreachTarget(null)}>Cancel</button>
            </div>
            <OutreachForm talentId={outreachTarget.id} onAdded={() => setOutreachTarget(null)} />
          </div>
        )}

        {results && results.length === 0 && (
          <div className="text-xs text-zinc-600 text-center py-8">No talent found matching your request.</div>
        )}

        {results && results.map(r => (
          <div key={r.talent.id} className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              {r.talent.preferred && <span className="text-yellow-400 text-[10px]">★</span>}
              <span className="text-sm font-medium text-zinc-200">{r.talent.displayName}</span>
              {r.talent.companyName && <span className="text-xs text-zinc-500">{r.talent.companyName}</span>}
              <StatusBadge status={r.talent.status} />
              <div className="ml-auto flex items-center gap-2">
                <div className="text-sm font-bold text-zinc-100">{r.score}</div>
                <div className="w-16 h-2 bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${r.score >= 70 ? 'bg-green-500' : r.score >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                    style={{ width: `${r.score}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="text-xs text-zinc-400">{r.explanation.summary}</div>

            <div className="flex items-center gap-2">
              <button
                className="text-xs text-zinc-500 hover:text-zinc-300"
                onClick={() => setExpanded(expanded === r.talent.id ? null : r.talent.id)}
              >
                {expanded === r.talent.id ? 'Hide details' : 'Show scoring details'}
              </button>
              <button className={BTN_GHOST + ' ml-auto'} onClick={() => setOutreachTarget(r.talent)}>
                Draft Outreach
              </button>
            </div>

            {expanded === r.talent.id && (
              <div className="border-t border-zinc-700 pt-2 grid grid-cols-2 gap-1.5 text-[10px]">
                {[
                  ['Category fit', r.explanation.categoryFit],
                  ['Geography fit', r.explanation.geographyFit],
                  ['Trust score', r.explanation.trustScore],
                  ['Response history', r.explanation.responseHistory],
                  ['Recency', r.explanation.recency],
                  ['Preferred bonus', r.explanation.preferredBonus],
                ].map(([label, dim]) => {
                  const d = dim as { score: number; reason: string };
                  return (
                    <div key={label as string} className="bg-zinc-700/30 rounded p-1.5">
                      <div className="text-zinc-500">{label as string}</div>
                      <div className="text-zinc-300 font-medium">{d.score} pts</div>
                      <div className="text-zinc-500">{d.reason}</div>
                    </div>
                  );
                })}
                {r.explanation.penalties.reasons.length > 0 && (
                  <div className="col-span-2 bg-red-900/20 border border-red-800/30 rounded p-1.5">
                    <div className="text-red-400">Penalties: {r.explanation.penalties.score}</div>
                    {r.explanation.penalties.reasons.map((reason, i) => (
                      <div key={i} className="text-zinc-500">{reason}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Outreach Queue View ───────────────────────────────────────────────────────

function OutreachQueueView({ onBack }: { onBack: () => void }) {
  const [items, setItems]   = useState<TalentOutreach[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPendingOutreach();
      setItems(data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const updateStatus = async (item: TalentOutreach, status: string) => {
    try {
      await updateTalentOutreach(item.talentId, item.id, { status });
      await load();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-zinc-800 flex items-center gap-2">
        <button className={BTN_GHOST} onClick={onBack}>Back</button>
        <h2 className="text-sm font-semibold text-zinc-200">Outreach Queue ({items.length} pending)</h2>
        <button className={BTN_GHOST + ' ml-auto'} onClick={load}>Refresh</button>
      </div>
      {loading && <div className="p-6 text-xs text-zinc-500">Loading...</div>}
      {error   && <div className="p-4 text-xs text-red-400">{error}</div>}
      {!loading && !error && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {items.length === 0 && (
            <div className="text-xs text-zinc-600 text-center py-8">No pending outreach items.</div>
          )}
          {items.map(item => (
            <div key={item.id} className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-200">Outreach #{item.id.slice(0, 8)}</span>
                {item.channel && <span className="text-xs text-zinc-500">{item.channel}</span>}
                <span className="text-xs text-zinc-600 ml-auto">{timeAgo(item.createdAt)}</span>
              </div>
              <div className="text-xs text-zinc-400 line-clamp-2">{item.messagePreview}</div>
              <div className="flex gap-2">
                <button className={BTN_PRIMARY} onClick={() => updateStatus(item, 'approved')}>Approve</button>
                <button className={BTN_DANGER} onClick={() => updateStatus(item, 'denied')}>Deny</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Talent Form (Create / Edit) ───────────────────────────────────────────────

interface TalentFormState {
  displayName: string;
  companyName: string;
  category: string;
  subcategory: string;
  description: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  state: string;
  zip: string;
  status: string;
  source: string;
  notes: string;
  tags: string;
  specialties: string;
  languages: string;
  costBand: string;
  availabilityNotes: string;
  pricingNotes: string;
}

const EMPTY_TALENT_FORM: TalentFormState = {
  displayName: '', companyName: '', category: '', subcategory: '',
  description: '', email: '', phone: '', website: '',
  city: '', state: '', zip: '',
  status: 'active', source: 'manual', notes: '',
  tags: '', specialties: '', languages: '',
  costBand: '', availabilityNotes: '', pricingNotes: '',
};

function TalentForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: TalentProfile;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<TalentFormState>(
    initial ? {
      displayName:       initial.displayName,
      companyName:       initial.companyName ?? '',
      category:          initial.category,
      subcategory:       initial.subcategory ?? '',
      description:       initial.description ?? '',
      email:             initial.email ?? '',
      phone:             initial.phone ?? '',
      website:           initial.website ?? '',
      city:              initial.city ?? '',
      state:             initial.state ?? '',
      zip:               initial.zip ?? '',
      status:            initial.status,
      source:            initial.source,
      notes:             initial.notes ?? '',
      tags:              initial.tags.join(', '),
      specialties:       initial.specialties.join(', '),
      languages:         initial.languages.join(', '),
      costBand:          initial.costBand ?? '',
      availabilityNotes: initial.availabilityNotes ?? '',
      pricingNotes:      initial.pricingNotes ?? '',
    } : EMPTY_TALENT_FORM
  );
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (key: keyof TalentFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    if (!form.displayName.trim() || !form.category.trim()) {
      setError('Name and category are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        displayName:       form.displayName.trim(),
        companyName:       form.companyName.trim() || undefined,
        category:          form.category.trim(),
        subcategory:       form.subcategory.trim() || undefined,
        description:       form.description.trim() || undefined,
        email:             form.email.trim() || undefined,
        phone:             form.phone.trim() || undefined,
        website:           form.website.trim() || undefined,
        city:              form.city.trim() || undefined,
        state:             form.state.trim() || undefined,
        zip:               form.zip.trim() || undefined,
        status:            form.status as TalentProfile['status'],
        source:            form.source as TalentProfile['source'],
        notes:             form.notes.trim() || undefined,
        tags:              form.tags.split(',').map(t => t.trim()).filter(Boolean),
        specialties:       form.specialties.split(',').map(t => t.trim()).filter(Boolean),
        languages:         form.languages.split(',').map(t => t.trim()).filter(Boolean),
        costBand:          form.costBand.trim() || undefined,
        availabilityNotes: form.availabilityNotes.trim() || undefined,
        pricingNotes:      form.pricingNotes.trim() || undefined,
        serviceAreas:      [],
        contactMethods:    {},
        preferredChannels: [],
      };

      if (initial) {
        await updateTalent(initial.id, payload);
      } else {
        await createTalent(payload);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-zinc-800 flex items-center gap-2">
        <button className={BTN_GHOST} onClick={onCancel}>Cancel</button>
        <h2 className="text-sm font-semibold text-zinc-200">{initial ? 'Edit Talent' : 'Add Talent'}</h2>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500">Display Name *</label>
            <input className={INPUT_CLS} placeholder="Jane Smith" value={form.displayName} onChange={set('displayName')} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500">Company</label>
            <input className={INPUT_CLS} placeholder="Acme Plumbing Co." value={form.companyName} onChange={set('companyName')} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500">Category *</label>
            <input className={INPUT_CLS} placeholder="plumber, electrician, photographer..." value={form.category} onChange={set('category')} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500">Subcategory</label>
            <input className={INPUT_CLS} placeholder="commercial, residential..." value={form.subcategory} onChange={set('subcategory')} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500">Email</label>
            <input className={INPUT_CLS} type="email" placeholder="jane@example.com" value={form.email} onChange={set('email')} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500">Phone</label>
            <input className={INPUT_CLS} placeholder="+1 555-0100" value={form.phone} onChange={set('phone')} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500">Website</label>
            <input className={INPUT_CLS} placeholder="https://example.com" value={form.website} onChange={set('website')} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500">Cost Band</label>
            <input className={INPUT_CLS} placeholder="budget, mid, premium" value={form.costBand} onChange={set('costBand')} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500">City</label>
            <input className={INPUT_CLS} placeholder="Austin" value={form.city} onChange={set('city')} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500">State</label>
            <input className={INPUT_CLS} placeholder="TX" value={form.state} onChange={set('state')} />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500">Status</label>
            <select className={SELECT_CLS} value={form.status} onChange={set('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-zinc-500">Source</label>
            <select className={SELECT_CLS} value={form.source} onChange={set('source')}>
              <option value="manual">Manual</option>
              <option value="referral">Referral</option>
              <option value="import">Import</option>
              <option value="agent">Agent</option>
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-zinc-500">Tags (comma-separated)</label>
          <input className={INPUT_CLS} placeholder="licensed, insured, residential" value={form.tags} onChange={set('tags')} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-zinc-500">Specialties (comma-separated)</label>
          <input className={INPUT_CLS} placeholder="bathroom remodel, leak repair" value={form.specialties} onChange={set('specialties')} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-zinc-500">Description</label>
          <textarea className={INPUT_CLS + ' h-16 resize-none'} placeholder="Brief description..." value={form.description} onChange={set('description')} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-zinc-500">Internal Notes</label>
          <textarea className={INPUT_CLS + ' h-16 resize-none'} placeholder="Private notes..." value={form.notes} onChange={set('notes')} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-zinc-500">Availability Notes</label>
          <input className={INPUT_CLS} placeholder="Available weekdays, 2-week lead time" value={form.availabilityNotes} onChange={set('availabilityNotes')} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-zinc-500">Pricing Notes</label>
          <input className={INPUT_CLS} placeholder="Quotes on request, flat-fee projects" value={form.pricingNotes} onChange={set('pricingNotes')} />
        </div>

        {error && <div className="text-xs text-red-400">{error}</div>}
        <div className="flex gap-2 pt-2">
          <button className={BTN_PRIMARY} onClick={submit} disabled={saving}>
            {saving ? 'Saving...' : initial ? 'Save Changes' : 'Add Talent'}
          </button>
          <button className={BTN_GHOST} onClick={onCancel}>Cancel</button>
          {initial && (
            <button
              className={BTN_DANGER + ' ml-auto'}
              onClick={async () => {
                if (!confirm(`Delete ${initial.displayName}?`)) return;
                try {
                  await deleteTalent(initial.id);
                  onSaved();
                } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function TalentMarketplacePanel() {
  const [view, setView]           = useState<View>('dashboard');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTalent, setEditingTalent] = useState<TalentProfile | null>(null);

  const handleSelectTalent = (t: TalentProfile) => {
    setSelectedId(t.id);
    setView('detail');
  };

  const handleEdit = (t: TalentProfile) => {
    setEditingTalent(t);
    setView('edit');
  };

  const handleSaved = () => {
    setEditingTalent(null);
    setView('directory');
  };

  return (
    <div className="h-full bg-zinc-900 text-zinc-200 overflow-hidden">
      {view === 'dashboard' && (
        <DashboardView onNavigate={setView} />
      )}
      {view === 'directory' && (
        <DirectoryView
          onSelect={handleSelectTalent}
          onNavigate={setView}
        />
      )}
      {view === 'detail' && selectedId && (
        <DetailView
          talentId={selectedId}
          onBack={() => setView('directory')}
          onEdit={handleEdit}
        />
      )}
      {view === 'matcher' && (
        <MatcherView onBack={() => setView('dashboard')} />
      )}
      {view === 'outreach-queue' && (
        <OutreachQueueView onBack={() => setView('dashboard')} />
      )}
      {view === 'create' && (
        <TalentForm
          onSaved={handleSaved}
          onCancel={() => setView('directory')}
        />
      )}
      {view === 'edit' && editingTalent && (
        <TalentForm
          initial={editingTalent}
          onSaved={handleSaved}
          onCancel={() => setView('detail')}
        />
      )}
    </div>
  );
}
