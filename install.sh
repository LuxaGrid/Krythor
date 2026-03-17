#!/usr/bin/env bash
set -e

echo "========================================"
echo " KRYTHOR — Installer"
echo "========================================"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js is not installed."
  echo "Install it from https://nodejs.org (version 18+)"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "ERROR: Node.js 18+ is required (you have $(node --version))"
  echo "Update at https://nodejs.org"
  exit 1
fi

# Check pnpm
if ! command -v pnpm &> /dev/null; then
  echo "pnpm not found. Installing..."
  npm install -g pnpm
fi

echo "Installing dependencies..."
pnpm install

echo "Building Krythor..."
pnpm build

echo ""
echo "========================================"
echo " Build complete!"
echo " Run the setup wizard: node packages/setup/dist/bin/setup.js"
echo " Then start Krythor:   node start.js"
echo "========================================"
