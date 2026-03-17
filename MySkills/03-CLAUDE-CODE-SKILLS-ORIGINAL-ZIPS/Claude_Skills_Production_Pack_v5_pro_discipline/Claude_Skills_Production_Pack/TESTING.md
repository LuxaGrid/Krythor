# Testing

## Playwright Smoke
1) Install:
- npm i -D @playwright/test
- npx playwright install

2) Copy templates:
- templates/playwright.config.ts -> playwright.config.ts
- templates/tests_smoke.spec.ts -> tests/smoke.spec.ts

3) Run:
- bash scripts/playwright_smoke.sh "/"
Artifacts: test-artifacts/
