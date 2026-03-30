# Daily Brief Builder

**Category:** Productivity
**ID:** vault-daily-brief-builder
**Version:** 1.0.0

## What It Does

Daily Brief Builder produces a complete, personalized daily brief each morning. It takes today's date, your scheduled meetings and appointments, your open task list, and retrieves relevant context from memory (weekly priorities, carry-over commitments, ongoing projects). From this, it builds a structured daily document: a full time-blocked schedule, your top 3 priorities for the day, open loops that need closing, a specific deep-work focus recommendation, and clear end-of-day success criteria.

The brief is designed to be read once in the morning and used as the operating plan for the entire day.

## Why It's Better Than a Plain LLM Prompt

A plain prompt gives a generic to-do list. This skill:

- Retrieves your weekly goals and carry-over commitments from memory, so the daily plan aligns with the larger weekly strategy — you are not planning in isolation
- Produces a true time-block schedule with specific tasks assigned to specific slots, not a list you still have to figure out how to fit into your day
- Explicitly surfaces open loops — hanging items, unanswered messages, and unresolved decisions — so they do not get buried under the day's new demands
- Makes a single, specific deep-work focus recommendation rather than listing everything as important
- Writes testable end-of-day success criteria, so you know at 5pm whether today was a success — a clarity most daily plans never provide
- Saves the day's priorities and any updated context back to memory to feed the next session

## Inputs

Provide any combination of:

- **Today's date** — used to frame the brief and retrieve memory context
- **Scheduled meetings and appointments** — fixed items with times
- **Open or pending tasks** — what is in your queue for today
- **Any relevant context** — notes, priorities, or carry-overs you want included

Prior weekly goals, carry-over tasks, and project context are retrieved from memory automatically.

## Outputs

1. Day Header (date, day of week, day characterization)
2. Time-Blocked Schedule (full day: fixed appointments + recommended work blocks)
3. Top 3 Priorities (specific, completable today, with rationale)
4. Open Loops to Close (hanging items with suggested actions)
5. Deep Work Focus Recommendation (single best session: what, when, how long, deliverable)
6. End-of-Day Success Criteria (3–5 testable bullets)
7. Memory Update (confirmation of what was saved)

## Permissions Used

- `memory:read` — Retrieves weekly priorities, carry-over tasks, ongoing project context, and any commitments stored from previous sessions.
- `memory:write` — Saves today's top priorities, any updated task status, and relevant context for use in future sessions and end-of-day reviews.

## Memory Behavior

Full read/write. The skill reads the current weekly plan and any carry-over items from memory to ensure the daily brief is aligned with the week's strategy. Today's priorities and any new context are written back to memory. Used daily, this creates a continuous thread of intention and follow-through across your entire week.

## Ideal Use Cases

- First-thing-morning ritual to orient and plan before the day begins
- Days with a heavy meeting schedule where deep work needs to be protected explicitly
- High-stakes days (big presentation, deadline, important decision) where clarity is critical
- Recovering from a chaotic day and resetting focus for the next
- Pairing with the Weekly Planning System for full weekly-to-daily alignment
- Any time you want to start the day with a plan instead of reacting to whatever comes first
