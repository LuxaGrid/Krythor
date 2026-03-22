#!/usr/bin/env node
// ─── build-pkg.js ─────────────────────────────────────────────────────────────
//
// Builds a macOS .pkg installer from krythor-dist-mac/.
//
// Prerequisites (macOS only):
//   - pkgbuild and productbuild CLI tools (bundled with Xcode Command Line Tools)
//   - krythor-dist-mac/ must exist (run: node bundle.js --platform mac --arch arm64)
//
// Usage:
//   node build-pkg.js [--arch arm64|x64]
//
// Output:
//   krythor-<version>-macos-<arch>.pkg
//

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'fs';
import { join } from 'path';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const version = pkg.version;

const arch = process.argv.includes('--arch') ?
  process.argv[process.argv.indexOf('--arch') + 1] : 'arm64';

const distDir = `krythor-dist-mac`;
if (!existsSync(distDir)) {
  console.error(`✗ ${distDir} not found. Run: node bundle.js --platform mac --arch ${arch}`);
  process.exit(1);
}

const buildDir = 'pkg-build';
const installPrefix = '/usr/local/lib/krythor';
const scriptDir = join(buildDir, 'scripts');
const payloadDir = join(buildDir, 'payload', 'usr', 'local', 'lib', 'krythor');

mkdirSync(scriptDir, { recursive: true });
mkdirSync(payloadDir, { recursive: true });

// Copy dist into payload
cpSync(distDir, payloadDir, { recursive: true });

// postinstall script — creates symlink in /usr/local/bin
const postinstall = `#!/bin/bash
set -e
ln -sf ${installPrefix}/runtime/node /usr/local/bin/krythor-node 2>/dev/null || true
ln -sf ${installPrefix}/start.js /usr/local/bin/krythor 2>/dev/null || true
chmod +x ${installPrefix}/start.js 2>/dev/null || true
echo "Krythor ${version} installed to ${installPrefix}"
`;
writeFileSync(join(scriptDir, 'postinstall'), postinstall, { mode: 0o755 });

const outPkg = `krythor-${version}-macos-${arch}.pkg`;
const componentPkg = join(buildDir, 'krythor-component.pkg');

console.log(`Building macOS .pkg for Krythor v${version} (${arch})...`);

// Build component package
execSync(`pkgbuild \
  --root ${join(buildDir, 'payload')} \
  --identifier ai.krythor.gateway \
  --version ${version} \
  --scripts ${scriptDir} \
  --install-location / \
  ${componentPkg}`, { stdio: 'inherit' });

// Build distribution package
execSync(`productbuild \
  --package ${componentPkg} \
  --identifier ai.krythor.gateway \
  --version ${version} \
  ${outPkg}`, { stdio: 'inherit' });

console.log(`✓ Built: ${outPkg}`);
console.log(`  Install: sudo installer -pkg ${outPkg} -target /`);
