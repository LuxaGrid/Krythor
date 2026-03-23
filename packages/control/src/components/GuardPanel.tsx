import { useState, useEffect, useCallback } from 'react';
import {
  guardStats, guardRules, guardDecisions, guardCheck, updateGuardRule, deleteGuardRule, createGuardRule, setGuardDefault,
  type GuardRule, type GuardStats, type GuardDecision, type GuardVerdict,
} from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

const ACTION_COLOR: Record<string, string> = {
  allow: 'text-emerald-400', deny: 'text-red-400', warn: 'text-amber-400',
};

type SafetyMode = 'guarded' | 'balanced' | 'power-user';

const SAFETY_MODES: { value: SafetyMode; label: string; description: string }[] = [
  { value: 'guarded',    label: 'Guarded',    description: 'Default deny — strict safety, all rules active' },
  { value: 'balanced',   label: 'Balanced',   description: 'Default allow — warn rules active, moderate safety' },
  { value: 'power-user', label: 'Power User', description: 'Default allow — all rules disabled, unrestricted' },
];

interface AddRuleForm {
  name: string;
  description: string;
  action: string;
  priority: string;
  enabled: boolean;
  reason: string;
  contentPattern: string;
}

const EMPTY_FORM: AddRuleForm = {
  name: '', description: '', action: 'warn', priority: '50', enabled: true, reason: '', contentPattern: '',
};

const INPUT_CLS = 'bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';
const SELECT_CLS = 'bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';

const Spinner = () => (
  <svg className="animate-spin h-3 w-3 inline-block" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>
);

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

