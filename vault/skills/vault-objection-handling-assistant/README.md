# Objection Handling Assistant

Takes a specific objection from a buyer or seller — stated exactly as they said it — and produces a direct response script, the underlying concern being expressed, two alternative framings, and a follow-up question designed to keep the conversation moving. Every output is context-aware when prior client memory is available.

## Why it's better than a plain LLM prompt

A plain prompt generates a generic response to a generic objection. This skill forces a deeper analytical layer: identifying the real concern beneath the stated objection, which is where the actual resistance lives. It then produces multiple response options so the agent can choose the right register for the client, and closes with a follow-up question — the most underused tool in objection handling. The memory read allows the response to be informed by what the agent already knows about this specific client.

## Inputs

- The exact objection as stated (e.g. "The price is too high", "I want to wait until spring", "I don't think I need an agent")
- Whether it came from a buyer or seller
- Any context about the client's situation, stage, or prior conversations (optional but improves output significantly)

## Outputs

- **Direct Response Script** — word-for-word, conversational response (3-6 sentences), ready to use
- **Underlying Concern** — the real fear or uncertainty being expressed, and how the script addresses it
- **Alternative Framings** — 2 meaningfully different response angles (e.g. data-driven + values-based)
- **Follow-Up Question** — one open-ended question to keep the conversation moving and surface the true concern

## Permissions Used

- `memory:read` — retrieves prior client context to personalize the response based on relationship history

## Memory Behavior

Prior memory context for the client (if available) is read and used to personalize both the response script and the follow-up question. For example, if memory shows a buyer has been looking for 4 months, a "waiting until spring" objection receives a very different response than it would for a first-time inquiry.

## Ideal Use Cases

- Preparing for a difficult conversation before calling a client
- Real-time support during a buyer or seller consultation
- Training new agents on objection response frameworks
- Refreshing scripts for recurring objections the agent hears frequently
- Handling objections in listing presentations or buyer consultation meetings
