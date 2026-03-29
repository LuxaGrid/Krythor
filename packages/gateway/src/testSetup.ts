// ── Test global setup ──────────────────────────────────────────────────────────
//
// Runs once before any test file executes.
// Points KRYTHOR_DATA_DIR at a fresh per-run temp directory so tests never
// read from or write to the real user data directory.
//
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
