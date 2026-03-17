#!/usr/bin/env bash
set -euo pipefail

# Production bootstrap helper.
# This script is intentionally conservative: it writes files only if missing,
# and prints exact install commands rather than guessing versions.

echo "==> Bootstrap: detecting router"
router="unknown"
if [ -d "pages" ] || [ -d "src/pages" ]; then router="pages"; fi
if [ -d "app" ] || [ -d "src/app" ]; then
  if [ "$router" = "unknown" ]; then router="app"; else router="both"; fi
fi
echo "Router: $router"

echo "==> Ensure folders"
mkdir -p src/components/ui src/components/layout scripts templates tests test-artifacts .bugpacks

echo "==> Ensure root docs"
for f in START_HERE.md WORKFLOW.md ERROR_PLAYBOOK.md DEFINITION_OF_DONE.md DESIGN_SYSTEM.md; do
  if [ ! -f "$f" ]; then
    echo "⚠️ Missing $f (copy from pack root if you want)."
  fi
done

echo "==> Ensure scripts exist"
for f in check.sh bugpack.sh fixloop.sh deps_healthcheck.sh playwright_smoke.sh; do
  if [ ! -f "scripts/$f" ]; then
    echo "⚠️ Missing scripts/$f"
  fi
done

echo "==> Tailwind check"
if [ -f "tailwind.config.js" ] || [ -f "tailwind.config.ts" ] || [ -f "tailwind.config.cjs" ]; then
  echo "Tailwind config found ✅"
else
  echo "Tailwind config not found ⚠️"
  echo "Install (recommended):"
  echo "  npm i -D tailwindcss postcss autoprefixer"
  echo "  npx tailwindcss init -p"
  echo "Then add @tailwind directives to your global CSS."
fi

echo "==> Playwright check"
if [ -f "playwright.config.ts" ] || [ -f "playwright.config.js" ]; then
  echo "Playwright config found ✅"
else
  echo "Playwright config missing (optional)"
  echo "Install:"
  echo "  npm i -D @playwright/test"
  echo "  npx playwright install"
  echo "Copy templates/playwright.config.ts -> playwright.config.ts"
  echo "Copy templates/tests_smoke.spec.ts -> tests/smoke.spec.ts"
fi

echo "==> package.json scripts (manual step)"
echo "Add (suggested):"
cat <<'JSON'
{
  "scripts": {
    "check": "bash scripts/check.sh",
    "bugpack": "bash scripts/bugpack.sh",
    "fixloop": "bash scripts/fixloop.sh",
    "deps:health": "bash scripts/deps_healthcheck.sh"
  }
}
JSON

echo "✅ bootstrap complete (conservative)."
