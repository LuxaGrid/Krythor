# Weekly Planning System

**Category:** Productivity
**ID:** vault-weekly-planning-system
**Version:** 1.0.0

## What It Does

Weekly Planning System is a structured weekly review and planning session. You provide your current projects, pending tasks, scheduled appointments, and goals for the week. The skill retrieves carry-over items and stated priorities from memory, synthesizes everything into a coherent picture, and produces a prioritized weekly agenda, daily focus block recommendations, your top 3 outcomes for the week, a list of blockers to address, and a personal Monday preparation note.

It then saves this week's plan and top outcomes to memory so future sessions (daily briefs, triage, end-of-week reviews) can reference them.

## Why It's Better Than a Plain LLM Prompt

A plain prompt produces a basic to-do list reordering. This skill:

- Retrieves carry-over tasks and prior stated priorities from memory — incomplete items from last week do not silently disappear
- Frames the week around outcomes (what you will achieve) rather than tasks (what you will do), which produces a fundamentally different quality of plan
- Assigns daily focus blocks with specific task assignments, so deep work is protected by design, not left to chance
- Identifies blockers proactively so the user can resolve them on Monday rather than discovering them on Thursday
- Writes a motivating Monday preparation note in second person — a cognitive on-ramp for the week
- Saves the week's top outcomes and plan to memory so daily briefs can align with the weekly strategy

## Inputs

Provide any combination of:

- **Active projects** — what you are currently working on
- **Pending tasks** — specific items that need to get done this week
- **Scheduled appointments** — meetings, calls, or fixed commitments
- **Weekly goals** — what a successful week looks like

Carry-over items and prior stated priorities are retrieved from memory automatically.

## Outputs

1. Weekly Context Summary (orientation to the week)
2. Top 3 Outcomes (outcome-based, with rationale)
3. Prioritized Weekly Agenda (day-by-day, with priority labels and time estimates)
4. Daily Focus Block Recommendations (one protected deep-work block per day)
5. Blockers to Address (with resolution owners and timing)
6. Monday Preparation Note (personal, energizing, second-person)
7. Memory Update (confirmation of what was saved)

## Permissions Used

- `memory:read` — Retrieves carry-over tasks, prior stated priorities, and ongoing project context from previous sessions.
- `memory:write` — Saves this week's top outcomes, prioritized agenda, and any updated project context for use by daily briefs and future planning sessions.

## Memory Behavior

Full read/write. Prior session context is read at the start to surface incomplete work and standing priorities. The new weekly plan and top outcomes are written back to memory. This creates continuity between weeks — the system remembers what you were working on and what you said mattered.

## Ideal Use Cases

- Sunday evening or Monday morning weekly planning ritual
- Resetting after a chaotic week with too many competing demands
- Aligning a week around a specific high-stakes deliverable or deadline
- Building a consistent weekly rhythm for a small business owner or executive
- Integrating outputs from the Meeting to Workflow Converter into a coherent weekly plan
- Ensuring long-term projects stay visible and get weekly attention alongside urgent work
