# Client Follow-Up Engine

Transforms a client name, last interaction summary, and current status into a complete follow-up package: a personalized outreach message, a recommended next action, and a structured memory note. The skill pulls any prior context stored for this client and incorporates it into every output, so each follow-up builds on a full relationship history rather than starting from scratch.

## Why it's better than a plain LLM prompt

A generic "write a follow-up email" prompt produces a generic email. This skill enforces a structured workflow — context synthesis first, then message, then action, then memory update — ensuring the agent never sends a follow-up that ignores prior history, never forgets to define a next step, and always captures the interaction for future sessions. The memory read/write loop turns one-off outputs into a compounding relationship record.

## Inputs

- Client name
- Summary of the last interaction (call notes, showing recap, text thread, etc.)
- Current client status (e.g. active buyer, passive seller, nurture list, past client)

## Outputs

- **Context Summary** — synthesized client picture from notes and memory
- **Personalized Follow-Up Message** — ready-to-send email or text, specific to this client
- **Recommended Next Action** — single most important next step with timing and goal
- **Memory Note** — structured bullet record to save back for future sessions

## Permissions Used

- `memory:read` — retrieves prior client context from memory
- `memory:write` — saves updated client status note after each interaction

## Memory Behavior

On invocation, the skill reads any existing memory record for this client and incorporates it into the context synthesis. After generating outputs, it produces a memory note formatted for saving back to the client's record. This creates a persistent, compounding relationship log across sessions.

## Ideal Use Cases

- Daily follow-up queue processing (5-20 clients at a time)
- Re-engaging dormant leads with personalized context
- Maintaining consistent contact with long-cycle sellers or luxury buyers
- Ensuring no client slips through the cracks after a showing or consultation
- Preparing for a client call by surfacing all prior context in seconds
