#!/usr/bin/env bash
set -euo pipefail

out="REVIEW_REPORT.md"
plan="PLAN.md"

echo "# Two-Stage Review" > "$out"
echo "" >> "$out"
echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$out"
echo "" >> "$out"

echo "## Pass 1 — Spec Compliance" >> "$out"
if [ -f "$plan" ]; then
  echo "- PLAN.md found ✅" >> "$out"
  echo "- Check acceptance criteria and scope alignment." >> "$out"
else
  echo "- ⚠️ PLAN.md not found. Review against intended goal in commit/PR description." >> "$out"
fi
echo "" >> "$out"
echo "Checklist:" >> "$out"
echo "- Routes/screens match plan" >> "$out"
echo "- Loading/Empty/Error states present where data is shown" >> "$out"
echo "- No scope creep (extra features not requested)" >> "$out"
echo "" >> "$out"

echo "## Pass 2 — Code Quality" >> "$out"
echo "Checklist:" >> "$out"
echo "- Client/server boundary: no firebase-admin or node-only modules in UI paths" >> "$out"
echo "- Env safety: client uses only NEXT_PUBLIC_*; no secrets logged" >> "$out"
echo "- Firebase rules: least privilege (no allow if true)" >> "$out"
echo "- Tailwind consistency: primitives used, consistent spacing/type" >> "$out"
echo "- Errors actionable (not swallowed)" >> "$out"
echo "" >> "$out"

echo "## Suggested Commands" >> "$out"
echo "- bash scripts/check.sh" >> "$out"
echo "- bash scripts/firebase_rules_guard.sh" >> "$out"
echo "- bash scripts/performance_pass.sh" >> "$out"
echo "- bash scripts/playwright_smoke.sh \"/\"" >> "$out"

echo "" >> "$out"
echo "✅ Wrote $out"
