# Inbox Intelligence

## What it does

Processes a batch of pasted emails, messages, or inquiries and returns a full triage report: every item classified by type, a priority-ordered list, drafted replies for the top 3 items, and a recommended strategy for clearing the entire batch. Turns an overwhelming inbox into a clear action plan in seconds.

## Why it's better than a plain LLM prompt

Asking an LLM to "help with my emails" produces vague suggestions. This skill enforces a structured triage methodology — every item is classified, every top item is prioritized with a reason, and full draft replies are produced immediately. The batch strategy section catches patterns a one-off prompt never would (recurring senders, situations that need a template or process). The memory read means recurring senders or standing communication preferences are automatically factored in.

## Inputs

Paste in any combination of:
- Email threads (subject + body, or just body)
- Slack or DM messages
- Support tickets or inquiry forms
- Any text-based incoming messages

You can paste 3 items or 30. The skill scales to the batch size.

## Outputs

1. **Batch Overview** — item count, general nature, and single highest-stakes item called out
2. **Classified Item Summary** — every item classified as URGENT-ACTION / ACTION / INFO / DELEGATE / DEFER / JUNK with a one-line summary and recommended action
3. **Priority Order** — full ranked list with reasoning for the top 5
4. **Drafted Replies** — complete, ready-to-send replies for the top 3 items with tone notes
5. **Batch Response Strategy** — 4-6 point plan for clearing the full batch

## Permissions used

`memory:read` — retrieves prior context about recurring senders, communication preferences, or standing response policies stored from previous sessions.

## Memory behavior

Reads from memory before processing. Does not write to memory. To save communication preferences or recurring sender context for future use, pair this skill with the Personal Context Assistant.

## Ideal use cases

- Clearing a backlogged inbox after travel or a focus sprint
- Daily morning triage to establish a response priority order
- Processing a high-volume inquiry batch after a launch or campaign
- Delegating inbox management to an assistant with AI-prepared drafts
