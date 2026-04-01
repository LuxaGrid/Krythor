import { useState, useEffect, useCallback } from 'react';
import {
  listEvolutionProposals,
  getEvolutionProposal,
  createEvolutionProposal,
  reviewEvolutionProposal,
  applyEvolutionProposal,
  listSkillVersions,
  restoreSkillVersion,
  type SkillEvolutionProposal,
  type SkillVersion,
  type ProposalStatus,
  type ProposalType,
} from '../api.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString();
}

const STATUS_COLORS: Record<ProposalStatus, string> = {
  pending:    'bg-yellow-900/50 text-yellow-300 border-yellow-700/40',
  approved:   'bg-green-900/50  text-green-300  border-green-700/40',
  rejected:   'bg-red-900/50    text-red-300    border-red-700/40',
  applied:    'bg-blue-900/50   text-blue-300   border-blue-700/40',
  superseded: 'bg-zinc-800      text-zinc-400   border-zinc-700/40',
};

function StatusBadge({ status }: { status: ProposalStatus }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[status]}`}>
      {status}
    </span>
  );
}

const PROPOSAL_TYPE_LABELS: Record<ProposalType, string> = {
  new_skill:           'New Skill',
  update_skill:        'Update Skill',
  prompt_refinement:   'Prompt Refinement',
  workflow_refinement: 'Workflow Refinement',
  parameter_tuning:    'Parameter Tuning',
};

function TypeBadge({ type }: { type: ProposalType }) {
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-zinc-800 text-zinc-300 border-zinc-600/40 font-medium">
      {PROPOSAL_TYPE_LABELS[type] ?? type}
    </span>
  );
}

// ── New Proposal Form ─────────────────────────────────────────────────────────

interface NewProposalFormProps {
  onClose: () => void;
  onCreated: () => void;
}

function NewProposalForm({ onClose, onCreated }: NewProposalFormProps) {
  const [proposedName, setProposedName] = useState('');
  const [proposalType, setProposalType] = useState<ProposalType>('new_skill');
  const [sourceSkillId, setSourceSkillId] = useState('');
  const [summary, setSummary] = useState('');
  const [rationale, setRationale] = useState('');
  const [changesStr, setChangesStr] = useState('{}');
  const [confidence, setConfidence] = useState<number | ''>('');
  const [createdBy, setCreatedBy] = useState('user');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setErr('');
    let changes: Record<string, unknown> = {};
    try { changes = JSON.parse(changesStr); } catch { setErr('Changes must be valid JSON'); return; }
    if (!proposedName.trim()) { setErr('Proposed name is required'); return; }
    if (!summary.trim()) { setErr('Summary is required'); return; }
    if (!rationale.trim()) { setErr('Rationale is required'); return; }
    setBusy(true);
    try {
      await createEvolutionProposal({
        proposedName: proposedName.trim(),
        proposalType,
        sourceSkillId: sourceSkillId.trim() || undefined,
        summary: summary.trim(),
        rationale: rationale.trim(),
        changes,
        confidence: confidence === '' ? undefined : Number(confidence),
        createdBy: createdBy.trim() || 'user',
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-white">New Evolution Proposal</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Proposed Name <span className="text-red-400">*</span></label>
            <input
              value={proposedName}
              onChange={e => setProposedName(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
              placeholder="e.g. summarize-document-v2"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Proposal Type</label>
            <select
              value={proposalType}
              onChange={e => setProposalType(e.target.value as ProposalType)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              {(Object.keys(PROPOSAL_TYPE_LABELS) as ProposalType[]).map(t => (
                <option key={t} value={t}>{PROPOSAL_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Source Skill ID <span className="text-zinc-600">(optional)</span></label>
            <input
              value={sourceSkillId}
              onChange={e => setSourceSkillId(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
              placeholder="skill ID to evolve from"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Summary <span className="text-red-400">*</span></label>
            <input
              value={summary}
              onChange={e => setSummary(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
              placeholder="One-line summary"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Rationale <span className="text-red-400">*</span></label>
            <textarea
              value={rationale}
              onChange={e => setRationale(e.target.value)}
              rows={3}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 resize-none"
              placeholder="Why this change is needed"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Changes (JSON)</label>
            <textarea
              value={changesStr}
              onChange={e => setChangesStr(e.target.value)}
              rows={4}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-indigo-500 resize-none"
              placeholder="{}"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Confidence (0–100) <span className="text-zinc-600">(optional)</span></label>
              <input
                type="number"
                min={0}
                max={100}
                value={confidence}
                onChange={e => setConfidence(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                placeholder="e.g. 85"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Created By</label>
              <input
                value={createdBy}
                onChange={e => setCreatedBy(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
                placeholder="user"
              />
            </div>
          </div>
          {err && <p className="text-red-400 text-xs">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-zinc-800">
          <button onClick={onClose} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-sm">Cancel</button>
          <button onClick={submit} disabled={busy} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm">
            {busy ? 'Creating...' : 'Create Proposal'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Proposal Detail ───────────────────────────────────────────────────────────

interface ProposalDetailProps {
  proposalId: string;
  onBack: () => void;
  onRefresh: () => void;
}

function ProposalDetail({ proposalId, onBack, onRefresh }: ProposalDetailProps) {
  const [proposal, setProposal] = useState<SkillEvolutionProposal | null>(null);
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionErr, setActionErr] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [restoreMsg, setRestoreMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const p = await getEvolutionProposal(proposalId);
      setProposal(p);
      if (p.sourceSkillId) {
        const { versions: v } = await listSkillVersions(p.sourceSkillId);
        setVersions(v);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => { void load(); }, [load]);

  const doReview = async (decision: 'approved' | 'rejected') => {
    if (!proposal) return;
    setActionBusy(true);
    setActionErr('');
    try {
      await reviewEvolutionProposal(proposal.id, decision, reviewNote || undefined);
      onRefresh();
      void load();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const doApply = async () => {
    if (!proposal) return;
    setActionBusy(true);
    setActionErr('');
    try {
      await applyEvolutionProposal(proposal.id);
      onRefresh();
      void load();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const doRestore = async (skillId: string, version: number) => {
    setActionBusy(true);
    setActionErr('');
    setRestoreMsg('');
    try {
      await restoreSkillVersion(skillId, version);
      setRestoreMsg(`Restored to version ${version}`);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) return <div className="p-6 text-zinc-400 animate-pulse text-sm">Loading proposal...</div>;
  if (err) return <div className="p-6 text-red-400 text-sm">{err}</div>;
  if (!proposal) return null;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center gap-3">
        <button onClick={onBack} className="text-indigo-400 hover:text-indigo-300 text-sm">
          &larr; Back to list
        </button>
        <span className="text-zinc-700">/</span>
        <h2 className="text-sm font-semibold text-white truncate">{proposal.proposedName}</h2>
      </div>

      <div className="px-6 py-5 space-y-5">
        {/* Header info */}
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-base font-semibold text-white">{proposal.proposedName}</p>
              <p className="text-xs text-zinc-400 mt-0.5">{proposal.summary}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <TypeBadge type={proposal.proposalType} />
              <StatusBadge status={proposal.status} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div><span className="text-zinc-500">Created by:</span> <span className="text-zinc-300">{proposal.createdBy}</span></div>
            <div><span className="text-zinc-500">Created at:</span> <span className="text-zinc-300">{fmtTs(proposal.createdAt)}</span></div>
            {proposal.sourceSkillId && (
              <div className="col-span-2"><span className="text-zinc-500">Source skill:</span> <span className="text-zinc-300 font-mono">{proposal.sourceSkillId}</span></div>
            )}
            {proposal.confidence != null && (
              <div><span className="text-zinc-500">Confidence:</span> <span className="text-zinc-300">{proposal.confidence}%</span></div>
            )}
            {proposal.reviewedBy && (
              <div><span className="text-zinc-500">Reviewed by:</span> <span className="text-zinc-300">{proposal.reviewedBy}</span></div>
            )}
            {proposal.reviewedAt && (
              <div><span className="text-zinc-500">Reviewed at:</span> <span className="text-zinc-300">{fmtTs(proposal.reviewedAt)}</span></div>
            )}
            {proposal.appliedAt && (
              <div><span className="text-zinc-500">Applied at:</span> <span className="text-zinc-300">{fmtTs(proposal.appliedAt)}</span></div>
            )}
            {proposal.appliedSkillVersion != null && (
              <div><span className="text-zinc-500">Applied version:</span> <span className="text-zinc-300">{proposal.appliedSkillVersion}</span></div>
            )}
          </div>
        </div>

        {/* Rationale */}
        <div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Rationale</h3>
          <p className="text-sm text-zinc-300 leading-relaxed">{proposal.rationale}</p>
        </div>

        {/* Review note */}
        {proposal.reviewNote && (
          <div>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Review Note</h3>
            <p className="text-sm text-zinc-300">{proposal.reviewNote}</p>
          </div>
        )}

        {/* Changes */}
        <div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Changes</h3>
          <pre className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-300 font-mono overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(proposal.changes, null, 2)}
          </pre>
        </div>

        {/* Evidence */}
        {proposal.evidence && Object.keys(proposal.evidence).length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Evidence</h3>
            <pre className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-300 font-mono overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(proposal.evidence, null, 2)}
            </pre>
          </div>
        )}

        {/* Actions */}
        {(proposal.status === 'pending' || proposal.status === 'approved') && (
          <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 space-y-3">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Actions</h3>
            {proposal.status === 'pending' && (
              <div className="space-y-2">
                <textarea
                  value={reviewNote}
                  onChange={e => setReviewNote(e.target.value)}
                  placeholder="Optional review note..."
                  rows={2}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => doReview('approved')}
                    disabled={actionBusy}
                    className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => doReview('rejected')}
                    disabled={actionBusy}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
            {proposal.status === 'approved' && (
              <button
                onClick={doApply}
                disabled={actionBusy}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm"
              >
                Apply to Skill
              </button>
            )}
            {actionErr && <p className="text-red-400 text-xs">{actionErr}</p>}
          </div>
        )}

        {/* Version History */}
        {proposal.sourceSkillId && versions.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Version History</h3>
            <div className="space-y-2">
              {versions.map(v => (
                <div key={v.id} className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-zinc-200">v{v.version}</span>
                      {v.changelogNote && <span className="text-xs text-zinc-400 truncate">{v.changelogNote}</span>}
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      {fmtTs(v.createdAt)}{v.createdBy ? ` by ${v.createdBy}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => doRestore(proposal.sourceSkillId!, v.version)}
                    disabled={actionBusy}
                    className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white px-2.5 py-1 rounded text-xs flex-shrink-0"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
            {restoreMsg && <p className="text-green-400 text-xs mt-2">{restoreMsg}</p>}
            {actionErr && <p className="text-red-400 text-xs mt-2">{actionErr}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Proposal List Row ─────────────────────────────────────────────────────────

function ProposalRow({ proposal, onClick }: { proposal: SkillEvolutionProposal; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-zinc-800 border border-zinc-700 rounded-lg p-4 hover:border-zinc-600 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">{proposal.proposedName}</span>
            <TypeBadge type={proposal.proposalType} />
            <StatusBadge status={proposal.status} />
          </div>
          <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{proposal.summary}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-2 text-[10px] text-zinc-500">
        <span>by {proposal.createdBy}</span>
        <span>{fmtTs(proposal.createdAt)}</span>
        {proposal.confidence != null && <span>confidence: {proposal.confidence}%</span>}
      </div>
    </button>
  );
}

// ── SkillEvolutionPanel ───────────────────────────────────────────────────────

export function SkillEvolutionPanel() {
  const [proposals, setProposals] = useState<SkillEvolutionProposal[]>([]);
  const [statusFilter, setStatusFilter] = useState<ProposalStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const filter = statusFilter !== 'all' ? { status: statusFilter } : undefined;
      const { proposals: p } = await listEvolutionProposals(filter);
      setProposals(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  if (selectedId) {
    return (
      <div className="flex flex-col h-full bg-zinc-900 text-white overflow-hidden">
        <ProposalDetail
          proposalId={selectedId}
          onBack={() => setSelectedId(null)}
          onRefresh={() => void load()}
        />
      </div>
    );
  }

  const STATUS_OPTIONS: Array<{ value: ProposalStatus | 'all'; label: string }> = [
    { value: 'all',       label: 'All' },
    { value: 'pending',   label: 'Pending' },
    { value: 'approved',  label: 'Approved' },
    { value: 'rejected',  label: 'Rejected' },
    { value: 'applied',   label: 'Applied' },
    { value: 'superseded', label: 'Superseded' },
  ];

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white">Skill Evolution</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Review and apply skill improvement proposals</p>
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded text-sm"
        >
          New Proposal
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-800 flex-shrink-0">
        <span className="text-xs text-zinc-500">Status:</span>
        {STATUS_OPTIONS.map(o => (
          <button
            key={o.value}
            onClick={() => setStatusFilter(o.value)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              statusFilter === o.value
                ? 'bg-indigo-700 border-indigo-500 text-white'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && <p className="text-zinc-400 text-sm animate-pulse">Loading proposals...</p>}
        {!loading && err && <p className="text-red-400 text-sm">{err}</p>}
        {!loading && !err && proposals.length === 0 && (
          <p className="text-zinc-500 text-sm">No proposals found.</p>
        )}
        {!loading && !err && proposals.length > 0 && (
          <div className="space-y-3">
            {proposals.map(p => (
              <ProposalRow key={p.id} proposal={p} onClick={() => setSelectedId(p.id)} />
            ))}
          </div>
        )}
      </div>

      {showNewForm && (
        <NewProposalForm
          onClose={() => setShowNewForm(false)}
          onCreated={() => { setShowNewForm(false); void load(); }}
        />
      )}
    </div>
  );
}
