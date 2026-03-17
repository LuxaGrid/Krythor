# SCOPE CONTRACT (PRO)

This file defines how the AI is allowed to work in this repo.

## Default Scope
- Implement ONLY what is requested in the active prompt.
- Keep diffs small and localized.
- Do not refactor unrelated code.
- Do not change code style or formatting repo-wide.

## Protected Zones (read-only unless explicitly requested)
- /src/core/**
- /firebase/**
- firebase.json
- firestore.rules
- storage.rules
- auth/session config
- /security/**

## If You Need To Break Scope
STOP and ask for a plan approval in the output:
- Why it’s required
- Which files
- Minimal alternative options
- Risk level (low/med/high)

## Definition of Done (per task)
- Acceptance criteria met
- Verification commands run
- AI_CHANGELOG updated
- No secrets committed
