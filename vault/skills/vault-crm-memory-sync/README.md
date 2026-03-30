# CRM Memory Sync

**Category:** Business
**ID:** vault-crm-memory-sync
**Version:** 1.0.0

## What It Does

CRM Memory Sync processes raw notes from a client or prospect interaction and transforms them into structured, actionable intelligence. It extracts every decision-relevant fact from the notes (budget, timeline, objections, next steps, decision makers), generates a clean contact summary, produces a CRM-ready activity log note, and recommends a specific follow-up action. All extracted facts are saved to memory for retrieval in future sessions.

This skill turns sloppy post-meeting notes into a structured relationship record — and keeps that record in memory so every future interaction with this contact is informed by the full history.

## Why It's Better Than a Plain LLM Prompt

A plain prompt summarizes notes but does not impose a structured extraction schema or persist anything. This skill:

- Applies a consistent extraction schema (budget, timeline, goals, objections, decision makers, competitors, open questions) across every interaction
- Retrieves prior memory about this contact and integrates it with new information — so the contact summary reflects the full relationship, not just this single interaction
- Produces a CRM note in a professional, paste-ready format (third-person, past tense, activity-log style)
- Recommends a specific, time-bound follow-up action based on actual content — not a generic "send a follow-up"
- Explicitly lists everything being saved to memory so you know exactly what was retained

## Inputs

Provide raw notes from a client or prospect interaction. Any of the following work:

- **Call recap** — notes from a phone or video call
- **Email thread** — a copied email exchange
- **Meeting notes** — notes taken during or after a meeting
- **Voice memo summary** — a transcribed or paraphrased record
- **Contact name** — helps memory retrieval of prior context

## Outputs

1. Contact Summary (structured snapshot)
2. Key Facts Extracted (by category: budget, timeline, goals, objections, etc.)
3. CRM Update Note (paste-ready activity log entry)
4. Recommended Follow-Up (specific action, owner, timing)
5. Memory Save Confirmation (list of what was stored and under what keys)

## Permissions Used

- `memory:read` — Retrieves prior interaction history and contact context for this person.
- `memory:write` — Saves the structured contact summary and extracted facts for future retrieval.

## Memory Behavior

Full read/write. Prior context for this contact is read at the start of the session and merged with the new interaction. The updated contact record, extracted facts, and next steps are written back to memory. This means every subsequent interaction with this contact builds on the accumulated history.

## Ideal Use Cases

- Processing notes immediately after a sales call or client meeting
- Building a persistent contact record for prospects you interact with repeatedly
- Keeping CRM data current without manually entering every interaction
- Ensuring no follow-up action or commitment falls through the cracks
- Building institutional memory for client relationships that span months or years
- Onboarding a new team member to a relationship by retrieving the full contact history
