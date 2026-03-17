# Application Architecture (PRO Template)

## Stack
- Frontend:
- Backend:
- Database:
- Hosting/Infra:

## Project Structure (recommended)
/src/core        -> business logic (protected)
/src/features    -> feature modules
/src/services    -> API/Firebase integrations
/src/ui          -> shared UI components
/src/pages or /app -> routing layer (Next.js)

## Guardrails
- Keep business logic out of UI.
- Keep external calls inside services.
- Protected zones require explicit permission to change.
