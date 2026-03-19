#!/usr/bin/env node
/**
 * fetch-node.js
 *
 * Downloads the official Node.js Windows x64 binary and places it at
 * installer/node.exe so Inno Setup can bundle it into the installer.
 *
 * Usage: node installer/fetch-node.js
 *
 * The Node version fetched matches the engines requirement in package.json.
 * Override with: NODE_FETCH_VERSION=20.19.0 node installer/fetch-node.js
 */

const { existsSync, mkdirSync, createWriteStream, renameSync } = require('fs');
const { join, dirname } = require('path');
const https = require('https');

const OUT_DIR  = __dirname;
const OUT_PATH = join(OUT_DIR, 'node.exe');

// Default to the LTS version that matches our engines: >=20
const NODE_VERSION = process.env.NODE_FETCH_VERSION || '20.19.0';
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`;

const GREEN = '\x1b[32m';
const CYAN  = '\x1b[36m';
const DIM   = '\x1b[2m';
const RESET = '\x1b[0m';

if (existsSync(OUT_PATH)) {
  console.log(`${GREEN}✓${RESET} installer/node.exe already exists — skipping download.`);
  console.log(`${DIM}  Delete installer/node.exe and re-run to force a fresh download.${RESET}`);
  process.exit(0);
}

console.log(`\n${CYAN}  Fetching Node.js v${NODE_VERSION} for installer bundling…${RESET}`);
console.log(`${DIM}  Source: ${NODE_URL}${RESET}\n`);

mkdirSync(OUT_DIR, { recursive: true });

const TMP_PATH = OUT_PATH + '.tmp';
const file = createWriteStream(TMP_PATH);

function download(url, redirects = 0) {
  if (redirects > 5) {
    console.error('Too many redirects.');
    process.exit(1);
  }
  https.get(url, (res) => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      file.close();
      return download(res.headers.location, redirects + 1);
    }
    if (res.statusCode !== 200) {
      console.error(`Failed to download node.exe: HTTP ${res.statusCode}`);
      process.exit(1);
    }

    const total = parseInt(res.headers['content-length'] || '0', 10);
    let received = 0;

    res.on('data', chunk => {
      received += chunk.length;
      if (total > 0) {
        const pct = Math.floor((received / total) * 100);
        process.stdout.write(`\r  ${DIM}Downloading… ${pct}%${RESET}  `);
      }
    });

    res.pipe(file);
    file.on('finish', () => {
      file.close(() => {
        renameSync(TMP_PATH, OUT_PATH);
        console.log(`\n\n${GREEN}✓${RESET} installer/node.exe ready  ${DIM}(${(received / 1024 / 1024).toFixed(1)} MB)${RESET}`);
        console.log(`${DIM}  Now run Inno Setup compiler on installer/krythor.iss${RESET}\n`);
      });
    });
  }).on('error', err => {
    console.error('Download error:', err.message);
    process.exit(1);
  });
}

download(NODE_URL);
