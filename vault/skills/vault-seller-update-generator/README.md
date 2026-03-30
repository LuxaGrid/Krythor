# Seller Update Generator

Produces a professional, structured seller update communication from listing performance data. The output gives sellers honest market context, a clear-eyed showing activity summary, a candid assessment of the listing's position, and specific recommended next steps — all in a format ready to send or present.

## Why it's better than a plain LLM prompt

Most agents either over-communicate (rambling check-in emails) or under-communicate (brief texts that leave sellers anxious). A plain prompt produces prose of unknown quality. This skill enforces a four-section structure that mirrors what top agents have learned sellers actually need: context before critique, data before opinion, and recommendations before conclusions. The memory read allows the skill to reference any prior seller communications or listing notes for consistency.

## Inputs

- Days on market
- Total showing count (and showing velocity over time if available)
- Feedback summaries from showing agents
- Current list price vs. recent comparable sales (price per sqft or direct comp notes)
- Any other relevant observations (seasonal factors, competing inventory, price change history)

## Outputs

- **Market Context** — honest market conditions framing, calibrated to this property segment
- **Showing Activity Summary** — total showings, velocity trend, and synthesized feedback themes
- **Honest Assessment** — candid evaluation of where the listing stands and why
- **Recommended Next Steps** — 2-4 specific, ranked actions with expected outcomes and consequences of inaction

## Permissions Used

- `memory:read` — retrieves prior listing notes, original pricing rationale, or previous seller communications for consistency and continuity

## Memory Behavior

Prior memory context (e.g. original pricing rationale from Listing Intelligence Builder, or notes from previous seller updates) is read and incorporated so each update builds a coherent narrative rather than contradicting earlier communications.

## Ideal Use Cases

- Weekly or bi-weekly seller check-ins on active listings
- Price reduction conversations — delivering the recommendation with data rather than opinion
- Responding to a seller who is frustrated or asking "why isn't it selling?"
- Documenting the agent's advisory process for liability and professionalism purposes
- Preparing for a listing renewal or re-launch conversation
