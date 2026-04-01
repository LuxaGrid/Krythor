import { useState, useEffect, useCallback } from 'react';
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  getActiveProfile,
  activateProfile,
  type OperatingProfile,
  type PrivacyMode,
} from '../api.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString();
}

const PRIVACY_COLORS: Record<PrivacyMode, string> = {
  local_only:   'bg-yellow-900/50 text-yellow-300 border-yellow-700/40',
  standard:     'bg-blue-900/50   text-blue-300   border-blue-700/40',
  unrestricted: 'bg-green-900/50  text-green-300  border-green-700/40',
};

const PRIVACY_LABELS: Record<PrivacyMode, string> = {
  local_only:   'Local Only',
  standard:     'Standard',
  unrestricted: 'Unrestricted',
};

function PrivacyBadge({ mode }: { mode: PrivacyMode }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${PRIVACY_COLORS[mode]}`}>
      {PRIVACY_LABELS[mode]}
    </span>
  );
}

function StatusBadge({ status }: { status: 'active' | 'inactive' }) {
  const cls = status === 'active'
    ? 'bg-green-900/50 text-green-300 border-green-700/40'
    : 'bg-zinc-800 text-zinc-400 border-zinc-600/40';
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      {status}
    </span>
  );
}

// ── Profile Form ──────────────────────────────────────────────────────────────

interface ProfileFormValues {
  name: string;
  slug: string;
  description: string;
  privacyMode: PrivacyMode;
  isDefault: boolean;
  enabledProviders: string;
  enabledSkills: string;
  enabledTools: string;
  fallbackChainId: string;
  maxTokensPerRequest: string;
}

function emptyForm(): ProfileFormValues {
  return {
    name: '',
    slug: '',
    description: '',
    privacyMode: 'standard',
    isDefault: false,
    enabledProviders: '',
    enabledSkills: '',
    enabledTools: '',
    fallbackChainId: '',
    maxTokensPerRequest: '',
  };
}

function profileToForm(p: OperatingProfile): ProfileFormValues {
  return {
    name: p.name,
    slug: p.slug,
    description: p.description ?? '',
    privacyMode: p.privacyMode,
    isDefault: p.isDefault,
    enabledProviders: (p.enabledProviders ?? []).join(', '),
    enabledSkills: (p.enabledSkills ?? []).join(', '),
    enabledTools: (p.enabledTools ?? []).join(', '),
    fallbackChainId: p.fallbackChainId ?? '',
    maxTokensPerRequest: p.restrictions?.maxTokensPerRequest != null
      ? String(p.restrictions.maxTokensPerRequest)
      : '',
  };
}

function formToPayload(values: ProfileFormValues): Record<string, unknown> {
  const splitTags = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
  const payload: Record<string, unknown> = {
    name: values.name.trim(),
    slug: values.slug.trim(),
    privacyMode: values.privacyMode,
    isDefault: values.isDefault,
  };
  if (values.description.trim()) payload.description = values.description.trim();
  const providers = splitTags(values.enabledProviders);
  if (providers.length > 0) payload.enabledProviders = providers;
  const skills = splitTags(values.enabledSkills);
  if (skills.length > 0) payload.enabledSkills = skills;
  const tools = splitTags(values.enabledTools);
  if (tools.length > 0) payload.enabledTools = tools;
  if (values.fallbackChainId.trim()) payload.fallbackChainId = values.fallbackChainId.trim();
  if (values.maxTokensPerRequest.trim()) {
    payload.restrictions = { maxTokensPerRequest: Number(values.maxTokensPerRequest) };
  }
  return payload;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

interface ProfileFormProps {
  initial?: ProfileFormValues;
  onSave: (values: ProfileFormValues) => Promise<void>;
  onCancel: () => void;
  title: string;
}

function ProfileForm({ initial, onSave, onCancel, title }: ProfileFormProps) {
  const [values, setValues] = useState<ProfileFormValues>(initial ?? emptyForm());
  const [slugManual, setSlugManual] = useState(!!initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = <K extends keyof ProfileFormValues>(key: K, val: ProfileFormValues[K]) => {
    setValues(v => ({ ...v, [key]: val }));
  };

  const handleNameChange = (name: string) => {
    set('name', name);
    if (!slugManual) set('slug', slugify(name));
  };

  const submit = async () => {
    setErr('');
    if (!values.name.trim()) { setErr('Name is required'); return; }
    if (!values.slug.trim()) { setErr('Slug is required'); return; }
    setBusy(true);
    try {
      await onSave(values);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Name <span className="text-red-400">*</span></label>
          <input
            value={values.name}
            onChange={e => handleNameChange(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            placeholder="e.g. High Privacy Mode"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Slug <span className="text-red-400">*</span></label>
          <input
            value={values.slug}
            onChange={e => { setSlugManual(true); set('slug', e.target.value); }}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 font-mono"
            placeholder="high-privacy-mode"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-zinc-400 mb-1">Description</label>
          <input
            value={values.description}
            onChange={e => set('description', e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            placeholder="Optional description"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Privacy Mode</label>
          <select
            value={values.privacyMode}
            onChange={e => set('privacyMode', e.target.value as PrivacyMode)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="local_only">Local Only</option>
            <option value="standard">Standard</option>
            <option value="unrestricted">Unrestricted</option>
          </select>
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input
            type="checkbox"
            id="profileIsDefault"
            checked={values.isDefault}
            onChange={e => set('isDefault', e.target.checked)}
            className="rounded border-zinc-600"
          />
          <label htmlFor="profileIsDefault" className="text-sm text-zinc-300 cursor-pointer">Set as default profile</label>
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-zinc-400 mb-1">Enabled Providers <span className="text-zinc-600">(comma-separated, leave empty for all)</span></label>
          <input
            value={values.enabledProviders}
            onChange={e => set('enabledProviders', e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            placeholder="openai, anthropic"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-zinc-400 mb-1">Enabled Skills <span className="text-zinc-600">(comma-separated, leave empty for all)</span></label>
          <input
            value={values.enabledSkills}
            onChange={e => set('enabledSkills', e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            placeholder="summarize, translate"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-zinc-400 mb-1">Enabled Tools <span className="text-zinc-600">(comma-separated, leave empty for all)</span></label>
          <input
            value={values.enabledTools}
            onChange={e => set('enabledTools', e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            placeholder="web_search, file_read"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Fallback Chain ID <span className="text-zinc-600">(optional)</span></label>
          <input
            value={values.fallbackChainId}
            onChange={e => set('fallbackChainId', e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500 font-mono"
            placeholder="chain ID"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Max Tokens/Request <span className="text-zinc-600">(optional)</span></label>
          <input
            type="number"
            min={0}
            value={values.maxTokensPerRequest}
            onChange={e => set('maxTokensPerRequest', e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            placeholder="e.g. 4096"
          />
        </div>
      </div>

      {err && <p className="text-red-400 text-xs">{err}</p>}

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm"
        >
          {busy ? 'Saving...' : 'Save'}
        </button>
        <button onClick={onCancel} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Profile Detail ────────────────────────────────────────────────────────────

function TagList({ items, label }: { items: string[] | undefined; label: string }) {
  if (!items || items.length === 0) {
    return (
      <div>
        <span className="text-zinc-500 text-xs">{label}:</span>
        <span className="text-zinc-400 text-xs ml-1">All</span>
      </div>
    );
  }
  return (
    <div>
      <span className="text-zinc-500 text-xs">{label}:</span>
      <div className="flex flex-wrap gap-1 mt-1">
        {items.map(item => (
          <span key={item} className="text-[10px] px-1.5 py-0.5 rounded border bg-zinc-800 text-zinc-300 border-zinc-600/40">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

interface ProfileDetailProps {
  profileId: string;
  activeProfileId: string | undefined;
  onBack: () => void;
  onRefresh: () => void;
}

function ProfileDetail({ profileId, activeProfileId, onBack, onRefresh }: ProfileDetailProps) {
  const [profile, setProfile] = useState<OperatingProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');
  const [activateBusy, setActivateBusy] = useState(false);
  const [activateErr, setActivateErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const p = await getProfile(profileId);
      setProfile(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => { void load(); }, [load]);

  const doDelete = async () => {
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await deleteProfile(profileId);
      onRefresh();
      onBack();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : String(e));
      setDeleteBusy(false);
    }
  };

  const doActivate = async () => {
    if (!profile) return;
    setActivateBusy(true);
    setActivateErr('');
    try {
      await activateProfile(profile.id);
      onRefresh();
    } catch (e) {
      setActivateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActivateBusy(false);
    }
  };

  const doSave = async (values: ProfileFormValues) => {
    await updateProfile(profileId, formToPayload(values));
    onRefresh();
    setEditing(false);
    void load();
  };

  if (loading) return <div className="p-6 text-zinc-400 animate-pulse text-sm">Loading profile...</div>;
  if (err) return <div className="p-6 text-red-400 text-sm">{err}</div>;
  if (!profile) return null;

  const isGloballyActive = activeProfileId === profile.id;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center gap-3">
        <button onClick={onBack} className="text-indigo-400 hover:text-indigo-300 text-sm">
          &larr; Back to list
        </button>
        <span className="text-zinc-700">/</span>
        <h2 className="text-sm font-semibold text-white truncate">{profile.name}</h2>
        {isGloballyActive && (
          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border bg-green-900/50 text-green-300 border-green-700/40 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
            active
          </span>
        )}
      </div>

      <div className="px-6 py-5 space-y-5">
        {editing ? (
          <ProfileForm
            initial={profileToForm(profile)}
            onSave={doSave}
            onCancel={() => setEditing(false)}
            title="Edit Profile"
          />
        ) : (
          <>
            <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-white">{profile.name}</p>
                  <p className="text-xs text-zinc-500 font-mono mt-0.5">{profile.slug}</p>
                  {profile.description && <p className="text-xs text-zinc-400 mt-1">{profile.description}</p>}
                </div>
                <div className="flex gap-2 flex-wrap justify-end">
                  {!isGloballyActive && (
                    <button
                      onClick={doActivate}
                      disabled={activateBusy}
                      className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-xs"
                    >
                      {activateBusy ? 'Activating...' : 'Activate (Global)'}
                    </button>
                  )}
                  <button
                    onClick={() => setEditing(true)}
                    className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded text-xs"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {activateErr && <p className="text-red-400 text-xs">{activateErr}</p>}

              <div className="flex items-center gap-2 flex-wrap">
                <PrivacyBadge mode={profile.privacyMode} />
                <StatusBadge status={profile.status} />
                {profile.isDefault && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border bg-indigo-900/50 text-indigo-300 border-indigo-700/40 font-medium">
                    default
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                <div><span className="text-zinc-500">Created:</span> <span className="text-zinc-300">{fmtTs(profile.createdAt)}</span></div>
                <div><span className="text-zinc-500">Updated:</span> <span className="text-zinc-300">{fmtTs(profile.updatedAt)}</span></div>
                {profile.fallbackChainId && (
                  <div className="col-span-2"><span className="text-zinc-500">Fallback chain:</span> <span className="text-zinc-300 font-mono">{profile.fallbackChainId}</span></div>
                )}
                {profile.restrictions?.maxTokensPerRequest != null && (
                  <div><span className="text-zinc-500">Max tokens/req:</span> <span className="text-zinc-300">{profile.restrictions.maxTokensPerRequest.toLocaleString()}</span></div>
                )}
              </div>
            </div>

            {/* Provider/skill/tool lists */}
            <div className="space-y-3">
              <TagList items={profile.enabledProviders} label="Enabled Providers" />
              <TagList items={profile.enabledSkills} label="Enabled Skills" />
              <TagList items={profile.enabledTools} label="Enabled Tools" />
            </div>

            {/* Delete confirm */}
            {deleteConfirm && (
              <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-4 space-y-3">
                <p className="text-sm text-red-300">Delete profile "{profile.name}"? This cannot be undone.</p>
                {deleteErr && <p className="text-red-400 text-xs">{deleteErr}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={doDelete}
                    disabled={deleteBusy}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm"
                  >
                    {deleteBusy ? 'Deleting...' : 'Confirm Delete'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Profile List Row ──────────────────────────────────────────────────────────

function ProfileRow({
  profile,
  isActive,
  onClick,
}: {
  profile: OperatingProfile;
  isActive: boolean;
  onClick: () => void;
}) {
  const providerCount = profile.enabledProviders?.length ?? null;
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-zinc-800 border border-zinc-700 rounded-lg p-4 hover:border-zinc-600 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block flex-shrink-0" />}
            <span className="text-sm font-medium text-white">{profile.name}</span>
            <PrivacyBadge mode={profile.privacyMode} />
            <StatusBadge status={profile.status} />
            {profile.isDefault && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border bg-indigo-900/50 text-indigo-300 border-indigo-700/40 font-medium">
                default
              </span>
            )}
          </div>
          {profile.description && <p className="text-xs text-zinc-400 mt-1 line-clamp-1">{profile.description}</p>}
        </div>
        {providerCount !== null && (
          <span className="text-xs text-zinc-500 flex-shrink-0">{providerCount} provider{providerCount !== 1 ? 's' : ''}</span>
        )}
      </div>
    </button>
  );
}

// ── ProfilesPanel ─────────────────────────────────────────────────────────────

export function ProfilesPanel() {
  const [profiles, setProfiles] = useState<OperatingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState<string | undefined>(undefined);
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [{ profiles: p }, activeData] = await Promise.all([
        listProfiles(),
        getActiveProfile().catch(() => ({ active: null, profileId: undefined })),
      ]);
      setProfiles(p);
      setActiveProfileId(activeData.profileId ?? activeData.active?.id);
      setActiveProfileName(activeData.active?.name ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const doCreate = async (values: ProfileFormValues) => {
    await createProfile(formToPayload(values));
    void load();
    setShowNewForm(false);
  };

  if (selectedId) {
    return (
      <div className="flex flex-col h-full bg-zinc-900 text-white overflow-hidden">
        <ProfileDetail
          profileId={selectedId}
          activeProfileId={activeProfileId}
          onBack={() => setSelectedId(null)}
          onRefresh={() => void load()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white">Operating Profiles</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-zinc-500">Global active:</span>
            {activeProfileName ? (
              <span className="flex items-center gap-1 text-xs text-green-300">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                {activeProfileName}
              </span>
            ) : (
              <span className="text-xs text-zinc-600">None</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowNewForm(v => !v)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded text-sm"
        >
          {showNewForm ? 'Cancel' : 'New Profile'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {showNewForm && (
          <ProfileForm
            onSave={doCreate}
            onCancel={() => setShowNewForm(false)}
            title="New Operating Profile"
          />
        )}

        {loading && <p className="text-zinc-400 text-sm animate-pulse">Loading profiles...</p>}
        {!loading && err && <p className="text-red-400 text-sm">{err}</p>}
        {!loading && !err && profiles.length === 0 && !showNewForm && (
          <p className="text-zinc-500 text-sm">No profiles configured.</p>
        )}
        {!loading && !err && profiles.length > 0 && (
          <div className="space-y-3">
            {profiles.map(p => (
              <ProfileRow
                key={p.id}
                profile={p}
                isActive={activeProfileId === p.id}
                onClick={() => { setShowNewForm(false); setSelectedId(p.id); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
