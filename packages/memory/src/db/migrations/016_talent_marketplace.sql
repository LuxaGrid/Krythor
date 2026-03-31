CREATE TABLE talent_profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  company_name TEXT,
  category TEXT NOT NULL,
  subcategory TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  service_areas TEXT NOT NULL DEFAULT '[]',
  city TEXT,
  state TEXT,
  zip TEXT,
  contact_methods TEXT NOT NULL DEFAULT '{}',
  email TEXT,
  phone TEXT,
  website TEXT,
  preferred_channels TEXT NOT NULL DEFAULT '[]',
  licensing_info TEXT,
  insurance_info TEXT,
  availability_notes TEXT,
  pricing_notes TEXT,
  hourly_rate_cents INTEGER,
  cost_band TEXT,
  specialties TEXT NOT NULL DEFAULT '[]',
  languages TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  avg_response_time_hours REAL,
  response_rate REAL NOT NULL DEFAULT 1.0,
  successful_jobs_count INTEGER NOT NULL DEFAULT 0,
  declined_jobs_count INTEGER NOT NULL DEFAULT 0,
  no_response_count INTEGER NOT NULL DEFAULT 0,
  user_rating_internal REAL,
  trust_score REAL NOT NULL DEFAULT 0.5,
  last_used_at INTEGER,
  last_contacted_at INTEGER,
  internal_outcome_notes TEXT,
  preferred INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_talent_profiles_category ON talent_profiles (category);
CREATE INDEX idx_talent_profiles_status ON talent_profiles (status);
CREATE INDEX idx_talent_profiles_state ON talent_profiles (state);
CREATE INDEX idx_talent_profiles_preferred ON talent_profiles (preferred);

CREATE TABLE talent_interactions (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES talent_profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  agent_id TEXT,
  content TEXT NOT NULL,
  outcome TEXT,
  rating INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_talent_interactions_talent_id ON talent_interactions (talent_id);
CREATE INDEX idx_talent_interactions_created_at ON talent_interactions (created_at);

CREATE TABLE talent_outreach (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES talent_profiles(id) ON DELETE CASCADE,
  channel TEXT,
  message_preview TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approval_id TEXT,
  approved_by TEXT,
  sent_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_talent_outreach_talent_id ON talent_outreach (talent_id);
CREATE INDEX idx_talent_outreach_status ON talent_outreach (status);

CREATE TABLE marketplace_requests (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  category TEXT,
  location TEXT,
  urgency TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_talent_id TEXT
);
