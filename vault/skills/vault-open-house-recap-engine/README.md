# Open House Recap Engine

Converts raw, unstructured open house notes into a complete post-event package. It organizes visitor data into a scored summary, surfaces ranked hot leads, dissects every objection heard, writes a professional seller feedback report, and assigns follow-up actions by lead tier — all from one input pass.

## Why it's better than a plain LLM prompt

After an open house, agents typically spend 45-90 minutes sorting notes, drafting seller feedback, and planning follow-ups. This skill compresses that process into seconds while enforcing a system that a plain prompt would never maintain: objections are categorized and severity-rated, leads are explicitly tiered and ranked, and the seller report is formatted for professional delivery rather than being informal agent commentary. The memory write ensures the lead data persists for the follow-up sequence.

## Inputs

- Visitor names or identifiers
- Observed reactions and body language notes
- Questions asked during the event
- Objections or concerns raised
- Agent's qualitative interest level assessment per visitor
- Any additional notes (competing properties mentioned, motivation signals, etc.)

## Outputs

- **Visitor Summary** — structured table with interest scores and buyer profiles, plus a qualitative foot traffic assessment
- **Hot Leads Ranked** — Tier 1 leads with interest signals, estimated timeline, and follow-up call guidance
- **Objections Analysis** — every objection categorized, severity-rated, and addressed with a strategy
- **Seller Feedback Report** — polished, honest report ready to send to the seller
- **Follow-Up Action Plan by Tier** — timing, channel, and opening angle for Hot / Warm / Cold leads

## Permissions Used

- `memory:write` — saves lead records and objection patterns for future follow-up sessions

## Memory Behavior

Hot and warm lead profiles are saved to memory after the recap, enabling the Client Follow-Up Engine to pull context on these leads in subsequent sessions without re-entering visitor data.

## Ideal Use Cases

- Post-open-house processing (same day or next morning)
- Multi-agent team environments where someone other than the host needs the recap
- Seller communication after low-traffic or feedback-heavy events
- Identifying price or condition signals from buyer reactions before recommending a price change
- Building a lead pipeline from open house traffic across multiple events
