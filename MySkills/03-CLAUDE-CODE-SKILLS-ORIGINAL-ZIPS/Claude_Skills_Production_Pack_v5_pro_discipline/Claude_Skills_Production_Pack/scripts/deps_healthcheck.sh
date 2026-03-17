#!/usr/bin/env bash
set -euo pipefail

echo "==> Node: $(node -v 2>/dev/null || echo n/a)"
echo "==> NPM:  $(npm -v 2>/dev/null || echo n/a)"

echo "==> Lockfile"
if [ -f package-lock.json ]; then
  echo "package-lock.json ✅"
elif [ -f pnpm-lock.yaml ]; then
  echo "pnpm-lock.yaml ✅"
elif [ -f yarn.lock ]; then
  echo "yarn.lock ✅"
else
  echo "⚠️ No lockfile found (repeat bugs incoming)."
fi

echo "==> npm audit (moderate+)"
npm audit --audit-level=moderate || true

echo "==> Duplicate core deps check (react/next/firebase)"
npm ls react next firebase --depth=0 2>/dev/null || true

echo "✅ deps healthcheck done"
