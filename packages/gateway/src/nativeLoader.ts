/**
 * nativeLoader.ts
 *
 * Ensures the correct better-sqlite3 native binary exists for the running
 * Node.js version in the node-pre-gyp versioned path that `bindings` checks.
 *
 * Problem: better-sqlite3 is a native addon compiled for a specific
 * NODE_MODULE_VERSION (NMV). The dev system uses Node v24 (NMV 137) while
 * the production runtime uses Node v20 (NMV 115). Whichever ran `node-gyp
 * rebuild` last wins, breaking the other environment.
 *
 * Fix: store both prebuilt binaries in repo/native/ keyed by NMV. On first
 * run, copy each into its own versioned `lib/binding/node-v{NMV}-{platform}-
 * {arch}/` directory inside the better-sqlite3 package. `bindings` checks
 * those paths automatically (node-pre-gyp convention), so each Node version
 * picks up its own file without conflict or lock contention.
 *
 * This runs at gateway startup and is a no-op once the versioned file exists.
 */

import { copyFileSync, statSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

const NMV      = process.versions.modules;
const PLATFORM = process.platform;
const ARCH     = process.arch;

const repoRoot = resolve(__dirname, '..', '..', '..');
const src      = join(repoRoot, 'native', `better_sqlite3_napi${NMV}.node`);

// node-pre-gyp style versioned directory — `bindings` resolves this automatically
const bsRoot   = join(repoRoot, '.pnvm', 'better-sqlite3@11.10.0', 'node_modules', 'better-sqlite3');
const versionedDir  = join(bsRoot, 'lib', 'binding', `node-v${NMV}-${PLATFORM}-${ARCH}`);
const versionedDest = join(versionedDir, 'better_sqlite3.node');

if (!existsSync(src)) {
  // No prebuilt for this NMV — fall back to whatever is in build/Release/.
  process.stderr.write(`[nativeLoader] No prebuilt for NMV ${NMV} — using existing binary\n`);
} else if (!existsSync(versionedDest)) {
  // First time this NMV runs — populate its versioned directory.
  try {
    mkdirSync(versionedDir, { recursive: true });
    copyFileSync(src, versionedDest);
    process.stdout.write(`[nativeLoader] Installed Node NMV-${NMV} better-sqlite3 binary\n`);
  } catch (e) {
    process.stderr.write(`[nativeLoader] Could not install versioned binary: ${(e as Error).message}\n`);
  }
}
// If versionedDest already exists the correct binary is in place — no-op.