export function GuardPanel() {
  const [rules, setRules]         = useState<GuardRule[]>([]);
  const [stats, setStats]         = useState<GuardStats | null>(null);
  const [loading, setLoading]     = useState(false);
  const [showAdd, setShowAdd]     = useState(false);
  const [addError, setAddError]   = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [form, setForm]           = useState<AddRuleForm>(EMPTY_FORM);
  const [safetyMode, setSafetyMode] = useState<SafetyMode | null>(null);
  const [modeLoading, setModeLoading] = useState(false);
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const [addingRule, setAddingRule] = useState(false);
  const [activeTab, setActiveTab]   = useState<'rules' | 'audit' | 'test'>('rules');
  const [decisions, setDecisions]   = useState<GuardDecision[]>([]);
  const [decisionsLoading, setDecisionsLoading] = useState(false);
  // Guard live-check state
  const [checkForm, setCheckForm]   = useState({ operation: '', source: 'user', scope: '', content: '' });
  const [checkResult, setCheckResult] = useState<GuardVerdict | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([guardRules(), guardStats()]);
      setRules(r);
      setStats(s);
      setDeleteError(null);

      // Derive current safety mode from loaded policy.
      // Both checks use only non-builtin rules so the comparison is symmetric.
      if (s.defaultAction === 'deny') {
        setSafetyMode('guarded');
      } else if (s.defaultAction === 'allow') {
        const customRules = r.filter(rule => !rule.id.startsWith('builtin-'));
        const allDisabled = customRules.length === 0 || customRules.every(rule => !rule.enabled);
        const allEnabled = customRules.length > 0 && customRules.every(rule => rule.enabled);
        if (allDisabled) {
          setSafetyMode('power-user');
        } else if (allEnabled) {
          setSafetyMode('balanced');
        }
        // else leave as null (custom state)
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleEnabled = async (rule: GuardRule) => {
    setSavingRuleId(rule.id);
    try {
      const updated = await updateGuardRule(rule.id, { enabled: !rule.enabled });
      setRules(r => r.map(x => x.id === rule.id ? updated : x));
      const s = await guardStats();
      setStats(s);
    } catch { /* ignore */ }
    finally { setSavingRuleId(null); }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteGuardRule(id);
      setRules(r => r.filter(x => x.id !== id));
      const s = await guardStats();
      setStats(s);
    } catch (err) {
      setDeleteError(String(err));
    }
  };

  const handleAddRule = async () => {
    if (!form.name.trim()) { setAddError('Name is required.'); return; }
    if (!form.reason.trim()) { setAddError('Reason is required.'); return; }
    setAddError(null);
    setAddingRule(true);
    try {
      const condition: Record<string, unknown> = {};
      if (form.contentPattern.trim()) condition['contentPattern'] = form.contentPattern.trim();
      const rule = await createGuardRule({
        name: form.name.trim(),
        description: form.description.trim(),
        action: form.action,
        priority: parseInt(form.priority, 10) || 50,
        enabled: form.enabled,
        reason: form.reason.trim(),
        condition,
      });
      setRules(r => [...r, rule].sort((a, b) => a.priority - b.priority));
      setForm(EMPTY_FORM);
      setShowAdd(false);
      const s = await guardStats();
      setStats(s);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add rule');
    } finally {
      setAddingRule(false);
    }
  };

  const handleSafetyMode = async (mode: SafetyMode) => {
    setModeLoading(true);
    setSavingDefault(true);
    try {
      if (mode === 'guarded') {
        await setGuardDefault('deny');
        // Enable all rules
        await Promise.all(rules.filter(r => !r.enabled).map(r => updateGuardRule(r.id, { enabled: true })));
      } else if (mode === 'balanced') {
        await setGuardDefault('allow');
        // Enable warn rules, keep others
        await Promise.all(
          rules.map(r => updateGuardRule(r.id, { enabled: r.action === 'warn' || r.action === 'allow' }))
        );
      } else {
        await setGuardDefault('allow');
        // Disable all custom rules (preserve built-ins as-is)
        await Promise.all(
          rules.filter(r => !r.id.startsWith('builtin-')).map(r => updateGuardRule(r.id, { enabled: false }))
        );
      }
      setSafetyMode(mode);
      await load();
    } catch { /* ignore */ }
    finally { setModeLoading(false); setSavingDefault(false); }
  };

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Guard"
        description="Safety rules that control what your agents can and cannot do. Set the safety mode and define allow/deny/warn rules."
        tip="Choose a safety mode: Guarded (strict, deny by default), Balanced (warn on risky requests), or Power User (unrestricted). Add custom rules to block or allow specific content patterns."
        actions={
          <div className="flex items-center gap-2">
            {stats && <span className="text-xs text-zinc-600">{stats.enabledRules}/{stats.ruleCount} rules active</span>}
            <button
              onClick={() => { setShowAdd(s => !s); setAddError(null); }}
              className="text-xs bg-brand-600/20 text-brand-400 hover:bg-brand-600/30 border border-brand-600/30 rounded px-2 py-1 transition-colors"
            >+ Add Rule</button>
            <button onClick={load} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">{loading ? <Spinner /> : '↺'}</button>
          </div>
        }
      />

      {/* Safety Mode Selector */}
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-2">
        <span className="text-xs text-zinc-500 shrink-0">Safety mode:</span>
        {SAFETY_MODES.map(m => (
          <button
            key={m.value}
            onClick={() => handleSafetyMode(m.value)}
            disabled={modeLoading || savingDefault}
            title={m.description}
            className={`text-xs px-2 py-0.5 rounded-lg transition-colors disabled:opacity-40 ${
              safetyMode === m.value
                ? 'bg-brand-900/60 border border-brand-600 text-brand-300'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-transparent'
            }`}
          >
            {savingDefault && safetyMode === m.value ? <Spinner /> : m.label}
          </button>
        ))}
      </div>

      {/* Tab bar */}
      <div className="px-4 border-b border-zinc-800 flex gap-1">
        {(['rules', 'audit', 'test'] as const).map(t => (
          <button key={t} onClick={async () => {
            setActiveTab(t);
            if (t === 'audit' && decisions.length === 0) {
              setDecisionsLoading(true);
              try { setDecisions(await guardDecisions(200)); } catch { /* non-fatal */ }
              finally { setDecisionsLoading(false); }
            }
          }}
            className={`text-xs px-3 py-2 border-b-2 transition-colors capitalize ${
              activeTab === t
                ? 'border-brand-600 text-brand-300'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t === 'audit' ? 'Audit Log' : t === 'test' ? 'Live Test' : 'Rules'}
          </button>
        ))}
      </div>

      {/* Add Rule Form */}
      {activeTab === 'rules' && showAdd && (
        <div className="p-4 border-b border-zinc-800 space-y-2 bg-zinc-900/30">
          <p className="text-xs text-zinc-400 font-medium">New Rule</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Name *"
              className={`col-span-2 ${INPUT_CLS}`}
            />
            <input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description"
              className={`col-span-2 ${INPUT_CLS}`}
            />
            <select
              value={form.action}
              onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
              className={SELECT_CLS}
            >
              {['allow','deny','warn'].map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <input
              type="number"
              value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
              placeholder="Priority (lower = first)"
              className={INPUT_CLS}
            />
            <input
              value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="Reason / message *"
              className={`col-span-2 ${INPUT_CLS}`}
            />
            <input
              value={form.contentPattern}
              onChange={e => setForm(f => ({ ...f, contentPattern: e.target.value }))}
              placeholder="Content pattern (regex, optional)"
              className={`col-span-2 ${INPUT_CLS} font-mono`}
            />
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
                className="accent-brand-500"
              />
              Enabled
            </label>
          </div>
          {addError && <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{addError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleAddRule}
              disabled={addingRule}
              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors flex items-center gap-1"
            >
              {addingRule ? <Spinner /> : null}
              Add
            </button>
            <button
              onClick={() => { setShowAdd(false); setAddError(null); setForm(EMPTY_FORM); }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Audit log tab */}
      {activeTab === 'audit' && (
        <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-zinc-800/50">
          {decisionsLoading ? (
            <div className="flex items-center justify-center py-12 text-zinc-600 text-xs">Loading audit log…</div>
          ) : decisions.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-zinc-600 text-xs">No guard decisions recorded yet.</div>
          ) : decisions.map((d, i) => (
            <div key={i} className="px-4 py-2.5 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={d.allowed ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono'}>
                  {d.allowed ? 'ALLOW' : 'DENY'}
                </span>
                <span className="text-zinc-400 font-mono">{d.operation}</span>
                <span className="text-zinc-600">src: {d.source}{d.sourceId ? `/${d.sourceId}` : ''}</span>
                {d.ruleName && <span className="text-zinc-600">rule: {d.ruleName}</span>}
                <span className="text-zinc-700 ml-auto">{new Date(d.ts).toLocaleTimeString()}</span>
              </div>
              <p className="text-zinc-600 mt-0.5">{d.reason}</p>
              {d.warnings.length > 0 && (
                <p className="text-amber-600 mt-0.5">{d.warnings.join(', ')}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Live test tab */}
      {activeTab === 'test' && (
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
          <p className="text-xs text-zinc-500 leading-relaxed">
            Simulate a guard check without actually running an operation. Useful for verifying that your rules behave as expected.
          </p>
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] text-zinc-600 mb-1 uppercase tracking-wide">Operation</label>
              <input
                value={checkForm.operation}
                onChange={e => setCheckForm(f => ({ ...f, operation: e.target.value }))}
                placeholder="e.g. run_command, send_message, delete_file"
                className={`w-full ${INPUT_CLS}`}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-zinc-600 mb-1 uppercase tracking-wide">Source</label>
                <input
                  value={checkForm.source}
                  onChange={e => setCheckForm(f => ({ ...f, source: e.target.value }))}
                  placeholder="user, agent, api"
                  className={`w-full ${INPUT_CLS}`}
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-600 mb-1 uppercase tracking-wide">Scope</label>
                <input
                  value={checkForm.scope}
                  onChange={e => setCheckForm(f => ({ ...f, scope: e.target.value }))}
                  placeholder="user, workspace, agent"
                  className={`w-full ${INPUT_CLS}`}
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-zinc-600 mb-1 uppercase tracking-wide">Content (optional)</label>
              <textarea
                rows={3}
                value={checkForm.content}
                onChange={e => setCheckForm(f => ({ ...f, content: e.target.value }))}
                placeholder="The content or payload being checked…"
                className={`w-full ${INPUT_CLS} resize-none`}
              />
            </div>
            {checkError && <p className="text-red-400 text-xs">{checkError}</p>}
            <button
              onClick={async () => {
                if (!checkForm.operation.trim()) { setCheckError('Operation is required.'); return; }
                setCheckError(null);
                setCheckResult(null);
                setChecking(true);
                try {
                  const verdict = await guardCheck({
                    operation: checkForm.operation.trim(),
                    source: checkForm.source.trim() || 'user',
                    ...(checkForm.scope.trim() && { scope: checkForm.scope.trim() }),
                    ...(checkForm.content.trim() && { content: checkForm.content.trim() }),
                  });
                  setCheckResult(verdict);
                } catch (e: unknown) {
                  setCheckError(e instanceof Error ? e.message : 'Check failed');
                } finally {
                  setChecking(false);
                }
              }}
              disabled={checking}
              className="px-3 py-1.5 text-xs rounded-lg bg-brand-700/40 hover:bg-brand-600/40 border border-brand-700/50 text-brand-300 disabled:opacity-40 transition-colors"
            >
              {checking ? <><Spinner /> Checking…</> : 'Run guard check'}
            </button>
          </div>

          {checkResult && (
            <div className={`rounded-xl border p-4 space-y-2 ${
              checkResult.allowed
                ? 'bg-emerald-950/20 border-emerald-800/40'
                : 'bg-red-950/20 border-red-800/40'
            }`}>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold font-mono ${checkResult.allowed ? 'text-emerald-400' : 'text-red-400'}`}>
                  {checkResult.allowed ? '✓ ALLOWED' : '✗ DENIED'}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${ACTION_COLOR[checkResult.action] ?? 'text-zinc-400'} bg-zinc-800`}>
                  {checkResult.action}
                </span>
                {checkResult.ruleName && (
                  <span className="text-[10px] text-zinc-600">rule: {checkResult.ruleName}</span>
                )}
              </div>
              <p className="text-xs text-zinc-400">{checkResult.reason}</p>
              {checkResult.warnings.length > 0 && (
                <div className="pt-1 border-t border-zinc-800/60">
                  {checkResult.warnings.map((w, i) => (
                    <p key={i} className="text-[10px] text-amber-500">{w}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Rules tab — Delete error banner */}
      {activeTab === 'rules' && deleteError && (
        <div className="mx-4 mt-3 flex items-center gap-2 text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
          <span className="flex-1">{deleteError}</span>
          <button
            onClick={() => setDeleteError(null)}
            className="text-red-500 hover:text-red-300 transition-colors shrink-0"
          >✕</button>
        </div>
      )}

      {/* Rule list */}
      {activeTab === 'rules' && <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-zinc-800/50">
        {loading ? (
          <div className="divide-y divide-zinc-800/50">
            {[1, 2, 3].map(i => (
              <div key={i} className="px-4 py-3">
                <div className="h-3 bg-zinc-800 rounded animate-pulse w-1/4 mb-2" />
                <div className="h-2 bg-zinc-800 rounded animate-pulse w-1/2 mb-1" />
                <div className="h-2 bg-zinc-800 rounded animate-pulse w-2/3" />
              </div>
            ))}
          </div>
        ) : rules.length === 0 ? (
          <EmptyState
            icon="🛡"
            title="No rules loaded"
            hint="Add a rule above or choose a safety mode preset"
          />
        ) : (
          rules.map(rule => (
            <div key={rule.id} className={`px-4 py-3 group ${rule.enabled ? '' : 'opacity-40'}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-xs font-medium ${ACTION_COLOR[rule.action] ?? 'text-zinc-400'}`}>
                      {rule.action.toUpperCase()}
                    </span>
                    <span className="text-xs text-zinc-600">p:{rule.priority}</span>
                    {rule.id.startsWith('builtin-') && (
                      <span className="text-xs text-zinc-700 bg-zinc-800 px-1 rounded">built-in</span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-200">{rule.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{rule.reason}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(rule.condition.operations as string[] | undefined)?.map(op => (
                      <span key={op} className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-mono">{op}</span>
                    ))}
                    {(rule.condition.sources as string[] | undefined)?.map(s => (
                      <span key={s} className="text-xs bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded">src:{s}</span>
                    ))}
                    {(rule.condition.scopes as string[] | undefined)?.map(s => (
                      <span key={s} className="text-xs bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded">scope:{s}</span>
                    ))}
                    {(rule.condition.contentPattern as string | undefined) && (
                      <span className="text-xs bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded font-mono">
                        /{rule.condition.contentPattern as string}/
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => toggleEnabled(rule)}
                    disabled={savingRuleId === rule.id}
                    className={`text-xs px-2 py-1 rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1 ${rule.enabled
                      ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-600'}`}
                  >
                    {savingRuleId === rule.id ? <Spinner /> : (rule.enabled ? 'disable' : 'enable')}
                  </button>
                  {!rule.id.startsWith('builtin-') && (
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="text-xs px-2 py-1 bg-zinc-800 hover:bg-red-950/30 hover:text-red-400 rounded-lg text-zinc-600 opacity-0 group-hover:opacity-100 transition-all"
                    >✕</button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>}
    </div>
  );
}
