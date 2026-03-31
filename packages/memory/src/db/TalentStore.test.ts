import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { TalentStore } from './TalentStore.js';
import type { CreateTalentInput } from './TalentStore.js';

// ── Schema setup ─────────────────────────────────────────────────────────────

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(`
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
  `);

  return db;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<CreateTalentInput> = {}): CreateTalentInput {
  return {
    displayName: 'Alice Plumber',
    category: 'plumbing',
    tags: ['licensed', 'bonded'],
    serviceAreas: ['Downtown'],
    contactMethods: {},
    preferredChannels: [],
    specialties: ['leak repair'],
    languages: ['en'],
    status: 'active',
    source: 'manual',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TalentStore', () => {
  let db: Database.Database;
  let store: TalentStore;

  beforeEach(() => {
    db = makeDb();
    store = new TalentStore(db);
  });

  afterEach(() => {
    db.close();
  });

  // 1. create and retrieve a talent profile
  it('creates and retrieves a talent profile', () => {
    const profile = store.create(makeInput({ displayName: 'Bob Electrician', category: 'electrical' }));
    expect(profile.id).toBeTruthy();
    expect(profile.displayName).toBe('Bob Electrician');
    expect(profile.category).toBe('electrical');
    expect(profile.status).toBe('active');
    expect(profile.createdAt).toBeGreaterThan(0);
    expect(profile.updatedAt).toBe(profile.createdAt);

    const fetched = store.getById(profile.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.displayName).toBe('Bob Electrician');
    expect(fetched!.tags).toEqual(['licensed', 'bonded']);
  });

  // 2. search by category
  it('searches by category', () => {
    store.create(makeInput({ category: 'plumbing' }));
    store.create(makeInput({ displayName: 'Carol Roofer', category: 'roofing' }));

    const plumbers = store.search({ category: 'plumbing' });
    expect(plumbers).toHaveLength(1);
    expect(plumbers[0]!.category).toBe('plumbing');

    const roofers = store.search({ category: 'roofing' });
    expect(roofers).toHaveLength(1);
    expect(roofers[0]!.displayName).toBe('Carol Roofer');
  });

  // 3. search by state
  it('searches by state', () => {
    store.create(makeInput({ state: 'TX', city: 'Austin' }));
    store.create(makeInput({ displayName: 'Dave HVAC', category: 'hvac', state: 'CA', city: 'LA' }));

    const texans = store.search({ state: 'TX' });
    expect(texans).toHaveLength(1);
    expect(texans[0]!.state).toBe('TX');

    const californians = store.search({ state: 'CA' });
    expect(californians).toHaveLength(1);
    expect(californians[0]!.state).toBe('CA');
  });

  // 4. trust score calculation (verify formula)
  it('calculates trust score correctly with formula components', () => {
    // Base: 0.5 + responseRate*0.15 = 0.5 + 1.0*0.15 = 0.65
    const basic = store.create(makeInput());
    expect(basic.trustScore).toBeCloseTo(0.65, 5);

    // With successfulJobsCount=3: +0.15, preferred=true: +0.10, rating=5: +0.10
    // 0.5 + 0.15 (3 jobs) + 0.15 (response_rate) + 0.10 (preferred) + 0.10 (rating=5) = 1.0 clamped
    const highScorer = store.create(makeInput({
      successfulJobsCount: 3,
      preferred: true,
      userRatingInternal: 5,
      responseRate: 1.0,
    }));
    expect(highScorer.trustScore).toBeCloseTo(1.0, 5);

    // With declined=5 (cap -0.15), no_response=3 (cap -0.12)
    // 0.5 + 0.15 - 0.10 (5*0.02 capped at 0.15? no 5*0.02=0.10) - 0.12 (3*0.04) = 0.43
    const poorPerformer = store.create(makeInput({
      declinedJobsCount: 5,
      noResponseCount: 3,
      responseRate: 1.0,
    }));
    // 0.5 + 0.15 - 0.10 - 0.12 = 0.43
    expect(poorPerformer.trustScore).toBeCloseTo(0.43, 5);

    // declined cap: 8 * 0.02 = 0.16, capped at 0.15
    const declineCapped = store.create(makeInput({
      declinedJobsCount: 8,
      responseRate: 1.0,
    }));
    // 0.5 + 0.15 - 0.15 = 0.50
    expect(declineCapped.trustScore).toBeCloseTo(0.50, 5);

    // no_response cap: 6 * 0.04 = 0.24, capped at 0.20
    const noRespCapped = store.create(makeInput({
      noResponseCount: 6,
      responseRate: 1.0,
    }));
    // 0.5 + 0.15 - 0.20 = 0.45
    expect(noRespCapped.trustScore).toBeCloseTo(0.45, 5);

    // successful jobs cap: 6 * 0.05 = 0.30, capped at 0.25
    const jobsCapped = store.create(makeInput({
      successfulJobsCount: 6,
      responseRate: 1.0,
    }));
    // 0.5 + 0.25 + 0.15 = 0.90
    expect(jobsCapped.trustScore).toBeCloseTo(0.90, 5);
  });

  // 5. add interaction with outcome updates counts
  it('adds interaction with outcome and updates counts', () => {
    const profile = store.create(makeInput());
    const before = store.getById(profile.id)!;
    expect(before.successfulJobsCount).toBe(0);

    store.addInteraction(profile.id, {
      talentId: profile.id,
      type: 'outcome',
      content: 'Job completed successfully',
      outcome: 'success',
    });

    const after = store.getById(profile.id)!;
    expect(after.successfulJobsCount).toBe(1);
    expect(after.lastContactedAt).toBeGreaterThan(0);

    // declined outcome
    store.addInteraction(profile.id, {
      talentId: profile.id,
      type: 'outcome',
      content: 'Declined the job',
      outcome: 'declined',
    });
    const after2 = store.getById(profile.id)!;
    expect(after2.declinedJobsCount).toBe(1);

    // no_response outcome
    store.addInteraction(profile.id, {
      talentId: profile.id,
      type: 'outcome',
      content: 'Did not respond',
      outcome: 'no_response',
    });
    const after3 = store.getById(profile.id)!;
    expect(after3.noResponseCount).toBe(1);

    // List interactions
    const interactions = store.listInteractions(profile.id);
    expect(interactions).toHaveLength(3);
  });

  // 6. mark preferred updates trust score
  it('mark preferred updates trust score', () => {
    const profile = store.create(makeInput({ preferred: false }));
    const scoreBefore = profile.trustScore;

    const updated = store.update(profile.id, { preferred: true });
    expect(updated.preferred).toBe(true);
    // Should increase by 0.10
    expect(updated.trustScore).toBeCloseTo(scoreBefore + 0.10, 5);
  });

  // 7. block talent sets status
  it('blocks a talent profile by setting status', () => {
    const profile = store.create(makeInput({ status: 'active' }));
    expect(profile.status).toBe('active');

    const blocked = store.update(profile.id, { status: 'blocked' });
    expect(blocked.status).toBe('blocked');

    const fetched = store.getById(profile.id)!;
    expect(fetched.status).toBe('blocked');
  });

  // 8. listPendingOutreach returns only pending items
  it('listPendingOutreach returns only pending items', () => {
    const p1 = store.create(makeInput({ displayName: 'Eve Landscaper' }));
    const p2 = store.create(makeInput({ displayName: 'Frank Painter', category: 'painting' }));

    store.addOutreach(p1.id, { talentId: p1.id, messagePreview: 'Hello Eve', status: 'pending' });
    const o2 = store.addOutreach(p2.id, { talentId: p2.id, messagePreview: 'Hello Frank', status: 'pending' });

    // Approve one
    store.updateOutreach(o2.id, { status: 'approved' });

    const pending = store.listPendingOutreach();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.messagePreview).toBe('Hello Eve');
    expect(pending[0]!.status).toBe('pending');
  });

  // 8b. outreach status state machine — invalid transitions throw
  it('outreach state machine rejects invalid transitions', () => {
    const profile = store.create(makeInput());

    const outreach = store.addOutreach(profile.id, {
      talentId: profile.id,
      messagePreview: 'Test message',
      status: 'pending',
    });

    // Valid: pending → approved
    store.updateOutreach(outreach.id, { status: 'approved' });

    // Valid: approved → sent
    store.updateOutreach(outreach.id, { status: 'sent' });

    // Invalid: sent → pending (terminal state)
    expect(() => store.updateOutreach(outreach.id, { status: 'pending' }))
      .toThrow('Invalid outreach status transition: sent → pending');
  });

  // 8c. outreach state machine — pending cannot jump directly to sent
  it('outreach state machine rejects pending → sent (must go via approved)', () => {
    const profile = store.create(makeInput({ displayName: 'Zara Tester' }));
    const outreach = store.addOutreach(profile.id, {
      talentId: profile.id,
      messagePreview: 'Direct send attempt',
      status: 'pending',
    });

    expect(() => store.updateOutreach(outreach.id, { status: 'sent' }))
      .toThrow('Invalid outreach status transition: pending → sent');
  });

  // 9. search with query string matches display_name
  it('searches by query string matching display_name', () => {
    store.create(makeInput({ displayName: 'Greta Garcia Plumbing' }));
    store.create(makeInput({ displayName: 'Henry HVAC Services', category: 'hvac' }));

    const results = store.search({ query: 'Garcia' });
    expect(results).toHaveLength(1);
    expect(results[0]!.displayName).toBe('Greta Garcia Plumbing');
  });

  // 10. delete cascades interactions
  it('delete cascades to interactions', () => {
    const profile = store.create(makeInput());
    store.addInteraction(profile.id, {
      talentId: profile.id,
      type: 'note',
      content: 'Initial note',
    });
    store.addOutreach(profile.id, {
      talentId: profile.id,
      messagePreview: 'Test outreach',
      status: 'pending',
    });

    // Verify records exist
    expect(store.listInteractions(profile.id)).toHaveLength(1);
    expect(store.listOutreach(profile.id)).toHaveLength(1);

    store.delete(profile.id);

    // Profile should be gone
    expect(store.getById(profile.id)).toBeNull();

    // Cascaded rows should be gone
    const interactionRows = db
      .prepare('SELECT * FROM talent_interactions WHERE talent_id = ?')
      .all(profile.id);
    expect(interactionRows).toHaveLength(0);

    const outreachRows = db
      .prepare('SELECT * FROM talent_outreach WHERE talent_id = ?')
      .all(profile.id);
    expect(outreachRows).toHaveLength(0);
  });

  // Additional: update throws on missing id
  it('update throws when profile does not exist', () => {
    expect(() => store.update('nonexistent-id', { displayName: 'X' })).toThrow('not found');
  });

  // Additional: delete throws on missing id
  it('delete throws when profile does not exist', () => {
    expect(() => store.delete('nonexistent-id')).toThrow('not found');
  });

  // Additional: marketplace requests
  it('creates and resolves marketplace requests', () => {
    const profile = store.create(makeInput());

    const req = store.createRequest({ query: 'need a plumber urgently', urgency: 'high' });
    expect(req.id).toBeTruthy();
    expect(req.resolvedAt).toBeUndefined();

    store.resolveRequest(req.id, profile.id);
    const requests = store.listRequests();
    const found = requests.find(r => r.id === req.id)!;
    expect(found.resolvedAt).toBeGreaterThan(0);
    expect(found.resolvedTalentId).toBe(profile.id);
  });

  // Additional: recalculateTrustScore public method
  it('recalculateTrustScore updates score in DB and returns new value', () => {
    const profile = store.create(makeInput());
    const initialScore = profile.trustScore;

    // Directly update preferred flag in DB (bypass trustScore recalc path)
    db.prepare('UPDATE talent_profiles SET preferred = 1, updated_at = ? WHERE id = ?')
      .run(Date.now(), profile.id);

    const newScore = store.recalculateTrustScore(profile.id);
    expect(newScore).toBeCloseTo(initialScore + 0.10, 5);

    const fetched = store.getById(profile.id)!;
    expect(fetched.trustScore).toBeCloseTo(newScore, 5);
  });

  // Additional: search by city
  it('searches by city', () => {
    store.create(makeInput({ city: 'Austin', state: 'TX' }));
    store.create(makeInput({ displayName: 'Ivan Painter', category: 'painting', city: 'Houston', state: 'TX' }));

    const austinResults = store.search({ city: 'Austin' });
    expect(austinResults).toHaveLength(1);
    expect(austinResults[0]!.city).toBe('Austin');
  });

  // Additional: search by minTrustScore
  it('filters by minTrustScore', () => {
    // Default profile has trustScore ~0.65
    store.create(makeInput());
    // Low trust: lots of no-responses
    store.create(makeInput({
      displayName: 'Judy Low-Trust',
      noResponseCount: 5,
      responseRate: 0.2,
    }));

    const highTrust = store.search({ minTrustScore: 0.6 });
    expect(highTrust.every(p => p.trustScore >= 0.6)).toBe(true);
  });

  // Additional: addInteraction without outcome does not update counts
  it('interaction without outcome does not update job counts', () => {
    const profile = store.create(makeInput());

    store.addInteraction(profile.id, {
      talentId: profile.id,
      type: 'note',
      content: 'Just a note, no outcome',
    });

    const after = store.getById(profile.id)!;
    expect(after.successfulJobsCount).toBe(0);
    expect(after.declinedJobsCount).toBe(0);
    expect(after.noResponseCount).toBe(0);
    // last_contacted_at still gets updated
    expect(after.lastContactedAt).toBeGreaterThan(0);
  });

  // Additional: listInteractions respects limit
  it('listInteractions respects limit', () => {
    const profile = store.create(makeInput());
    for (let i = 0; i < 5; i++) {
      store.addInteraction(profile.id, {
        talentId: profile.id,
        type: 'note',
        content: `Note ${i}`,
      });
    }
    const limited = store.listInteractions(profile.id, 3);
    expect(limited).toHaveLength(3);
  });

  // Additional: recency boost in trust score
  it('applies recency boost when last_used_at is within 90 days', () => {
    const recentUsedAt = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago
    const withRecency = store.create(makeInput({ lastUsedAt: recentUsedAt }));

    const withoutRecency = store.create(makeInput({
      displayName: 'No Recent Use',
      lastUsedAt: undefined,
    }));

    // withRecency should have +0.05 boost vs withoutRecency (all else equal)
    expect(withRecency.trustScore).toBeCloseTo(withoutRecency.trustScore + 0.05, 5);
  });
});
