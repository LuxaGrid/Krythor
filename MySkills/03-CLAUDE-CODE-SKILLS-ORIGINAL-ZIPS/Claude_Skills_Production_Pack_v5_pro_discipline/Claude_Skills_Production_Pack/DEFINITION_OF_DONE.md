# Definition of Done (Fast Solo Dev)

A feature is “done” when:

- UI includes **Loading / Empty / Error** states
- `bash scripts/check.sh` passes
- A smoke test exists (or updated): `bash scripts/playwright_smoke.sh "/route"`
- No secrets exposed (env, logs, client bundle)
- If it was a bugfix: ERROR_PLAYBOOK entry added

