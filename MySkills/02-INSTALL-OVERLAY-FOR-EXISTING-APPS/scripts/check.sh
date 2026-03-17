#!/usr/bin/env bash
set -euo pipefail

echo "== LuxaGrid PRO Check =="
echo "Working dir: $(pwd)"
echo

# Prefer npm scripts if present
if [ -f package.json ]; then
  echo "-- package.json detected"
else
  echo "-- No package.json found. Add your own checks here."
  exit 0
fi

run_if_exists() {
  local script="$1"
  if npm run | grep -qE "^[[:space:]]+$script"; then
    echo ">> npm run $script"
    npm run "$script"
  else
    echo ">> (skip) npm run $script not found"
  fi
}

# Common scripts
run_if_exists lint
run_if_exists typecheck
run_if_exists test
run_if_exists build

echo
echo "== Checks complete =="
