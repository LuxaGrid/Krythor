#!/usr/bin/env node
// Auto-deploy built UI to ~/.krythor/packages/control/dist/ if it exists.
// Runs as a post-build step so the installed binary always gets the latest UI.

import { existsSync, cpSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDist = join(__dirname, '..', 'dist');
const installDist = join(homedir(), '.krythor', 'packages', 'control', 'dist');

if (!existsSync(installDist)) {
  // Not a binary install — nothing to do
  process.exit(0);
}

// Remove stale hashed assets (old index-*.js / index-*.css) from install target
const assetsDir = join(installDist, 'assets');
if (existsSync(assetsDir)) {
  const srcAssets = new Set(readdirSync(join(srcDist, 'assets')));
  for (const file of readdirSync(assetsDir)) {
    if (!srcAssets.has(file)) {
      rmSync(join(assetsDir, file));
    }
  }
}

// Copy all files from dist → install target
cpSync(srcDist, installDist, { recursive: true, force: true });

console.log(`\x1b[32m✔ UI deployed to ~/.krythor\x1b[0m`);
