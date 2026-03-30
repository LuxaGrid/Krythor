# Meeting to Workflow Converter

**Category:** Productivity
**ID:** vault-meeting-to-workflow
**Version:** 1.0.0

## What It Does

Meeting to Workflow Converter takes raw meeting notes or a transcript and produces a complete set of workflow assets: a structured meeting summary, a comprehensive action items list with owners and deadlines extracted from the text, a prioritized task execution sequence, a list of decisions that need follow-up confirmation, and a ready-to-send recap message for attendees.

Nothing falls through the cracks. Every commitment mentioned in the meeting becomes a tracked action item with an owner and deadline.

## Why It's Better Than a Plain LLM Prompt

A plain prompt produces a bullet-point summary and maybe a few action items. This skill:

- Extracts every action item — including informally mentioned ones — not just the obvious ones that were listed as tasks
- Assigns owners and deadlines from context, or flags them as [OWNER TBD] when not clear
- Re-sequences tasks by priority and dependency, not just in the order they were mentioned
- Separates confirmed decisions from tentative ones that need follow-up, preventing false assumptions about what was agreed
- Produces a ready-to-send recap message so there is zero friction in getting the summary out to attendees
- Saves the action items to memory so they can be referenced in future planning sessions

## Inputs

Paste any of the following:

- **Raw meeting notes** — typed notes from during or after the meeting
- **Transcript** — a full or partial meeting transcript
- **Voice memo summary** — a written-out summary of a recorded meeting
- **Hybrid notes** — a mix of bullet points, names, and follow-ups

The more detail provided, the more complete the extraction. The skill is designed to work even with terse or messy input.

## Outputs

1. Meeting Summary (structured 5–8 sentence overview)
2. Action Items (numbered list with action, owner, deadline)
3. Prioritized Task Sequence (reordered by urgency and dependency, labeled by priority tier)
4. Decisions Requiring Confirmation (tentative or unresolved items)
5. Recap Message (ready-to-send plain text for attendees)

## Permissions Used

- `memory:write` — Saves the action items list to memory so it can be referenced in future planning sessions (weekly planning, daily briefs, triage).

## Memory Behavior

Write-only in this skill. Action items extracted from the meeting are saved to memory as open tasks. These can then be retrieved by the Weekly Planning System or Daily Brief Builder to ensure meeting commitments are integrated into your workflow.

## Ideal Use Cases

- Processing notes from any client, team, or planning meeting
- Ensuring nothing discussed in a meeting is lost or forgotten
- Distributing a professional recap to attendees without spending 30 minutes writing it
- Feeding meeting outputs directly into your task management workflow
- Capturing decisions and follow-ups from a fast-moving brainstorm session
- Onboarding someone who missed the meeting by giving them a complete record
