# Proposal Builder

**Category:** Business
**ID:** vault-proposal-builder
**Version:** 1.0.0

## What It Does

Proposal Builder takes the raw ingredients of a client engagement — their name and company, the project scope, deliverables, timeline, and pricing — and produces a complete, ready-to-send business proposal. It reads prior client context from memory if available, so proposals reflect your history with the client rather than starting from scratch every time.

The output is a fully structured proposal document: executive summary, scope of work, deliverables list, timeline, pricing breakdown, and a persuasive "why us" closing section.

## Why It's Better Than a Plain LLM Prompt

A plain prompt produces a generic proposal template. This skill is purpose-built to:

- Pull prior client context from memory, so proposals reference your relationship history and any previously stated client goals
- Enforce a specific professional structure every time, not whatever the model decides today
- Flag missing information (pricing, timeline) with explicit placeholders rather than inventing details
- Write closing sections that are client-specific and outcome-focused, not boilerplate

## Inputs

Provide any combination of the following:

- **Client name and company** — who the proposal is for
- **Project scope** — what you are being engaged to do
- **Deliverables** — what you will produce or deliver
- **Timeline** — key dates, phases, or a relative schedule
- **Pricing** — line items, totals, or a rate structure
- **Any additional context** — prior conversations, client goals, relationship notes (also retrieved from memory automatically)

Not all fields are required — the skill will use what is provided and mark gaps clearly.

## Outputs

1. Executive Summary
2. Scope of Work
3. Deliverables List
4. Timeline
5. Pricing Breakdown
6. Why Us (closing section)

## Permissions Used

- `memory:read` — Retrieves prior context about this client or engagement from memory (interaction history, stated goals, prior proposals, relationship notes).

## Memory Behavior

Read-only. The skill queries memory for any stored context matching the client name or project. It does not write to memory. Use the CRM Memory Sync skill to store new client context after interactions.

## Ideal Use Cases

- Writing a proposal for a returning client where history matters
- Generating a first draft that needs only light editing before sending
- Standardizing proposal structure across a sales team
- Quickly building a proposal from meeting notes or a brief conversation recap
- Repurposing a past proposal structure for a new client with different scope
