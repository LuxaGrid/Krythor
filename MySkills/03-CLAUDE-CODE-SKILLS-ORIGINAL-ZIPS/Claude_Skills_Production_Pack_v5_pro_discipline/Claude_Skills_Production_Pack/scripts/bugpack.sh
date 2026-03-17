#!/usr/bin/env bash
set -euo pipefail

note="${*:-}"
stamp="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
dir=".bugpacks/${stamp}"
mkdir -p "$dir"

# Meta
{
  echo "time: $stamp"
  echo "git: $(git rev-parse --short HEAD 2>/dev/null || echo n/a)"
  echo "branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo n/a)"
  echo "node: $(node -v 2>/dev/null || echo n/a)"
  echo "npm: $(npm -v 2>/dev/null || echo n/a)"
  echo "platform: $(uname -a 2>/dev/null || echo n/a)"
} > "$dir/meta.txt"

# Repro
cat > "$dir/repro.md" <<EOF
# Repro
Command run:
Expected:
Actual:

# Note
${note}
EOF

# Outputs (capture even if failing)
( bash scripts/check.sh 2>&1 || true ) > "$dir/check.txt"
( npm ls --depth=2 2>&1 || true ) > "$dir/npm_ls.txt"
( npm audit --audit-level=moderate 2>&1 || true ) > "$dir/npm_audit.txt"

# Env keys only (never values)
node - <<'NODE' > "$dir/env_keys.txt" 2>/dev/null || true
const keys = Object.keys(process.env).sort();
for (const k of keys) {
  const v = process.env[k];
  const isSecretish = /KEY|SECRET|TOKEN|PASS|PRIVATE|SERVICE_ACCOUNT/i.test(k);
  if (isSecretish) {
    console.log(`${k}=<redacted>`);
  } else {
    console.log(`${k}=${v ? "SET" : "UNSET"}`);
  }
}
NODE

echo "✅ BugPack created: $dir"
