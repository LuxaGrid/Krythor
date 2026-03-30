# Buyer Match Helper

Takes a buyer's stated criteria and turns them into a complete, structured buyer profile that is saved to memory and used immediately. The skill ranks criteria by true priority, surfaces clarifying questions to tighten the search, and produces a specific property type and area strategy — so the first showing is always better targeted than it would be without it.

## Why it's better than a plain LLM prompt

A plain prompt summarizes what the buyer said. This skill does what an experienced agent actually does: it identifies conflicts between stated criteria and budget, surfaces the questions the buyer hasn't been asked yet, and translates raw preferences into a concrete geographic and property-type strategy. The memory write means every future session — showings, offer prep, follow-ups — can reference this profile without re-asking the buyer the same questions.

## Inputs

- Budget range (must-stay-under vs. stretch)
- Desired location(s) or geographic constraints
- Must-have features (non-negotiables)
- Nice-to-have features (wishlist)
- Purchase timeline
- Motivation for buying (growing family, relocation, investment, downsizing, first purchase, etc.)

## Outputs

- **Structured Buyer Profile** — clean, scannable profile with all criteria organized by type
- **Priority Criteria Ranking** — dealbreakers vs. preferences vs. nice-to-haves, with conflict flags
- **Clarifying Questions** — 5-8 targeted questions to sharpen the search before the first showing
- **Recommended Search Strategy** — specific neighborhoods, property types, and showing sequence
- **Memory Save Note** — structured record saved for future sessions

## Permissions Used

- `memory:read` — retrieves any prior buyer context from previous conversations
- `memory:write` — saves the full structured buyer profile for use across all future sessions

## Memory Behavior

Prior buyer context (e.g. from an initial inquiry or qualification call) is read and merged into the profile. The completed profile is written to memory at a buyer-keyed record and is available to the Offer Positioning Assistant, Objection Handling Assistant, and Client Follow-Up Engine in subsequent sessions.

## Ideal Use Cases

- Buyer consultation intake (first meeting or buyer agency signing)
- Refining a search for a buyer who has been looking for several weeks without success
- Onboarding a referred buyer before the first call
- Handing off a buyer to another agent on the team
- Resetting a stale buyer relationship with a fresh criteria review
