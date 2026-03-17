#!/usr/bin/env bash
set -euo pipefail

echo "==> Running lint"
if npm run -s lint >/dev/null 2>&1; then
  npm run -s lint
else
  npx -s next lint
fi

if [ -f "tsconfig.json" ]; then
  echo "==> Running typecheck"
  npx -s tsc --noEmit
else
  echo "==> No tsconfig.json found, skipping typecheck"
fi

echo "==> Running build"
if npm run -s build >/dev/null 2>&1; then
  npm run -s build
else
  npx -s next build
fi

echo "✅ check complete"
