/**
 * MarketplaceRankingEngine — scores talent profiles against a request.
 *
 * Scoring dimensions (total up to 100 pts):
 *   Category fit    0–30
 *   Geography fit   0–20
 *   Trust score     0–25
 *   Response history 0–15
 *   Recency         0–5
 *   Preferred bonus 0–5
 *   Penalties       (negative)
 */

import type { TalentProfile } from '@krythor/memory';

export interface RankInput {
  query: string;
  category?: string;
  location?: string;
  urgency?: 'low' | 'medium' | 'high';
  budget?: number;
  tags?: string[];
}

export interface RankDimension {
  score: number;
  reason: string;
}

export interface RankPenalties {
  score: number;
  reasons: string[];
}

export interface RankExplanation {
  categoryFit: RankDimension;
  geographyFit: RankDimension;
  trustScore: RankDimension;
  responseHistory: RankDimension;
  recency: RankDimension;
  preferredBonus: RankDimension;
  penalties: RankPenalties;
  summary: string;
}

export interface RankResult {
  talent: TalentProfile;
  score: number;
  explanation: RankExplanation;
}

export class MarketplaceRankingEngine {
  rank(candidates: TalentProfile[], input: RankInput): RankResult[] {
    const results: RankResult[] = [];

    for (const talent of candidates) {
      // Blocked talents are excluded entirely
      if (talent.status === 'blocked') continue;

      const categoryFit  = this.scoreCategoryFit(talent, input);
      const geographyFit = this.scoreGeographyFit(talent, input);
      const trust        = this.scoreTrust(talent);
      const response     = this.scoreResponseHistory(talent, input);
      const recency      = this.scoreRecency(talent, input);
      const preferred    = this.scorePreferred(talent);
      const penalties    = this.scorePenalties(talent);

      const raw = categoryFit.score + geographyFit.score + trust.score +
                  response.score + recency.score + preferred.score + penalties.score;

      // Clamp to [0, 100]
      const score = Math.max(0, Math.min(100, raw));

      const summary = this.buildSummary(talent, score, categoryFit, geographyFit, trust, penalties);

      results.push({
        talent,
        score,
        explanation: {
          categoryFit,
          geographyFit,
          trustScore: trust,
          responseHistory: response,
          recency,
          preferredBonus: preferred,
          penalties,
          summary,
        },
      });
    }

    // Sort descending by score, then alphabetically by name
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.talent.displayName.localeCompare(b.talent.displayName);
    });

    return results;
  }

  // ── Category fit (0–30) ─────────────────────────────────────────────────

  private scoreCategoryFit(talent: TalentProfile, input: RankInput): RankDimension {
    if (!input.category) {
      return { score: 10, reason: 'No category specified; neutral score applied' };
    }

    const reqCat = input.category.toLowerCase();
    const talCat = talent.category.toLowerCase();
    const talSub = (talent.subcategory ?? '').toLowerCase();

    // Exact match on category
    if (talCat === reqCat) {
      return { score: 30, reason: `Exact category match: "${talent.category}"` };
    }

    // Subcategory match
    if (talSub && talSub === reqCat) {
      return { score: 15, reason: `Subcategory match: "${talent.subcategory}"` };
    }

    // Tag overlap — up to 15 pts (5 per tag)
    const requestTags = (input.tags ?? []).map(t => t.toLowerCase());
    const talentTags  = talent.tags.map(t => t.toLowerCase());
    const overlap     = requestTags.filter(t => talentTags.includes(t));
    if (overlap.length > 0) {
      const pts = Math.min(overlap.length * 5, 15);
      return {
        score: pts,
        reason: `Tag overlap (${overlap.length} tag${overlap.length > 1 ? 's' : ''}): ${overlap.slice(0, 3).join(', ')}`,
      };
    }

    // Partial string match in category / tags / specialties
    const haystack = [talCat, talSub, ...talent.tags.map(t => t.toLowerCase()), ...talent.specialties.map(s => s.toLowerCase())].join(' ');
    if (haystack.includes(reqCat)) {
      return { score: 8, reason: `Partial category relevance to "${input.category}"` };
    }

    return { score: 0, reason: `No match for category "${input.category}"` };
  }

  // ── Geography fit (0–20) ────────────────────────────────────────────────

  private scoreGeographyFit(talent: TalentProfile, input: RankInput): RankDimension {
    if (!input.location) {
      return { score: 8, reason: 'No location specified; neutral score applied' };
    }

    const loc = input.location.toLowerCase();

    // City match
    if (talent.city && talent.city.toLowerCase() === loc) {
      return { score: 20, reason: `City match: ${talent.city}` };
    }

    // State match
    if (talent.state && talent.state.toLowerCase() === loc) {
      return { score: 10, reason: `State match: ${talent.state}` };
    }

    // Service area contains location
    const areaMatch = talent.serviceAreas.some(a => a.toLowerCase().includes(loc) || loc.includes(a.toLowerCase()));
    if (areaMatch) {
      return { score: 15, reason: `Location within service area` };
    }

    // Partial city/state match
    if (
      (talent.city && talent.city.toLowerCase().includes(loc)) ||
      (talent.state && talent.state.toLowerCase().includes(loc))
    ) {
      return { score: 5, reason: `Partial location match` };
    }

    return { score: 0, reason: `Location "${input.location}" not in service area` };
  }

  // ── Trust score (0–25) ──────────────────────────────────────────────────

  private scoreTrust(talent: TalentProfile): RankDimension {
    const pts = Math.round(talent.trustScore * 25);
    return {
      score: pts,
      reason: `Trust score ${(talent.trustScore * 100).toFixed(0)}% → ${pts} pts`,
    };
  }

  // ── Response history (0–15, +3 urgency bonus for high) ─────────────────

  private scoreResponseHistory(talent: TalentProfile, input: RankInput): RankDimension {
    const ratePts = Math.round(talent.responseRate * 10);
    let speedPts = 0;
    let speedNote = 'no response time data';
    if (talent.avgResponseTimeHours !== undefined && talent.avgResponseTimeHours !== null) {
      if (talent.avgResponseTimeHours < 24) {
        speedPts = 5;
        speedNote = `responds within ${talent.avgResponseTimeHours.toFixed(0)}h`;
      } else if (talent.avgResponseTimeHours < 72) {
        speedPts = 2;
        speedNote = `responds within ${talent.avgResponseTimeHours.toFixed(0)}h`;
      } else {
        speedNote = `slow response (~${talent.avgResponseTimeHours.toFixed(0)}h)`;
      }
    }

    // Urgency response-time bonus: only for high urgency (max +3 pts)
    let urgencyBonus = 0;
    let urgencyNote = '';
    if (input.urgency === 'high' && talent.avgResponseTimeHours !== undefined && talent.avgResponseTimeHours !== null) {
      if (talent.avgResponseTimeHours < 4) {
        urgencyBonus = 3;
        urgencyNote = `high urgency: responds <4h (+3)`;
      } else if (talent.avgResponseTimeHours < 12) {
        urgencyBonus = 2;
        urgencyNote = `high urgency: responds <12h (+2)`;
      } else if (talent.avgResponseTimeHours < 24) {
        urgencyBonus = 1;
        urgencyNote = `high urgency: responds <24h (+1)`;
      } else {
        urgencyNote = `high urgency: responds ≥24h (+0)`;
      }
    }

    const pts = ratePts + speedPts + urgencyBonus;
    const urgencyPart = urgencyNote ? `; ${urgencyNote}` : '';
    return {
      score: Math.min(pts, 15),
      reason: `Response rate ${(talent.responseRate * 100).toFixed(0)}% (${ratePts} pts), ${speedNote} (${speedPts} pts)${urgencyPart}`,
    };
  }

  // ── Recency (0–5) ───────────────────────────────────────────────────────

  private scoreRecency(talent: TalentProfile, input: RankInput): RankDimension {
    if (!talent.lastUsedAt) {
      return { score: 0, reason: 'Never used' };
    }
    const daysSince = (Date.now() - talent.lastUsedAt) / (1000 * 60 * 60 * 24);
    const urgency = input.urgency ?? 'medium';

    if (urgency === 'high') {
      // Tighter windows — prefer recently active talent
      if (daysSince <= 7)  return { score: 5, reason: `Used ${Math.round(daysSince)}d ago (within 7d; high urgency)` };
      if (daysSince <= 14) return { score: 3, reason: `Used ${Math.round(daysSince)}d ago (within 14d; high urgency)` };
      if (daysSince <= 30) return { score: 1, reason: `Used ${Math.round(daysSince)}d ago (within 30d; high urgency)` };
      return { score: 0, reason: `Last used ${Math.round(daysSince)}d ago (high urgency threshold 30d)` };
    }

    if (urgency === 'low') {
      // Broader windows — can use less active talent
      if (daysSince <= 60)  return { score: 5, reason: `Used ${Math.round(daysSince)}d ago (within 60d; low urgency)` };
      if (daysSince <= 180) return { score: 3, reason: `Used ${Math.round(daysSince)}d ago (within 180d; low urgency)` };
      if (daysSince <= 365) return { score: 1, reason: `Used ${Math.round(daysSince)}d ago (within 365d; low urgency)` };
      return { score: 0, reason: `Last used ${Math.round(daysSince)}d ago (low urgency threshold 365d)` };
    }

    // medium (default)
    if (daysSince <= 30)  return { score: 5, reason: `Used ${Math.round(daysSince)}d ago (within 30d)` };
    if (daysSince <= 90)  return { score: 3, reason: `Used ${Math.round(daysSince)}d ago (within 90d)` };
    if (daysSince <= 180) return { score: 1, reason: `Used ${Math.round(daysSince)}d ago (within 180d)` };
    return { score: 0, reason: `Last used ${Math.round(daysSince)}d ago` };
  }

  // ── Preferred bonus (0–5) ───────────────────────────────────────────────

  private scorePreferred(talent: TalentProfile): RankDimension {
    if (talent.preferred) return { score: 5, reason: 'Marked as preferred' };
    return { score: 0, reason: 'Not preferred' };
  }

  // ── Penalties ───────────────────────────────────────────────────────────

  private scorePenalties(talent: TalentProfile): RankPenalties {
    const reasons: string[] = [];
    let penalty = 0;

    if (talent.status === 'inactive') {
      penalty -= 50;
      reasons.push('Profile is inactive (-50)');
    }
    if (talent.declinedJobsCount > 2) {
      penalty -= 5;
      reasons.push(`${talent.declinedJobsCount} declined jobs (-5)`);
    }
    if (talent.noResponseCount > 2) {
      penalty -= 10;
      reasons.push(`${talent.noResponseCount} no-response incidents (-10)`);
    }

    return { score: penalty, reasons };
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  private buildSummary(
    talent: TalentProfile,
    score: number,
    cat: RankDimension,
    geo: RankDimension,
    trust: RankDimension,
    penalties: RankPenalties,
  ): string {
    const parts: string[] = [`Score ${score}/100.`];
    if (cat.score >= 20) parts.push(`Strong category fit.`);
    if (geo.score >= 15) parts.push(`Good location match.`);
    if (trust.score >= 20) parts.push(`High trust.`);
    if (talent.preferred) parts.push(`Preferred contact.`);
    if (penalties.reasons.length > 0) parts.push(`Penalties: ${penalties.reasons.join('; ')}.`);
    return parts.join(' ');
  }
}
