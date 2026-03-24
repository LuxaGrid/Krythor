#!/usr/bin/env node
// Post-build script — runs after `vite build`.
//
// 1. Injects CACHE_NAME into dist/sw.js based on package.json version
//    (format: krythor-<version>-<build-timestamp>)
//    This forces the browser to evict the old cache on every release.
//
// 2. Copies built dist to ~/.krythor/packages/control/dist/ if it exists
//    (binary install location) so the running gateway always serves the
//    latest UI without a manual copy step.

import { existsSync, cpSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const srcDist = join(root, 'dist');

// ── 0. Derive version from git commit count ───────────────────────────────────
// Uses `git rev-list --count HEAD` as the patch segment so every push
// automatically produces a higher, unique version without needing to commit
// package.json changes.
import { execSync } from 'child_process';

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const [major, minor] = pkg.version.split('.').map(Number);

let commitCount = 0;
try {
  commitCount = parseInt(execSync('git rev-list --count HEAD', { cwd: root }).toString().trim(), 10);
} catch {
  // Not a git repo or git unavailable — fall back to timestamp-based patch
  commitCount = Math.floor(Date.now() / 1000) % 100000;
}

pkg.version = `${major}.${minor}.${commitCount}`;
console.log(`\x1b[32m✔ Version: ${pkg.version} (${commitCount} commits)\x1b[0m`);

// Also bump gateway package.json so health endpoint serves the same version
const gatewayPkgPath = join(root, '..', 'gateway', 'package.json');
if (existsSync(gatewayPkgPath)) {
  const gatewayPkg = JSON.parse(readFileSync(gatewayPkgPath, 'utf8'));
  gatewayPkg.version = pkg.version;
  writeFileSync(gatewayPkgPath, JSON.stringify(gatewayPkg, null, 2) + '\n', 'utf8');
  console.log(`\x1b[32m✔ Gateway version bumped to ${pkg.version}\x1b[0m`);
}

// ── 1. Inject cache version into sw.js ────────────────────────────────────────
const cacheVersion = `krythor-${pkg.version}-${Date.now()}`;
const swPath = join(srcDist, 'sw.js');

if (existsSync(swPath)) {
  const sw = readFileSync(swPath, 'utf8');
  const patched = sw.replace('__KRYTHOR_CACHE_VERSION__', cacheVersion);
  writeFileSync(swPath, patched, 'utf8');
  console.log(`\x1b[32m✔ SW cache version: ${cacheVersion}\x1b[0m`);
}

// ── 2. Deploy to ~/.krythor if binary install exists ─────────────────────────
const installDist = join(homedir(), '.krythor', 'packages', 'control', 'dist');

if (!existsSync(installDist)) {
  process.exit(0);
}

// Remove stale hashed assets from the install target
const assetsDir = join(installDist, 'assets');
if (existsSync(assetsDir)) {
  const srcAssets = new Set(readdirSync(join(srcDist, 'assets')));
  for (const file of readdirSync(assetsDir)) {
    if (!srcAssets.has(file)) {
      rmSync(join(assetsDir, file));
    }
  }
}

cpSync(srcDist, installDist, { recursive: true, force: true });
console.log(`\x1b[32m✔ UI deployed to ~/.krythor\x1b[0m`);
