#!/usr/bin/env bash
set -euo pipefail

out="PERFORMANCE_REPORT.md"
echo "# Performance Pass (Next.js + Firebase)" > "$out"
echo "" >> "$out"
echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$out"
echo "" >> "$out"

echo "## Quick Checks" >> "$out"

# firebase-admin imported in UI paths
if rg -n "from ['\"]firebase-admin['\"]|require\(['\"]firebase-admin['\"]\)" -S . 2>/dev/null | rg -n "pages|src/pages|app|src/app|components|src/components" -S >/tmp/_perf_admin.txt 2>/dev/null; then
  if [ -s /tmp/_perf_admin.txt ]; then
    echo "- ❌ firebase-admin imported in UI paths (can bloat bundle / break builds)." >> "$out"
  else
    echo "- ✅ No firebase-admin import detected in UI paths." >> "$out"
  fi
else
  echo "- ✅ No firebase-admin import detected in UI paths." >> "$out"
fi

# large JSON assets
if [ -d "public" ]; then
  big=$(find public -type f -size +500k 2>/dev/null | head -n 5 || true)
  if [ -n "$big" ]; then
    echo "- ⚠️ Large files in public/ (>500KB). Consider optimization:" >> "$out"
    echo "  - $big" | sed 's/^/  /' >> "$out"
  else
    echo "- ✅ No unusually large public assets found (>500KB)." >> "$out"
  fi
fi

# next/image usage hint
if rg -n "<img\s" -S pages src/pages app src/app 2>/dev/null | head -n 1 >/dev/null; then
  echo "- ⚠️ Raw <img> tags found. Consider next/image for optimization (where appropriate)." >> "$out"
else
  echo "- ✅ No obvious raw <img> usage found (or not detected)." >> "$out"
fi

# React memoization hint (very light)
if rg -n "useEffect\(" -S src/pages pages src/components components app src/app 2>/dev/null | wc -l | awk '{exit ($1>50)?0:1}'; then
  echo "- ⚠️ Many useEffect hooks detected. Double-check dependencies and avoid unnecessary re-renders." >> "$out"
fi

echo "" >> "$out"
echo "## Recommendations" >> "$out"
echo "- Keep Firebase client SDK usage only in client code; keep Admin SDK only server-side." >> "$out"
echo "- Prefer next/image for large images and set width/height." >> "$out"
echo "- Add a smoke test and run it before deploy." >> "$out"

echo "" >> "$out"
echo "✅ Wrote $out"
