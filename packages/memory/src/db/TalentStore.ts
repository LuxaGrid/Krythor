/**
 * TalentStore — persistence layer for the Talent Marketplace feature.
 *
 * Stores talent profiles, interactions, outreach records, and marketplace
 * requests. All JSON array/object fields are serialised to TEXT in SQLite and
 * deserialised on read. Snake_case DB rows map to camelCase TS types.
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TalentStatus = 'active' | 'inactive' | 'blocked';
export type TalentSource = 'manual' | 'import' | 'referral' | 'agent';
export type InteractionType = 'note' | 'outreach' | 'outcome' | 'availability_request';
export type InteractionOutcome = 'success' | 'declined' | 'no_response' | 'pending';
export type OutreachStatus = 'pending' | 'approved' | 'sent' | 'denied';

export interface TalentProfile {
  id: string;
  displayName: string;
  companyName?: string;
  category: string;
  subcategory?: string;
  tags: string[];
  description?: string;
  serviceAreas: string[];
  city?: string;
  state?: string;
  zip?: string;
  contactMethods: Record<string, string>;
  email?: string;
  phone?: string;
  website?: string;
  preferredChannels: string[];
  licensingInfo?: string;
  insuranceInfo?: string;
  availabilityNotes?: string;
  pricingNotes?: string;
  hourlyRateCents?: number;
  costBand?: string;
  specialties: string[];
  languages: string[];
  status: TalentStatus;
  source: TalentSource;
  notes?: string;
  avgResponseTimeHours?: number;
  responseRate: number;
  successfulJobsCount: number;
  declinedJobsCount: number;
  noResponseCount: number;
  userRatingInternal?: number;
  trustScore: number;
  lastUsedAt?: number;
  lastContactedAt?: number;
  internalOutcomeNotes?: string;
  preferred: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TalentInteraction {
  id: string;
  talentId: string;
  type: InteractionType;
  agentId?: string;
  content: string;
  outcome?: InteractionOutcome;
  rating?: number;
  createdAt: number;
}

export interface TalentOutreach {
  id: string;
  talentId: string;
  channel?: string;
  messagePreview: string;
  status: OutreachStatus;
  approvalId?: string;
  approvedBy?: string;
  sentAt?: number;
  createdAt: number;
}

export interface MarketplaceRequest {
  id: string;
  query: string;
  category?: string;
  location?: string;
  urgency?: string;
  createdAt: number;
  resolvedAt?: number;
  resolvedTalentId?: string;
}

export type CreateTalentInput = Omit<TalentProfile, 'id' | 'createdAt' | 'updatedAt' | 'trustScore' | 'responseRate' | 'successfulJobsCount' | 'declinedJobsCount' | 'noResponseCount' | 'preferred'> & Partial<Pick<TalentProfile, 'trustScore' | 'responseRate' | 'successfulJobsCount' | 'declinedJobsCount' | 'noResponseCount' | 'preferred'>>;
export type UpdateTalentInput = Partial<Omit<TalentProfile, 'id' | 'createdAt' | 'updatedAt'>>;

export interface TalentSearchFilter {
  query?: string;
  category?: string;
  state?: string;
  city?: string;
  status?: TalentStatus;
  preferred?: boolean;
  tags?: string[];
  minTrustScore?: number;
  limit?: number;
  offset?: number;
}

// ─── Row types (SQLite snake_case) ────────────────────────────────────────────

interface ProfileRow {
  id: string;
  display_name: string;
  company_name: string | null;
  category: string;
  subcategory: string | null;
  tags: string;
  description: string | null;
  service_areas: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  contact_methods: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  preferred_channels: string;
  licensing_info: string | null;
  insurance_info: string | null;
  availability_notes: string | null;
  pricing_notes: string | null;
  hourly_rate_cents: number | null;
  cost_band: string | null;
  specialties: string;
  languages: string;
  status: string;
  source: string;
  notes: string | null;
  avg_response_time_hours: number | null;
  response_rate: number;
  successful_jobs_count: number;
  declined_jobs_count: number;
  no_response_count: number;
  user_rating_internal: number | null;
  trust_score: number;
  last_used_at: number | null;
  last_contacted_at: number | null;
  internal_outcome_notes: string | null;
  preferred: number;
  created_at: number;
  updated_at: number;
}

interface InteractionRow {
  id: string;
  talent_id: string;
  type: string;
  agent_id: string | null;
  content: string;
  outcome: string | null;
  rating: number | null;
  created_at: number;
}

interface OutreachRow {
  id: string;
  talent_id: string;
  channel: string | null;
  message_preview: string;
  status: string;
  approval_id: string | null;
  approved_by: string | null;
  sent_at: number | null;
  created_at: number;
}

interface RequestRow {
  id: string;
  query: string;
  category: string | null;
  location: string | null;
  urgency: string | null;
  created_at: number;
  resolved_at: number | null;
  resolved_talent_id: string | null;
}

// ─── TalentStore ──────────────────────────────────────────────────────────────

export class TalentStore {
  private readonly insertProfile: Database.Statement;
  private readonly updateProfile: Database.Statement;
  private readonly deleteProfile: Database.Statement;
  private readonly selectProfileById: Database.Statement;
  private readonly updateTrustScore: Database.Statement;

  private readonly insertInteraction: Database.Statement;
  private readonly selectInteractionsByTalent: Database.Statement;
  private readonly updateContactedAt: Database.Statement;
  private readonly updateOutcomeCounts: Database.Statement;

  private readonly insertOutreach: Database.Statement;
  private readonly selectOutreachById: Database.Statement;
  private readonly updateOutreachStmt: Database.Statement;
  private readonly selectOutreachByTalent: Database.Statement;
  private readonly selectPendingOutreach: Database.Statement;

  private readonly insertRequest: Database.Statement;
  private readonly resolveRequestStmt: Database.Statement;
  private readonly selectRequests: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.insertProfile = db.prepare(`
      INSERT INTO talent_profiles (
        id, display_name, company_name, category, subcategory, tags, description,
        service_areas, city, state, zip, contact_methods, email, phone, website,
        preferred_channels, licensing_info, insurance_info, availability_notes,
        pricing_notes, hourly_rate_cents, cost_band, specialties, languages,
        status, source, notes, avg_response_time_hours, response_rate,
        successful_jobs_count, declined_jobs_count, no_response_count,
        user_rating_internal, trust_score, last_used_at, last_contacted_at,
        internal_outcome_notes, preferred, created_at, updated_at
      ) VALUES (
        @id, @display_name, @company_name, @category, @subcategory, @tags, @description,
        @service_areas, @city, @state, @zip, @contact_methods, @email, @phone, @website,
        @preferred_channels, @licensing_info, @insurance_info, @availability_notes,
        @pricing_notes, @hourly_rate_cents, @cost_band, @specialties, @languages,
        @status, @source, @notes, @avg_response_time_hours, @response_rate,
        @successful_jobs_count, @declined_jobs_count, @no_response_count,
        @user_rating_internal, @trust_score, @last_used_at, @last_contacted_at,
        @internal_outcome_notes, @preferred, @created_at, @updated_at
      )
    `);

    this.updateProfile = db.prepare(`
      UPDATE talent_profiles SET
        display_name = @display_name,
        company_name = @company_name,
        category = @category,
        subcategory = @subcategory,
        tags = @tags,
        description = @description,
        service_areas = @service_areas,
        city = @city,
        state = @state,
        zip = @zip,
        contact_methods = @contact_methods,
        email = @email,
        phone = @phone,
        website = @website,
        preferred_channels = @preferred_channels,
        licensing_info = @licensing_info,
        insurance_info = @insurance_info,
        availability_notes = @availability_notes,
        pricing_notes = @pricing_notes,
        hourly_rate_cents = @hourly_rate_cents,
        cost_band = @cost_band,
        specialties = @specialties,
        languages = @languages,
        status = @status,
        source = @source,
        notes = @notes,
        avg_response_time_hours = @avg_response_time_hours,
        response_rate = @response_rate,
        successful_jobs_count = @successful_jobs_count,
        declined_jobs_count = @declined_jobs_count,
        no_response_count = @no_response_count,
        user_rating_internal = @user_rating_internal,
        trust_score = @trust_score,
        last_used_at = @last_used_at,
        last_contacted_at = @last_contacted_at,
        internal_outcome_notes = @internal_outcome_notes,
        preferred = @preferred,
        updated_at = @updated_at
      WHERE id = @id
    `);

    this.deleteProfile = db.prepare('DELETE FROM talent_profiles WHERE id = ?');
    this.selectProfileById = db.prepare('SELECT * FROM talent_profiles WHERE id = ?');
    this.updateTrustScore = db.prepare('UPDATE talent_profiles SET trust_score = ?, updated_at = ? WHERE id = ?');

    this.insertInteraction = db.prepare(`
      INSERT INTO talent_interactions (id, talent_id, type, agent_id, content, outcome, rating, created_at)
      VALUES (@id, @talent_id, @type, @agent_id, @content, @outcome, @rating, @created_at)
    `);
    this.selectInteractionsByTalent = db.prepare(
      'SELECT * FROM talent_interactions WHERE talent_id = ? ORDER BY created_at DESC LIMIT ?'
    );
    this.updateContactedAt = db.prepare(
      'UPDATE talent_profiles SET last_contacted_at = ?, updated_at = ? WHERE id = ?'
    );
    this.updateOutcomeCounts = db.prepare(`
      UPDATE talent_profiles SET
        successful_jobs_count = successful_jobs_count + @success_delta,
        declined_jobs_count   = declined_jobs_count   + @declined_delta,
        no_response_count     = no_response_count     + @no_response_delta,
        updated_at            = @updated_at
      WHERE id = @id
    `);

    this.insertOutreach = db.prepare(`
      INSERT INTO talent_outreach (id, talent_id, channel, message_preview, status, approval_id, approved_by, sent_at, created_at)
      VALUES (@id, @talent_id, @channel, @message_preview, @status, @approval_id, @approved_by, @sent_at, @created_at)
    `);
    this.selectOutreachById = db.prepare('SELECT * FROM talent_outreach WHERE id = ?');
    this.updateOutreachStmt = db.prepare(`
      UPDATE talent_outreach SET
        status = @status,
        approval_id = @approval_id,
        approved_by = @approved_by,
        sent_at = @sent_at
      WHERE id = @id
    `);
    this.selectOutreachByTalent = db.prepare(
      'SELECT * FROM talent_outreach WHERE talent_id = ? ORDER BY created_at DESC'
    );
    this.selectPendingOutreach = db.prepare(
      "SELECT * FROM talent_outreach WHERE status = 'pending' ORDER BY created_at ASC"
    );

    this.insertRequest = db.prepare(`
      INSERT INTO marketplace_requests (id, query, category, location, urgency, created_at, resolved_at, resolved_talent_id)
      VALUES (@id, @query, @category, @location, @urgency, @created_at, @resolved_at, @resolved_talent_id)
    `);
    this.resolveRequestStmt = db.prepare(
      'UPDATE marketplace_requests SET resolved_at = ?, resolved_talent_id = ? WHERE id = ?'
    );
    this.selectRequests = db.prepare(
      'SELECT * FROM marketplace_requests ORDER BY created_at DESC LIMIT ?'
    );
  }

  // ── Profiles ──────────────────────────────────────────────────────────────

  create(input: CreateTalentInput): TalentProfile {
    const now = Date.now();
    const profile: TalentProfile = {
      id: randomUUID(),
      displayName: input.displayName,
      companyName: input.companyName,
      category: input.category,
      subcategory: input.subcategory,
      tags: input.tags ?? [],
      description: input.description,
      serviceAreas: input.serviceAreas ?? [],
      city: input.city,
      state: input.state,
      zip: input.zip,
      contactMethods: input.contactMethods ?? {},
      email: input.email,
      phone: input.phone,
      website: input.website,
      preferredChannels: input.preferredChannels ?? [],
      licensingInfo: input.licensingInfo,
      insuranceInfo: input.insuranceInfo,
      availabilityNotes: input.availabilityNotes,
      pricingNotes: input.pricingNotes,
      hourlyRateCents: input.hourlyRateCents,
      costBand: input.costBand,
      specialties: input.specialties ?? [],
      languages: input.languages ?? [],
      status: input.status ?? 'active',
      source: input.source ?? 'manual',
      notes: input.notes,
      avgResponseTimeHours: input.avgResponseTimeHours,
      responseRate: input.responseRate ?? 1.0,
      successfulJobsCount: input.successfulJobsCount ?? 0,
      declinedJobsCount: input.declinedJobsCount ?? 0,
      noResponseCount: input.noResponseCount ?? 0,
      userRatingInternal: input.userRatingInternal,
      trustScore: 0.5,
      lastUsedAt: input.lastUsedAt,
      lastContactedAt: input.lastContactedAt,
      internalOutcomeNotes: input.internalOutcomeNotes,
      preferred: input.preferred ?? false,
      createdAt: now,
      updatedAt: now,
    };

    // Calculate initial trust score from provided counters / rating
    profile.trustScore = this.computeTrustScore(profile);

    this.insertProfile.run(this.profileToRow(profile));
    return profile;
  }

  update(id: string, input: UpdateTalentInput): TalentProfile {
    const existing = this.getById(id);
    if (!existing) throw new Error(`TalentProfile "${id}" not found`);

    const merged: TalentProfile = {
      ...existing,
      ...input,
      id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };

    // Recalculate trust score whenever anything changes
    merged.trustScore = this.computeTrustScore(merged);

    this.updateProfile.run(this.profileToRow(merged));
    return merged;
  }

  delete(id: string): void {
    const existing = this.getById(id);
    if (!existing) throw new Error(`TalentProfile "${id}" not found`);
    this.deleteProfile.run(id);
  }

  getById(id: string): TalentProfile | null {
    const row = this.selectProfileById.get(id) as ProfileRow | undefined;
    return row ? this.rowToProfile(row) : null;
  }

  search(filter: TalentSearchFilter = {}): TalentProfile[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.category) {
      conditions.push('category = ?');
      params.push(filter.category);
    }
    if (filter.state) {
      conditions.push('state = ?');
      params.push(filter.state);
    }
    if (filter.city) {
      conditions.push('city = ?');
      params.push(filter.city);
    }
    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter.preferred !== undefined) {
      conditions.push('preferred = ?');
      params.push(filter.preferred ? 1 : 0);
    }
    if (filter.minTrustScore !== undefined) {
      conditions.push('trust_score >= ?');
      params.push(filter.minTrustScore);
    }
    if (filter.query) {
      const q = `%${filter.query}%`;
      conditions.push(
        '(display_name LIKE ? OR company_name LIKE ? OR description LIKE ? OR tags LIKE ? OR specialties LIKE ?)'
      );
      params.push(q, q, q, q, q);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filter.limit ?? 100, 1000);
    const offset = filter.offset ?? 0;

    const sql = `SELECT * FROM talent_profiles ${where} ORDER BY trust_score DESC, display_name ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as ProfileRow[];
    let results = rows.map(r => this.rowToProfile(r));

    // Post-filter by tags array (each requested tag must appear in profile tags)
    if (filter.tags && filter.tags.length > 0) {
      results = results.filter(p =>
        filter.tags!.every(t => p.tags.includes(t))
      );
    }

    return results;
  }

  // ── Trust score ───────────────────────────────────────────────────────────

  recalculateTrustScore(id: string): number {
    const profile = this.getById(id);
    if (!profile) throw new Error(`TalentProfile "${id}" not found`);
    const score = this.computeTrustScore(profile);
    this.updateTrustScore.run(score, Date.now(), id);
    return score;
  }

  private computeTrustScore(p: {
    successfulJobsCount: number;
    responseRate: number;
    declinedJobsCount: number;
    noResponseCount: number;
    preferred: boolean;
    userRatingInternal?: number;
    lastUsedAt?: number;
  }): number {
    let score = 0.5;

    // Successful jobs: +0.05 each, capped at +0.25
    score += Math.min(p.successfulJobsCount * 0.05, 0.25);

    // Response rate contribution: up to +0.15
    score += p.responseRate * 0.15;

    // Declined jobs: -0.02 each, capped at -0.15
    score -= Math.min(p.declinedJobsCount * 0.02, 0.15);

    // No response: -0.04 each, capped at -0.20
    score -= Math.min(p.noResponseCount * 0.04, 0.20);

    // Preferred bonus
    if (p.preferred) score += 0.10;

    // User rating: 1–5 scale, neutral at 3
    if (p.userRatingInternal !== undefined && p.userRatingInternal !== null) {
      score += (p.userRatingInternal - 3) * 0.05;
    }

    // Recency boost: last used within 90 days
    if (p.lastUsedAt !== undefined && p.lastUsedAt !== null) {
      const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
      if (Date.now() - p.lastUsedAt <= ninetyDaysMs) {
        score += 0.05;
      }
    }

    // Clamp to [0, 1]
    return Math.max(0.0, Math.min(1.0, score));
  }

  // ── Interactions ──────────────────────────────────────────────────────────

  addInteraction(
    talentId: string,
    input: Omit<TalentInteraction, 'id' | 'createdAt'>
  ): TalentInteraction {
    const profile = this.getById(talentId);
    if (!profile) throw new Error(`TalentProfile "${talentId}" not found`);

    const now = Date.now();
    const interaction: TalentInteraction = {
      id: randomUUID(),
      talentId,
      type: input.type,
      agentId: input.agentId,
      content: input.content,
      outcome: input.outcome,
      rating: input.rating,
      createdAt: now,
    };

    this.insertInteraction.run({
      id:         interaction.id,
      talent_id:  talentId,
      type:       interaction.type,
      agent_id:   interaction.agentId ?? null,
      content:    interaction.content,
      outcome:    interaction.outcome ?? null,
      rating:     interaction.rating ?? null,
      created_at: now,
    });

    // Update last_contacted_at
    this.updateContactedAt.run(now, now, talentId);

    // Update outcome counters and recalculate trust score
    if (input.outcome === 'success' || input.outcome === 'declined' || input.outcome === 'no_response') {
      this.updateOutcomeCounts.run({
        success_delta:     input.outcome === 'success'     ? 1 : 0,
        declined_delta:    input.outcome === 'declined'    ? 1 : 0,
        no_response_delta: input.outcome === 'no_response' ? 1 : 0,
        updated_at:        now,
        id:                talentId,
      });
      this.recalculateTrustScore(talentId);
    }

    return interaction;
  }

  listInteractions(talentId: string, limit = 100): TalentInteraction[] {
    const rows = this.selectInteractionsByTalent.all(talentId, Math.min(limit, 1000)) as InteractionRow[];
    return rows.map(r => this.rowToInteraction(r));
  }

  // ── Outreach ──────────────────────────────────────────────────────────────

  addOutreach(
    talentId: string,
    input: Omit<TalentOutreach, 'id' | 'createdAt'>
  ): TalentOutreach {
    const profile = this.getById(talentId);
    if (!profile) throw new Error(`TalentProfile "${talentId}" not found`);

    const now = Date.now();
    const outreach: TalentOutreach = {
      id: randomUUID(),
      talentId,
      channel: input.channel,
      messagePreview: input.messagePreview,
      status: input.status ?? 'pending',
      approvalId: input.approvalId,
      approvedBy: input.approvedBy,
      sentAt: input.sentAt,
      createdAt: now,
    };

    this.insertOutreach.run({
      id:              outreach.id,
      talent_id:       talentId,
      channel:         outreach.channel ?? null,
      message_preview: outreach.messagePreview,
      status:          outreach.status,
      approval_id:     outreach.approvalId ?? null,
      approved_by:     outreach.approvedBy ?? null,
      sent_at:         outreach.sentAt ?? null,
      created_at:      now,
    });

    return outreach;
  }

  updateOutreach(
    id: string,
    input: Partial<Pick<TalentOutreach, 'status' | 'approvalId' | 'approvedBy' | 'sentAt'>>
  ): TalentOutreach {
    const row = this.selectOutreachById.get(id) as OutreachRow | undefined;
    if (!row) throw new Error(`TalentOutreach "${id}" not found`);

    const existing = this.rowToOutreach(row);
    const updated: TalentOutreach = {
      ...existing,
      ...input,
    };

    this.updateOutreachStmt.run({
      id,
      status:      updated.status,
      approval_id: updated.approvalId ?? null,
      approved_by: updated.approvedBy ?? null,
      sent_at:     updated.sentAt ?? null,
    });

    return updated;
  }

  listOutreach(talentId: string): TalentOutreach[] {
    const rows = this.selectOutreachByTalent.all(talentId) as OutreachRow[];
    return rows.map(r => this.rowToOutreach(r));
  }

  listPendingOutreach(): TalentOutreach[] {
    const rows = this.selectPendingOutreach.all() as OutreachRow[];
    return rows.map(r => this.rowToOutreach(r));
  }

  // ── Marketplace requests ──────────────────────────────────────────────────

  createRequest(input: Omit<MarketplaceRequest, 'id' | 'createdAt'>): MarketplaceRequest {
    const now = Date.now();
    const request: MarketplaceRequest = {
      id: randomUUID(),
      query: input.query,
      category: input.category,
      location: input.location,
      urgency: input.urgency,
      createdAt: now,
      resolvedAt: input.resolvedAt,
      resolvedTalentId: input.resolvedTalentId,
    };

    this.insertRequest.run({
      id:                 request.id,
      query:              request.query,
      category:           request.category ?? null,
      location:           request.location ?? null,
      urgency:            request.urgency ?? null,
      created_at:         now,
      resolved_at:        request.resolvedAt ?? null,
      resolved_talent_id: request.resolvedTalentId ?? null,
    });

    return request;
  }

  resolveRequest(id: string, talentId: string): void {
    this.resolveRequestStmt.run(Date.now(), talentId, id);
  }

  listRequests(limit = 50): MarketplaceRequest[] {
    const rows = this.selectRequests.all(Math.min(limit, 1000)) as RequestRow[];
    return rows.map(r => this.rowToRequest(r));
  }

  // ── Row mappers ───────────────────────────────────────────────────────────

  private profileToRow(p: TalentProfile): Record<string, unknown> {
    return {
      id:                    p.id,
      display_name:          p.displayName,
      company_name:          p.companyName ?? null,
      category:              p.category,
      subcategory:           p.subcategory ?? null,
      tags:                  JSON.stringify(p.tags),
      description:           p.description ?? null,
      service_areas:         JSON.stringify(p.serviceAreas),
      city:                  p.city ?? null,
      state:                 p.state ?? null,
      zip:                   p.zip ?? null,
      contact_methods:       JSON.stringify(p.contactMethods),
      email:                 p.email ?? null,
      phone:                 p.phone ?? null,
      website:               p.website ?? null,
      preferred_channels:    JSON.stringify(p.preferredChannels),
      licensing_info:        p.licensingInfo ?? null,
      insurance_info:        p.insuranceInfo ?? null,
      availability_notes:    p.availabilityNotes ?? null,
      pricing_notes:         p.pricingNotes ?? null,
      hourly_rate_cents:     p.hourlyRateCents ?? null,
      cost_band:             p.costBand ?? null,
      specialties:           JSON.stringify(p.specialties),
      languages:             JSON.stringify(p.languages),
      status:                p.status,
      source:                p.source,
      notes:                 p.notes ?? null,
      avg_response_time_hours: p.avgResponseTimeHours ?? null,
      response_rate:         p.responseRate,
      successful_jobs_count: p.successfulJobsCount,
      declined_jobs_count:   p.declinedJobsCount,
      no_response_count:     p.noResponseCount,
      user_rating_internal:  p.userRatingInternal ?? null,
      trust_score:           p.trustScore,
      last_used_at:          p.lastUsedAt ?? null,
      last_contacted_at:     p.lastContactedAt ?? null,
      internal_outcome_notes: p.internalOutcomeNotes ?? null,
      preferred:             p.preferred ? 1 : 0,
      created_at:            p.createdAt,
      updated_at:            p.updatedAt,
    };
  }

  private rowToProfile(row: ProfileRow): TalentProfile {
    return {
      id:                   row.id,
      displayName:          row.display_name,
      companyName:          row.company_name ?? undefined,
      category:             row.category,
      subcategory:          row.subcategory ?? undefined,
      tags:                 this.parseJson<string[]>(row.tags, []),
      description:          row.description ?? undefined,
      serviceAreas:         this.parseJson<string[]>(row.service_areas, []),
      city:                 row.city ?? undefined,
      state:                row.state ?? undefined,
      zip:                  row.zip ?? undefined,
      contactMethods:       this.parseJson<Record<string, string>>(row.contact_methods, {}),
      email:                row.email ?? undefined,
      phone:                row.phone ?? undefined,
      website:              row.website ?? undefined,
      preferredChannels:    this.parseJson<string[]>(row.preferred_channels, []),
      licensingInfo:        row.licensing_info ?? undefined,
      insuranceInfo:        row.insurance_info ?? undefined,
      availabilityNotes:    row.availability_notes ?? undefined,
      pricingNotes:         row.pricing_notes ?? undefined,
      hourlyRateCents:      row.hourly_rate_cents ?? undefined,
      costBand:             row.cost_band ?? undefined,
      specialties:          this.parseJson<string[]>(row.specialties, []),
      languages:            this.parseJson<string[]>(row.languages, []),
      status:               row.status as TalentStatus,
      source:               row.source as TalentSource,
      notes:                row.notes ?? undefined,
      avgResponseTimeHours: row.avg_response_time_hours ?? undefined,
      responseRate:         row.response_rate,
      successfulJobsCount:  row.successful_jobs_count,
      declinedJobsCount:    row.declined_jobs_count,
      noResponseCount:      row.no_response_count,
      userRatingInternal:   row.user_rating_internal ?? undefined,
      trustScore:           row.trust_score,
      lastUsedAt:           row.last_used_at ?? undefined,
      lastContactedAt:      row.last_contacted_at ?? undefined,
      internalOutcomeNotes: row.internal_outcome_notes ?? undefined,
      preferred:            row.preferred === 1,
      createdAt:            row.created_at,
      updatedAt:            row.updated_at,
    };
  }

  private rowToInteraction(row: InteractionRow): TalentInteraction {
    return {
      id:        row.id,
      talentId:  row.talent_id,
      type:      row.type as InteractionType,
      agentId:   row.agent_id ?? undefined,
      content:   row.content,
      outcome:   row.outcome as InteractionOutcome | undefined ?? undefined,
      rating:    row.rating ?? undefined,
      createdAt: row.created_at,
    };
  }

  private rowToOutreach(row: OutreachRow): TalentOutreach {
    return {
      id:             row.id,
      talentId:       row.talent_id,
      channel:        row.channel ?? undefined,
      messagePreview: row.message_preview,
      status:         row.status as OutreachStatus,
      approvalId:     row.approval_id ?? undefined,
      approvedBy:     row.approved_by ?? undefined,
      sentAt:         row.sent_at ?? undefined,
      createdAt:      row.created_at,
    };
  }

  private rowToRequest(row: RequestRow): MarketplaceRequest {
    return {
      id:               row.id,
      query:            row.query,
      category:         row.category ?? undefined,
      location:         row.location ?? undefined,
      urgency:          row.urgency ?? undefined,
      createdAt:        row.created_at,
      resolvedAt:       row.resolved_at ?? undefined,
      resolvedTalentId: row.resolved_talent_id ?? undefined,
    };
  }

  private parseJson<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }
}
