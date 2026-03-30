// ── Test global setup ──────────────────────────────────────────────────────────
//
// Runs once before any test file executes.
// 1. Ensures the correct better-sqlite3 binary is in place for this Node version.
// 2. Points KRYTHOR_DATA_DIR at a fresh per-run temp directory so tests never
//    read from or write to the real user data directory.
//
import { mkdtempSync, rmSync, copyFileSync, statSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

// ── Native binary selection (mirrors nativeLoader.ts logic) ──────────────────
// Populate the versioned node-pre-gyp directory for this Node version so
// `bindings` resolves the correct binary without touching build/Release/.
const NMV      = process.versions.modules;
const PLATFORM = process.platform;
const ARCH     = process.arch;
const repoRoot  = resolve(__dirname, '..', '..', '..', '..');
const src       = join(repoRoot, 'native', `better_sqlite3_napi${NMV}.node`);
const bsRoot    = join(repoRoot, '.pnvm', 'better-sqlite3@11.10.0', 'node_modules', 'better-sqlite3');
const vDir      = join(bsRoot, 'lib', 'binding', `node-v${NMV}-${PLATFORM}-${ARCH}`);
const vDest     = join(vDir, 'better_sqlite3.node');

if (existsSync(src) && !existsSync(vDest)) {
  try {
    const { mkdirSync } = require('fs');
    mkdirSync(vDir, { recursive: true });
    copyFileSync(src, vDest);
  } catch { /* non-fatal */ }
}

let testDataDir: string;

export function setup() {
  testDataDir = mkdtempSync(join(tmpdir(), 'krythor-test-'));
  process.env['KRYTHOR_DATA_DIR'] = testDataDir;
}

export function teardown() {
  try {
    rmSync(testDataDir, { recursive: true, force: true });
  } catch { /* non-fatal */ }
}
