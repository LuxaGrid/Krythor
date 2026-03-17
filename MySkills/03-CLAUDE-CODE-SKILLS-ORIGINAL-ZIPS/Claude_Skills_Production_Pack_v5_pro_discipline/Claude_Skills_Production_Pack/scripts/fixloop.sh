#!/usr/bin/env bash
set -euo pipefail

note="${*:-}"
bash scripts/bugpack.sh "$note"

latest="$(ls -1 .bugpacks 2>/dev/null | tail -n 1 || true)"
if [ -z "$latest" ]; then
  echo "No BugPack found."
  exit 1
fi

dir=".bugpacks/${latest}"
echo "==> Latest BugPack: $dir"

echo "==> Primary failure (best effort):"
# Try to extract the first line containing 'error' from check output
grep -inE "^(.*error.*)$" "$dir/check.txt" | head -n 20 || true

echo ""
echo "Next steps:"
echo "1) Open: $dir/check.txt and $dir/repro.md"
echo "2) Paste into Claude Code with your Fix prompt"
echo "3) Apply smallest patch, then re-run: bash scripts/check.sh"
