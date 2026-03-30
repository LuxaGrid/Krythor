# Relationship Nurture Planner

**Category:** Business
**ID:** vault-relationship-nurture-planner
**Version:** 1.0.0

## What It Does

Relationship Nurture Planner builds a personalized, structured nurture strategy for a specific business contact. It reads interaction history from memory, scores the current health of the relationship, and produces a concrete 30/60/90-day touchpoint plan with specific message types, recommended value-adds to share, and guidance on channel and tone for each touchpoint.

The plan and updated relationship context are saved to memory so future sessions can track progress and adjust the strategy as the relationship evolves.

## Why It's Better Than a Plain LLM Prompt

A plain prompt gives generic outreach suggestions. This skill:

- Pulls the full interaction history from memory, so the plan is built on actual relationship context — not assumptions
- Scores the relationship on Recency, Depth, and Momentum to give you an honest read of where things stand before planning
- Produces phase-specific touchpoints (30/60/90 days) rather than a flat list, reflecting how relationships actually develop over time
- Specifies message type and angle for each touchpoint, not just "send an email"
- Recommends genuine value-adds tied to what you know about this contact's goals and challenges
- Saves the plan to memory so you can return to it, mark touchpoints complete, and evolve the strategy

## Inputs

- **Contact name** — who this plan is for
- **Relationship type** — prospect, active client, past client, strategic partner, referral source, etc.
- **Interaction history** — past touchpoints, what was discussed, current status (also retrieved from memory automatically)
- **Your goals for this relationship** — what you are trying to achieve (close a deal, retain, activate referrals, build alliance, etc.)

## Outputs

1. Relationship Snapshot (current state summary)
2. Relationship Health Score (Recency / Depth / Momentum with composite score)
3. 30/60/90 Day Nurture Plan (phased touchpoints with timing, channel, and description)
4. Message Types and Angles (specific guidance per touchpoint)
5. Recommended Value-Adds (3–5 specific, relevant items to share)
6. Memory Update (confirmation of what was saved)

## Permissions Used

- `memory:read` — Retrieves full interaction history, prior contact context, and any previous nurture plans for this contact.
- `memory:write` — Saves the updated relationship snapshot, health score, and new nurture plan for future retrieval.

## Memory Behavior

Full read/write. The skill reads all stored context for this contact at the start, incorporates it into the plan, then writes the updated plan and relationship state back to memory. Designed to be used repeatedly — each subsequent use will pull the prior plan and track relationship progression over time.

## Ideal Use Cases

- Re-engaging a prospect who went cold
- Planning a structured stay-in-touch cadence for a past client
- Building a pipeline of warm relationships with strategic partners
- Managing high-value accounts with intentional, consistent touchpoints
- Activating a referral source who has gone quiet
- Any relationship where you want to be memorable and valuable, not just present
