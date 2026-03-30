# Conversation Memory Builder

## What it does

Takes a summary of any conversation, meeting, or interaction and extracts a structured memory entry covering key facts, stated preferences, open commitments, emotional tone, and relationship status. Saves it to memory under the person's name. Before any future interaction with that person, retrieves and surfaces the most relevant context automatically — who they are, where things stand, what was promised, and how to approach the next conversation.

## Why it's better than a plain LLM prompt

A plain LLM cannot remember anything between sessions. This skill turns every significant interaction into a durable, retrievable record. It is not just a note-taker — the structured extraction means nothing important is buried in raw text. The relationship status and next-best-move fields turn passive notes into active guidance. The retrieval mode surfaces a pre-meeting briefing that would otherwise require digging through notes, emails, or CRM records manually.

## Inputs

**Memory Capture:**
A free-form summary of any conversation, meeting, or interaction. Include:
- Who it was with (name, role, context)
- What was discussed
- Any decisions, commitments, or next steps
- How the interaction felt (optional but valuable)

As brief or detailed as you like. Even rough notes work.

**Context Retrieval:**
Simply mention the person's name and ask for a briefing before a call, meeting, or message. The skill retrieves everything relevant.

## Outputs

**Memory Capture Output:**
- Structured entry with: Person, Key Facts, Stated Preferences, Open Commitments, Emotional Tone, Relationship Status, Next Best Move
- Confirmation of any uncertain extractions
- Entry saved to memory under the person's name

**Retrieval Output:**
- 3-4 sentence relationship briefing
- Most important things to remember
- Open commitments to close out
- Suggested opening or approach for the upcoming interaction

## Permissions used

`memory:read` + `memory:write` — writes structured entries on capture; reads them on retrieval. Updates existing entries with new information rather than overwriting.

## Memory behavior

Each person gets a named memory entry. Entries are merged and updated when new interaction summaries are provided, with conflicts flagged. Entries persist indefinitely across sessions.

## Ideal use cases

- Preparing for a follow-up sales call or client meeting
- Keeping track of a growing professional network
- Remembering the details of ongoing negotiations or partnerships
- Managing multiple stakeholder relationships in a project
- Personal relationship intelligence — remembering what matters to the people you care about
