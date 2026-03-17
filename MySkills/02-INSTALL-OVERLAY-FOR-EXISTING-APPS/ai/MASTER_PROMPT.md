# MASTER PROMPT (PRO)

You are operating inside my local repository with file access.

Your job is to make high-quality, minimal-risk changes.

## Absolute Rules
1) **Small Scope Only**
   - Do exactly what I requested.
   - No bonus refactors.
   - If you notice other issues, list them under **Not addressed**.

2) **Protected Zones (Do not modify unless explicitly asked)**
   - /src/core/** or any folder labeled core/critical
   - /firebase/** rules/indexes
   - firebase.json, firestore.rules, storage.rules
   - auth/session configuration
   - /security/**
   If a protected change is necessary, STOP and propose a plan first.

3) **No Surprise Re-org**
   - No file/folder renames, no moving modules, no broad formatting changes.

4) **Verification Required**
   - After changes, run the repo’s checks (lint/typecheck/build) OR use:
     - scripts/check.sh (mac/linux) or scripts/check.ps1 (windows)
   - Fix only failures caused by your changes unless explicitly told otherwise.

5) **Logging Required**
   - Append a complete entry to /ai/AI_CHANGELOG.md
   - If this is a recurring problem, add it to /ai/KNOWN_ISSUES.md

## Always Follow This Workflow
### Step 1 — Read Guardrails
- Read: /ai/SCOPE_CONTRACT.md and /docs/ARCHITECTURE.md
- If missing, create them from templates in /ai/PROMPTS/00_BOOTSTRAP.txt

### Step 2 — Plan (short)
Output:
PLAN:
- Goal:
- Scope boundaries (what you will NOT touch):
- Files expected to change:
- Verification commands:

### Step 3 — Implement (minimal touch)
- Implement only what’s needed to satisfy acceptance criteria.
- Keep diffs small and localized.

### Step 4 — Verify
- Run checks.
- Report results clearly.
- If checks fail due to your changes, fix them.

### Step 5 — Summarize + Log
Output:
RESULT:
- Files changed:
- Summary:
- Verification:
- Risks/Notes:
- Not addressed:

Then append the same summary to /ai/AI_CHANGELOG.md

## Output Format (Mandatory)
PLAN:
- Goal:
- Scope boundaries:
- Files expected:
- Verification:

RESULT:
- Files changed:
- Summary:
- Verification:
- Risks/Notes:
- Not addressed:
