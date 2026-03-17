#!/usr/bin/env bash
set -euo pipefail

out="ARCHITECTURE_REPORT.md"
echo "# Architecture Scan" > "$out"
echo "" >> "$out"
echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$out"
echo "" >> "$out"

router="unknown"
if [ -d "pages" ] || [ -d "src/pages" ]; then router="pages"; fi
if [ -d "app" ] || [ -d "src/app" ]; then
  if [ "$router" = "unknown" ]; then router="app"; else router="both"; fi
fi

echo "## Router" >> "$out"
echo "- Detected: **$router**" >> "$out"
echo "" >> "$out"

echo "## Structure" >> "$out"
for d in src pages app public scripts templates tests; do
  if [ -d "$d" ]; then echo "- ✅ $d/" >> "$out"; fi
done
echo "" >> "$out"

echo "## Potential Issues (best effort)" >> "$out"
# server-only in client locations
if rg -n "from ['\"]firebase-admin['\"]|require\(['\"]firebase-admin['\"]\)" -S . 2>/dev/null | rg -n "pages|src/pages|app|src/app|components|src/components" -S >/tmp/_arch_admin.txt 2>/dev/null; then
  if [ -s /tmp/_arch_admin.txt ]; then
    echo "- ⚠️ firebase-admin import found in UI paths (check client/server boundary):" >> "$out"
    echo "  - See lines in repo search output (run ripgrep)." >> "$out"
  fi
fi

# process.env usage in components
if rg -n "process\.env\.[A-Z0-9_]+" -S src/pages pages src/components components app src/app 2>/dev/null | head -n 1 >/dev/null; then
  echo "- ⚠️ process.env usage in UI code detected. Ensure only NEXT_PUBLIC_* is used on client." >> "$out"
fi

# duplicate UI patterns
if [ -d "src/components/ui" ]; then
  echo "- ✅ UI primitives folder present (src/components/ui)" >> "$out"
else
  echo "- ⚠️ No src/components/ui primitives folder found (recommend creating)." >> "$out"
fi

echo "" >> "$out"
echo "## Recommendations" >> "$out"
echo "- Keep UI primitives in \`src/components/ui/\` and feature components in \`src/components/<feature>/\`." >> "$out"
echo "- Keep server-only code in \`src/lib/server/\` (or similar) and never import it into client components." >> "$out"
echo "- Add or enforce \`src/lib/env.ts\` validation to avoid config drift." >> "$out"

echo "" >> "$out"
echo "✅ Wrote $out"
