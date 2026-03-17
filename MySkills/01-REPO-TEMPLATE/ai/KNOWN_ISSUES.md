# Known Issues (PRO)

Purpose: stop repeating the same fixes across sessions.

For each recurring issue, record:
- Symptom / error message
- Root cause
- Proven fix
- Verification command(s)
- Links to files or commits if helpful

---

## Example Entry
- Symptom: CORS blocked on /api/relay
- Root cause: Missing allowed origin in functions CORS middleware
- Fix: Add origin whitelist and handle OPTIONS
- Verify: curl -I -X OPTIONS ... OR run emulator and hit endpoint
