# Process to Playbook Builder

**Category:** Business
**ID:** vault-process-to-playbook
**Version:** 1.0.0

## What It Does

Process to Playbook Builder takes any described business process — however rough or informally documented — and converts it into a clean, reusable operational playbook. The output includes a step-by-step instruction set with role owners, a roles and responsibilities table, a required inputs/tools checklist, clearly marked decision points, a list of common failure modes, and a condensed one-page summary version.

The skill then saves the completed playbook to memory so it can be retrieved and referenced in future sessions.

## Why It's Better Than a Plain LLM Prompt

A plain prompt produces a generic bulleted list of steps. This skill:

- Imposes a full playbook structure — not just steps, but roles, inputs, decision branches, and failure modes
- Marks decision points explicitly with branching instructions, so the playbook handles real-world variation
- Produces a one-page summary suitable for use as a quick-reference card alongside the full version
- Saves the playbook to memory so future sessions can retrieve, update, or reference it without re-entering the process description
- Flags genuinely missing information as [TO BE DEFINED] rather than fabricating details

## Inputs

Describe the process you want to document. Useful details to include:

- **Steps** — what happens in sequence (even roughly described)
- **Roles** — who is involved (job titles or team names)
- **Tools and systems** — what software, documents, or platforms are used
- **Decision points** — places where the process branches based on a condition
- **Known pain points** — where it typically breaks down

The input does not need to be polished. The skill is designed to work from rough descriptions.

## Outputs

1. Playbook Title and Purpose
2. Roles and Owners Table
3. Required Inputs and Tools Checklist
4. Step-by-Step Instructions (with decision branches)
5. Common Failure Points
6. One-Page Summary

## Permissions Used

- `memory:write` — Saves the completed playbook to memory for future retrieval and reference.

## Memory Behavior

Write-only in this skill. The completed playbook structure is saved to memory under the process name. Future sessions can retrieve it for updates, onboarding reference, or integration into larger operational documents.

## Ideal Use Cases

- Documenting a sales process, onboarding flow, or client delivery workflow for the first time
- Converting a process that lives in one person's head into something a team can follow
- Creating SOPs for a growing team before handing off responsibilities
- Building repeatable playbooks for recurring client engagements
- Capturing a process before a team member departs
- Standardizing operations across multiple locations or team members
