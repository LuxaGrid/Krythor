#!/usr/bin/env node
/**
 * scripts/tag-release.js
 *
 * Creates a release tag and pushes it to trigger the GitHub Actions release workflow.
 *
 * Usage:
 *   node scripts/tag-release.js           — tag using current version in package.json
 *   node scripts/tag-release.js 1.1.0     — bump version, tag, push
 *   pnpm release                          — same as first form
 *   pnpm release 1.1.0                    — same as second form
 *
 * What it does:
 *   1. Optionally bumps version in package.json
 *   2. Commits the version bump
 *   3. Creates annotated git tag vX.Y.Z
 *   4. Pushes commit + tag to origin/main
 *
 * The tag push triggers .github/workflows/release.yml which builds
 * and publishes the full release automatically.
 */

const { execSync } = require('child_process');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');

const GREEN = '\x1b[32m';
const CYAN  = '\x1b[36m';
const RED   = '\x1b[31m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

function run(cmd, opts = {}) {
  const result = execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe', ...opts });
  return result ? result.trim() : '';
}

function die(msg) {
  console.error(`${RED}✗ ${msg}${RESET}`);
  process.exit(1);
}

function ok(msg)   { console.log(`${GREEN}✓${RESET} ${msg}`); }
function info(msg) { console.log(`${DIM}  ${msg}${RESET}`); }

// ── Preflight ──────────────────────────────────────────────────────────────────
// Ensure working tree is clean
try {
  const status = run('git status --porcelain');
  if (status && !process.argv[2]) {
    die('Working tree is not clean. Commit or stash changes first.\n  ' + status.split('\n').join('\n  '));
  }
} catch (e) {
  die('git not available: ' + e.message);
}

// ── Determine version ──────────────────────────────────────────────────────────
const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const newVersion = process.argv[2] || pkg.version;

if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  die(`Invalid version format: ${newVersion}. Use X.Y.Z`);
}

const tag = `v${newVersion}`;
console.log(`\n${CYAN}  KRYTHOR — Tag Release${RESET}`);
console.log(`${DIM}  Version: ${tag}${RESET}\n`);

// ── Check tag doesn't already exist ───────────────────────────────────────────
try {
  const existing = run(`git tag -l ${tag}`);
  if (existing === tag) die(`Tag ${tag} already exists. Delete it first: git tag -d ${tag}`);
} catch { /* ok */ }

// ── Bump version if provided ───────────────────────────────────────────────────
if (process.argv[2] && newVersion !== pkg.version) {
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  ok(`Bumped package.json to ${newVersion}`);

  run('git add package.json', { stdio: 'inherit' });
  run(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });
  ok('Version bump committed');
} else {
  info(`Using existing version ${newVersion} from package.json`);
}

// ── Create annotated tag ───────────────────────────────────────────────────────
run(`git tag -a ${tag} -m "Krythor ${tag}"`, { stdio: 'inherit' });
ok(`Created tag: ${tag}`);

// ── Push commit + tag ──────────────────────────────────────────────────────────
info('Pushing to origin...');
run('git push origin main', { stdio: 'inherit' });
run(`git push origin ${tag}`, { stdio: 'inherit' });
ok(`Pushed ${tag} to origin`);

console.log(`\n${GREEN}  Release triggered!${RESET}`);
console.log(`\n  GitHub Actions is now building:`);
console.log(`    • krythor-win-x64.zip`);
console.log(`    • krythor-linux-x64.zip`);
console.log(`    • krythor-macos-x64.zip`);
console.log(`    • Krythor-Setup-${newVersion}.exe`);
console.log(`\n  Monitor at:`);
console.log(`    https://github.com/LuxaGrid/Krythor/actions`);
console.log(`\n  Release will appear at:`);
console.log(`    https://github.com/LuxaGrid/Krythor/releases/tag/${tag}`);
console.log('');
