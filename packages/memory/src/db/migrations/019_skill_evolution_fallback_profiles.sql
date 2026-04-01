-- ── Skill versions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_versions (
  id          TEXT PRIMARY KEY,
  skill_id    TEXT NOT NULL,
  version     INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,  -- full skill JSON at this version
  prior_version_id TEXT,
  created_by  TEXT,
  changelog_note TEXT,
  created_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_versions_unique ON skill_versions(skill_id, version);
CREATE INDEX IF NOT EXISTS idx_skill_versions_skill_id ON skill_versions(skill_id);

-- ── Skill evolution proposals ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_evolution_proposals (
  id              TEXT PRIMARY KEY,
  source_skill_id TEXT,
  proposed_name   TEXT NOT NULL,
  proposal_type   TEXT NOT NULL CHECK(proposal_type IN ('new_skill','update_skill','prompt_refinement','workflow_refinement','parameter_tuning')),
  summary         TEXT NOT NULL,
  rationale       TEXT NOT NULL,
  changes         TEXT NOT NULL,  -- JSON: structured diff/changes
  evidence        TEXT,           -- JSON: task history references
  confidence      REAL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','superseded','applied')),
  created_by      TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  reviewed_by     TEXT,
  reviewed_at     INTEGER,
  applied_at      INTEGER,
  applied_skill_version INTEGER,
  review_note     TEXT
);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON skill_evolution_proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_skill_id ON skill_evolution_proposals(source_skill_id);

-- ── Named fallback chains ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fallback_chains (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  task_type   TEXT,
  agent_id    TEXT,
  skill_id    TEXT,
  providers   TEXT NOT NULL,  -- JSON array of provider IDs in priority order
  created_by  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fallback_chains_task_type ON fallback_chains(task_type);
CREATE INDEX IF NOT EXISTS idx_fallback_chains_agent_id  ON fallback_chains(agent_id);

-- ── Operating profiles ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operating_profiles (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  description       TEXT,
  icon              TEXT,
  color             TEXT,
  is_default        INTEGER NOT NULL DEFAULT 0,
  enabled_providers TEXT,   -- JSON array (null = all)
  enabled_skills    TEXT,   -- JSON array (null = all)
  enabled_tools     TEXT,   -- JSON array (null = all)
  fallback_chain_id TEXT,
  privacy_mode      TEXT NOT NULL DEFAULT 'standard' CHECK(privacy_mode IN ('local_only','standard','unrestricted')),
  restrictions      TEXT,   -- JSON object
  status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- ── Active profile per agent/session ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS active_profiles (
  context_id   TEXT PRIMARY KEY,  -- agentId or 'global'
  context_type TEXT NOT NULL DEFAULT 'agent',
  profile_id   TEXT NOT NULL,
  activated_at INTEGER NOT NULL
);
