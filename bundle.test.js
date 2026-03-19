/**
 * Smoke tests for bundle.js helper functions.
 * Run with: node --test bundle.test.js
 *
 * These are basic sanity checks that don't require pnpm or a full build.
 * They verify the bundle script's logic without actually running it.
 */

const { existsSync } = require('fs');
const { join } = require('path');
const assert = require('assert');

// Verify bundle.js itself exists and is loadable as text
const bundlePath = join(__dirname, 'bundle.js');
assert.ok(existsSync(bundlePath), 'bundle.js must exist');

// Verify start.js exists (required by bundle)
const startPath = join(__dirname, 'start.js');
assert.ok(existsSync(startPath), 'start.js must exist');

// Verify Krythor.bat exists
const batPath = join(__dirname, 'Krythor.bat');
assert.ok(existsSync(batPath), 'Krythor.bat must exist');

// Verify Krythor-Setup.bat exists
const setupBatPath = join(__dirname, 'Krythor-Setup.bat');
assert.ok(existsSync(setupBatPath), 'Krythor-Setup.bat must exist');

// Verify INSTALL.txt template contains required sections
const bundleSrc = require('fs').readFileSync(bundlePath, 'utf-8');
assert.ok(bundleSrc.includes('REQUIREMENTS'), 'INSTALL.txt template must include REQUIREMENTS');
assert.ok(bundleSrc.includes('INSTALL — Windows'), 'INSTALL.txt template must include Windows steps');
assert.ok(bundleSrc.includes('YOUR DATA'), 'INSTALL.txt template must include data location');
assert.ok(bundleSrc.includes('UNINSTALL'), 'INSTALL.txt template must include uninstall section');

console.log('✓ bundle.js smoke tests passed');
