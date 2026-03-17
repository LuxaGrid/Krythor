#!/usr/bin/env bash
set -euo pipefail

rules="firestore.rules"
out="FIREBASE_RULES_REPORT.md"

echo "# Firebase Rules Guard" > "$out"
echo "" >> "$out"
echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$out"
echo "" >> "$out"

if [ ! -f "$rules" ]; then
  echo "⚠️ No firestore.rules found at repo root." >> "$out"
  echo "" >> "$out"
  echo "If you keep rules elsewhere, update this script or pass path via skill notes." >> "$out"
  echo "✅ Wrote $out"
  exit 0
fi

echo "## Findings" >> "$out"
echo "" >> "$out"

# Red flags
flag=0
if rg -n "allow\s+read\s*,\s*write\s*:\s*if\s+true\s*;" "$rules" >/tmp/_rules_true.txt 2>/dev/null; then
  if [ -s /tmp/_rules_true.txt ]; then
    flag=1
    echo "- ❌ `allow read, write: if true;` found (deny-by-default violated)." >> "$out"
  fi
fi

if rg -n "allow\s+write\s*:\s*if\s+true\s*;" "$rules" >/tmp/_rules_wtrue.txt 2>/dev/null; then
  if [ -s /tmp/_rules_wtrue.txt ]; then
    flag=1
    echo "- ❌ `allow write: if true;` found." >> "$out"
  fi
fi

if rg -n "match\s+/\{document=\*\*\}" "$rules" >/tmp/_rules_wild.txt 2>/dev/null; then
  if [ -s /tmp/_rules_wild.txt ]; then
    echo "- ⚠️ catch-all match \`/{document=**}\` detected. Ensure constraints + auth checks exist." >> "$out"
  fi
fi

if rg -n "request\.auth\s*==\s*null" "$rules" >/tmp/_rules_unauth.txt 2>/dev/null; then
  if [ -s /tmp/_rules_unauth.txt ]; then
    echo "- ⚠️ unauthenticated access patterns found. Verify intent." >> "$out"
  fi
fi

if [ "$flag" -eq 0 ]; then
  echo "- ✅ No obvious 'allow if true' patterns found." >> "$out"
fi

echo "" >> "$out"
echo "## Next Steps" >> "$out"
echo "- Keep rules least-privilege: user-scoped paths, auth required, validate data shape." >> "$out"
echo "- If you change rules, add emulator tests (recommended)." >> "$out"

echo "" >> "$out"
echo "✅ Wrote $out"
