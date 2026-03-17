#!/usr/bin/env bash
set -euo pipefail

target="${1:-prod}"
echo "==> Finish Branch (target: $target)"

# Gate
bash scripts/check.sh

# Optional smoke (only if config exists)
if [ -f playwright.config.ts ] || [ -f playwright.config.js ]; then
  bash scripts/playwright_smoke.sh "/"
else
  echo "==> Playwright not configured, skipping smoke"
fi

# Hosting sanity
if [ -f "firebase.json" ]; then
  echo "==> Firebase hosting config present ✅"
else
  echo "==> firebase.json missing ⚠️"
fi

# Rules guard & perf pass (best effort)
if [ -f scripts/firebase_rules_guard.sh ]; then bash scripts/firebase_rules_guard.sh; fi
if [ -f scripts/performance_pass.sh ]; then bash scripts/performance_pass.sh; fi
if [ -f scripts/review_two_stage.sh ]; then bash scripts/review_two_stage.sh; fi

# Release report
rep="RELEASE_REPORT.md"
{
  echo "# Release Report"
  echo ""
  echo "Target: $target"
  echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo ""
  echo "## Commands Run"
  echo "- bash scripts/check.sh"
  if [ -f playwright.config.ts ] || [ -f playwright.config.js ]; then
    echo "- bash scripts/playwright_smoke.sh \"/\""
  fi
  echo "- bash scripts/firebase_rules_guard.sh (if present)"
  echo "- bash scripts/performance_pass.sh (if present)"
  echo "- bash scripts/review_two_stage.sh"
  echo ""
  echo "## Outputs"
  echo "- REVIEW_REPORT.md"
  echo "- FIREBASE_RULES_REPORT.md (if rules script ran)"
  echo "- PERFORMANCE_REPORT.md (if perf script ran)"
  echo ""
  echo "## Notes"
  echo "- Verify Firebase Hosting rewrites/headers if deploying a SPA route."
} > "$rep"

echo "✅ Wrote $rep"
