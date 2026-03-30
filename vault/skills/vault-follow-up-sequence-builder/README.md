# Follow-Up Sequence Builder

## What it does

Produces a complete, ready-to-load follow-up sequence — 5-7 messages with full copy, subject lines, send timing, psychological lever notes, tone guidance, and conditional branch logic for how to handle replies and non-replies. Covers email, SMS, or both.

## Why it's better than a plain LLM prompt

Most "write me a follow-up sequence" prompts return hollow, generic messages that all sound like the same reminder email. This skill starts with a strategy brief that defines the prospect's emotional state and the objection arc to address, then builds each touchpoint as a deliberate step in a relationship progression. The branch logic section — handling replies and sunsets — is almost never produced by generic prompts but is essential for real automation deployment.

## Inputs

Provide the following three things:
- **Lead source** — where the prospect came from (e.g., "downloaded a free checklist", "attended a webinar", "cold outbound LinkedIn connection", "referral")
- **Offer type** — what is being sold or offered (e.g., "1:1 coaching program at $2,500", "SaaS trial conversion", "booked sales call")
- **Desired outcome** — the single action you want the prospect to take by end of sequence

## Outputs

1. **Sequence Strategy Brief** — prospect state of mind, core objection, and emotional arc
2. **Sequence Map** — numbered touchpoints with timing, channel, purpose, and lever used
3. **Full Message Copy** — complete email (subject + preview + body) or SMS copy for each touchpoint
4. **Tone and Voice Notes** — 4-6 specific style guidelines and phrases to avoid
5. **Branch Logic** — conditional instructions for reply scenarios and sunset handling

## Permissions used

`memory:read` — retrieves any prior contact, lead, or offer context stored in memory to personalize the sequence.

## Memory behavior

Reads from memory before building the sequence. If prior context about the lead source, audience, or offer exists from previous sessions, it is used to improve personalization. Does not write to memory.

## Ideal use cases

- Building a post-lead-magnet nurture sequence
- Converting webinar registrants to paid offers
- Following up on sales calls that did not close
- Cold outreach sequences for B2B sales
- Re-engagement sequences for dormant leads
