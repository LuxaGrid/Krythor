#!/usr/bin/env bash
set -euo pipefail

route="${1:-/}"
mkdir -p test-artifacts

if [ ! -f "playwright.config.ts" ] && [ ! -f "playwright.config.js" ]; then
  echo "==> Playwright config missing. Copy from templates/playwright.config.ts and install deps:"
  echo "npm i -D @playwright/test"
  echo "npx playwright install"
  exit 1
fi

echo "==> Running Playwright smoke for route: $route"
ROUTE="$route" npx playwright test tests/smoke.spec.ts --reporter=line || true

echo "Artifacts saved in test-artifacts/ (and playwright output folder if configured)."
