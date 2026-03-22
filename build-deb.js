#!/usr/bin/env node
// ─── build-deb.js ─────────────────────────────────────────────────────────────
//
// Builds a Debian .deb package from krythor-dist-linux/.
//
// Prerequisites (Linux only):
//   - dpkg-deb CLI tool (apt install dpkg)
//   - krythor-dist-linux/ must exist (run: node bundle.js --platform linux --arch x64)
//
// Usage:
//   node build-deb.js
//
// Output:
//   krythor-<version>-linux-amd64.deb
//

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'fs';
import { join } from 'path';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const version = pkg.version;

const distDir = 'krythor-dist-linux';
if (!existsSync(distDir)) {
  console.error(`✗ ${distDir} not found. Run: node bundle.js --platform linux --arch x64`);
  process.exit(1);
}

const debDir = 'deb-build';
const installDir = join(debDir, 'usr', 'lib', 'krythor');
const debianDir = join(debDir, 'DEBIAN');

mkdirSync(installDir, { recursive: true });
mkdirSync(debianDir, { recursive: true });
mkdirSync(join(debDir, 'usr', 'bin'), { recursive: true });

// Copy dist
cpSync(distDir, installDir, { recursive: true });

// DEBIAN/control
const control = `Package: krythor
Version: ${version}
Architecture: amd64
Maintainer: Krythor <noreply@krythor.ai>
Description: Krythor — local-first AI command platform
 Local-first AI orchestration gateway with multi-agent support,
 memory, guard engine, and a web-based control panel.
Installed-Size: 150000
Priority: optional
Section: utils
Homepage: https://github.com/krythor/krythor
`;
writeFileSync(join(debianDir, 'control'), control);

// DEBIAN/postinst — create symlink
const postinst = `#!/bin/bash
set -e
ln -sf /usr/lib/krythor/runtime/node /usr/bin/krythor-node 2>/dev/null || true
chmod +x /usr/lib/krythor/start.js 2>/dev/null || true
ln -sf /usr/lib/krythor/start.js /usr/bin/krythor 2>/dev/null || true
echo "Krythor ${version} installed. Run: krythor start"
`;
writeFileSync(join(debianDir, 'postinst'), postinst, { mode: 0o755 });

// DEBIAN/prerm — remove symlinks
const prerm = `#!/bin/bash
set -e
rm -f /usr/bin/krythor /usr/bin/krythor-node 2>/dev/null || true
`;
writeFileSync(join(debianDir, 'prerm'), prerm, { mode: 0o755 });

const outDeb = `krythor-${version}-linux-amd64.deb`;

console.log(`Building .deb for Krythor v${version}...`);
execSync(`dpkg-deb --build ${debDir} ${outDeb}`, { stdio: 'inherit' });

console.log(`✓ Built: ${outDeb}`);
console.log(`  Install: sudo dpkg -i ${outDeb}`);
