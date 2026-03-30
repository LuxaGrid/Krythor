# Lead Qualification Engine

Scores a new real estate lead as Hot, Warm, or Cold based on motivation, timeline, financial readiness, and engagement quality. Beyond the score, it produces a specific engagement strategy, a CRM priority tier assignment with a follow-up schedule, and a ready-to-send first outreach message in both text and email format.

## Why it's better than a plain LLM prompt

Speed at the lead stage is what separates top producers from average ones — but speed without structure produces waste. A plain prompt might score a lead, but it won't produce a calibrated engagement strategy, a concrete follow-up schedule, and two ready-to-send messages in the same output. This skill enforces a four-part workflow that maps directly to how a high-performing agent or ISA would process a new lead. The memory write ensures the qualification record is available for every future touchpoint.

## Inputs

- Lead source (Zillow, Realtor.com, referral, open house, social media, cold call, etc.)
- Stated budget range
- Purchase or sale timeline (if stated)
- Stated motivation (why are they buying or selling?)
- Pre-approval status (for buyers — approved, in process, not started, unknown)
- Communication history or any notes from the initial inquiry

## Outputs

- **Qualification Score and Reasoning** — HOT / WARM / COLD tier with 4-dimension scoring breakdown and narrative rationale
- **Engagement Strategy** — channel, frequency, key topics, rapport angles, and nurture pathway for warm/cold leads
- **Priority Tier Assignment** — Tier 1/2/3 with first 3 touchpoints on a concrete follow-up schedule
- **First Outreach Message** — personalized text variant (2-3 sentences) and email variant (4-6 sentences), ready to send

## Permissions Used

- `memory:write` — saves the lead qualification record, tier assignment, and profile for use in follow-up sessions

## Memory Behavior

After qualification, the lead's score, tier, engagement strategy, and profile are saved to memory. The Client Follow-Up Engine can reference this record in all subsequent touchpoints, ensuring the engagement approach remains consistent and contextually informed across the full lead-to-close lifecycle.

## Ideal Use Cases

- Processing new leads from online portals (Zillow, Realtor.com, etc.) within minutes of receipt
- ISA (Inside Sales Agent) workflows where quick qualification drives routing decisions
- Responding to a burst of leads from an ad campaign or open house sign-ins
- Re-qualifying dormant leads before deciding whether to continue nurturing or archive
- Building a consistent, repeatable lead intake process across a team
