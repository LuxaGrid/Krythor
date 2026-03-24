# Krythor — Build System Reference

Complete reference for the monorepo build layout, toolchain, scripts, and CI/CD pipeline.

---

## Table of Contents

1. [Overview](#overview)
2. [Toolchain](#toolchain)
3. [Monorepo Layout](#monorepo-layout)
4. [Package Dependency Graph](#package-dependency-graph)
5. [Per-Package Build Details](#per-package-build-details)
6. [Build Scripts Reference](#build-scripts-reference)
7. [Distribution Pipeline](#distribution-pipeline)
8. [Docker](#docker)
9. [GitHub Actions CI/CD](#github-actions-cicd)
10. [Development Workflow](#development-workflow)
11. [Release Workflow](#release-workflow)
12. [Environment & Configuration Files](#environment--configuration-files)

---

## Overview

Krythor is a **pnpm monorepo** with 8 packages built as a layered stack. Backend packages compile with **tsup** (esbuild-based TypeScript bundler). The React control UI compiles with **Vite**. All packages output to their own `dist/` directory.

The build pipeline has two stages:

1. **Compile** — `pnpm build` compiles all 8 packages in dependency order
2. **Bundle** — `node bundle.js` assembles a self-contained distribution folder with a bundled Node.js runtime, compiled packages, native bindings, and launcher files

From there, platform-specific packaging tools (Inno Setup, dpkg-deb, pkgbuild/productbuild, SEA) produce installable artifacts.

GitHub Actions runs this full pipeline on every version tag push and publishes release assets automatically.

---

## Toolchain

| Tool | Version | Role |
|------|---------|------|
| Node.js | ≥ 20 | Runtime; SEA (Node 20+) for Windows exe |
| pnpm | 9.15.4 (pinned) | Package manager; workspace orchestration |
| TypeScript | ^5.7.3 | Language for all packages |
| tsup | ^8.3.5 | Backend TypeScript bundler (esbuild under the hood) |
| Vite | ^6.0.7 | React UI bundler and dev server |
| Vitest | ^2.1.x | Test runner across all packages |
| Fastify | ^5.2.x | HTTP/WebSocket gateway framework |
| React | ^18.3.x | Control UI framework |
| Tailwind CSS | ^3.4.x | Utility-first CSS for the control UI |
| better-sqlite3 | ^11.0.x | SQLite native binding (memory store) |
| Inno Setup 6 | — | Windows installer compiler (Windows builds only) |
| postject | — | Node SEA blob injector (installed on demand) |
| pkgbuild / productbuild | — | macOS installer tools (macOS builds only) |
| dpkg-deb | — | Debian package builder (Linux builds only) |

---

## Monorepo Layout

```
Krythor/
├── package.json              Root manifest — workspace scripts, bin entry
├── pnpm-workspace.yaml       Workspace: packages/*
├── pnpm-lock.yaml            Locked dependency tree
├── tsconfig.base.json        Shared TypeScript config for backend packages
├── .npmrc                    pnpm settings (shamefully-hoist, store paths)
│
├── packages/
│   ├── gateway/              @krythor/gateway  — Fastify HTTP + WebSocket server
│   ├── control/              @krythor/control  — React dashboard UI
│   ├── core/                 @krythor/core     — Agent orchestrator, runner, SOUL
│   ├── memory/               @krythor/memory   — SQLite memory engine, embeddings
│   ├── models/               @krythor/models   — Model registry, router, circuit breaker
│   ├── guard/                @krythor/guard    — Policy engine (allow/deny)
│   ├── skills/               @krythor/skills   — Skill registry and runner
│   └── setup/                @krythor/setup    — CLI wizard, diagnostics, doctor/repair
│
├── start.js                  Launcher (start, status, repair commands)
├── bundle.js                 Distribution packager
├── build-exe.js              Windows SEA executable builder
├── build-installer.js        Windows Inno Setup installer compiler
├── build-release.js          Windows full-pipeline orchestrator
├── build-pkg.js              macOS .pkg installer builder
├── build-deb.js              Linux .deb package builder
├── sign.js                   Windows code signing (signtool)
│
├── scripts/
│   └── tag-release.js        Version bumper, tagger, push-to-CI trigger
│
├── installer/
│   ├── krythor.iss           Inno Setup script
│   └── fetch-node.js         Downloads Node.js for the installer
│
├── .github/
│   └── workflows/
│       └── release.yml       Release CI/CD (build → publish on tag push)
│
├── Dockerfile                Docker image (node:20-alpine, non-root)
├── docker-compose.yml        Compose service definition
│
└── docs/                     Documentation
```

---

## Package Dependency Graph

All packages are private (not published individually). Only the root `krythor` package is published to npm.

```
@krythor/gateway
  ├── @krythor/core
  │     ├── @krythor/memory
  │     │     └── better-sqlite3 (native)
  │     └── @krythor/models
  ├── @krythor/guard
  ├── @krythor/memory
  ├── @krythor/models
  └── @krythor/skills

@krythor/setup
  ├── @krythor/core
  ├── @krythor/guard
  ├── @krythor/memory
  └── @krythor/models

@krythor/control   (standalone — no workspace deps; talks to gateway via HTTP)
```

`pnpm build` resolves this graph and builds packages in the correct order. tsup handles each backend package; Vite handles the control UI.

---

## Per-Package Build Details

### gateway — `@krythor/gateway`

| Field | Value |
|-------|-------|
| Type | `commonjs` |
| Bundler | tsup |
| Entry | `src/index.ts` |
| Output | `dist/index.js` + `dist/index.d.ts` |
| Dev mode | `tsup --watch` |
| Test runner | Vitest |

The gateway is the runtime hub. It imports all other backend packages and exposes the full API surface over HTTP and WebSocket on port 47200. During development, `pnpm dev` runs tsup in watch mode for the gateway; the control UI runs separately on port 47210 with Vite proxying `/api` and `/ws` to the gateway.

**Key external dependencies:** `fastify`, `@fastify/websocket`, `@fastify/static`, `@fastify/cors`, `@fastify/rate-limit`

---

### control — `@krythor/control`

| Field | Value |
|-------|-------|
| Type | `module` (ESM) |
| Bundler | Vite 6 |
| Dev server | Port 47210 |
| Output | `dist/` (served by gateway as static files) |
| Type checker | `tsc --noEmit` (no emit; Vite does the actual bundling) |

**vite.config.ts:**
```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 47210,
    proxy: {
      '/api': 'http://127.0.0.1:47200',
      '/ws':  { target: 'ws://127.0.0.1:47200', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

The dev server proxy makes all `/api` calls and WebSocket connections from the control UI hit the running gateway, so both can be developed simultaneously without CORS issues.

**Key dependencies:** `react`, `react-dom`, `react-markdown`, `react-syntax-highlighter`, `remark-gfm`
**Key devDependencies:** `@vitejs/plugin-react`, `tailwindcss`, `postcss`, `autoprefixer`, `typescript`, `vite`

---

### core — `@krythor/core`

| Field | Value |
|-------|-------|
| Type | `commonjs` |
| Bundler | tsup |
| Output | `dist/index.js` |

Agent orchestration, SOUL identity system, agent runner, tool-call loop, learning record store, model recommender. Imports `@krythor/memory` and `@krythor/models`.

---

### memory — `@krythor/memory`

| Field | Value |
|-------|-------|
| Type | `commonjs` |
| Bundler | tsup |
| Output | `dist/index.js` |
| Native dep | `better-sqlite3` (must be rebuilt for each target platform/Node version) |

Persistent memory engine. BM25 + semantic hybrid retrieval. SQLite via `better-sqlite3`. Migration runner loads SQL files from disk at runtime. This is the only package with a native binary dependency, which means each distribution bundle must include a platform-specific `better-sqlite3.node` file rebuilt against the bundled Node runtime.

---

### models — `@krythor/models`

| Field | Value |
|-------|-------|
| Type | `commonjs` |
| Bundler | tsup |
| Output | `dist/index.js` |

Model registry, router, provider adapters (OpenAI, Anthropic, Ollama, LM Studio, GGUF, OpenRouter, Groq, Venice, generic OpenAI-compatible), circuit breaker, heartbeat engine, selection reason / fallback tracking.

---

### guard — `@krythor/guard`

| Field | Value |
|-------|-------|
| Type | `commonjs` |
| Bundler | tsup |
| Output | `dist/index.js` |

Policy engine. Allow/deny rules per operation. Persistent audit trail. Live test mode.

---

### skills — `@krythor/skills`

| Field | Value |
|-------|-------|
| Type | `commonjs` |
| Bundler | tsup |
| Output | `dist/index.js` |

Skill registry, runner, built-in templates (summarize, translate, explain). Skill task profiles for routing hints.

---

### setup — `@krythor/setup`

| Field | Value |
|-------|-------|
| Type | `commonjs` |
| Bundler | tsup |
| Bin | `dist/bin/setup.js` |
| Output | `dist/index.js` |

CLI first-run wizard, `doctor` diagnostics, `repair` auto-fix. Called by `start.js` for `krythor doctor` and `krythor repair` commands. Imports core, memory, models, guard.

---

## Build Scripts Reference

### Root `package.json` scripts

```json
{
  "build":           "pnpm -r build",
  "dev":             "pnpm --filter @krythor/gateway dev",
  "start":           "node start.js",
  "setup":           "node packages/setup/dist/bin/setup.js",
  "doctor":          "node packages/setup/dist/bin/setup.js doctor",
  "test":            "pnpm -r test",
  "clean":           "pnpm -r clean",
  "bundle":          "node bundle.js",
  "build:bundle":    "pnpm build && node bundle.js",
  "build:exe":       "node build-exe.js",
  "build:installer": "node build-installer.js",
  "build:sign":      "node sign.js",
  "build:release":   "node build-release.js",
  "build:pkg":       "node build-pkg.js",
  "build:deb":       "node build-deb.js",
  "release":         "node scripts/tag-release.js"
}
```

---

### `bundle.js` — Cross-platform distribution packager

Creates a self-contained distribution folder for any target platform, including a bundled Node.js 20.19.0 runtime.

**Usage:**
```bash
node bundle.js                               # Auto-detect current platform
node bundle.js --platform win                # Windows x64
node bundle.js --platform linux              # Linux x64
node bundle.js --platform mac --arch arm64   # macOS Apple Silicon
node bundle.js --platform mac --arch x64     # macOS Intel
```

**What it does:**
1. Detects or reads target `--platform` and `--arch` flags
2. Downloads the matching Node.js 20.19.0 binary from nodejs.org
3. Copies all `packages/*/dist/` compiled output
4. Writes minimal `package.json` stubs for each `@krythor/*` package in `node_modules/`
5. Copies `better-sqlite3` native bindings for the target platform
6. Copies SQL migration files (loaded at runtime from disk)
7. Copies launcher files (`Krythor.bat`, `start.sh`, `install.ps1`, `install.sh`)
8. Generates distribution docs (`INSTALL.txt`, `RELEASE-NOTES.txt`, `README-DISTRIBUTION.txt`)
9. Writes output to `krythor-dist-{platform}/`

**Output structure:**
```
krythor-dist-win/          (or -linux, -mac)
├── packages/
│   ├── gateway/dist/
│   ├── control/dist/      ← React UI static files served by gateway
│   ├── core/dist/
│   ├── memory/dist/
│   ├── models/dist/
│   ├── guard/dist/
│   ├── skills/dist/
│   └── setup/dist/
├── node_modules/
│   ├── @krythor/          ← package stubs (point to packages/*/dist/)
│   └── better-sqlite3/    ← native module + platform .node binary
├── runtime/
│   └── node.exe           ← (or just `node` on Unix)
├── start.js
├── package.json
├── Krythor.bat            ← Windows launcher
├── INSTALL.txt
├── RELEASE-NOTES.txt
└── README-DISTRIBUTION.txt
```

---

### `build-exe.js` — Windows SEA (Single Executable Application)

Bundles `start.js` + the Node.js runtime into a single `krythor.exe` using the Node.js SEA feature introduced in Node 20.

**Prerequisites:** Node.js 20+, Windows, gateway already built

**Usage:**
```bash
node build-exe.js
# or
pnpm build:exe
```

**Process:**
1. Validates Node 20+ and Windows platform
2. Verifies gateway is compiled (`packages/gateway/dist/index.js` exists)
3. Installs `postject` if not present
4. Generates SEA config (`sea-config.json`)
5. Runs `node --experimental-sea-config sea-config.json` to produce the blob
6. Copies `node.exe` to `krythor.exe` in the project root
7. Injects the SEA blob into `krythor.exe` using `postject`

**Output:** `krythor.exe` in project root

---

### `build-installer.js` — Windows Inno Setup installer

Compiles the Inno Setup script into a `.exe` installer.

**Prerequisites:** Inno Setup 6 installed, `krythor-dist-win/` exists

**Usage:**
```bash
node build-installer.js
# or
pnpm build:installer
```

**Process:**
1. Verifies `krythor-dist-win/` is present and built
2. Fetches Node.js binary via `installer/fetch-node.js` (for the installer's bundled runtime)
3. Locates `iscc.exe` (searches standard Inno Setup install paths and `PATH`)
4. Compiles `installer/krythor.iss` with `iscc.exe`

**Output:** `installer-out/Krythor-Setup-{version}.exe`

---

### `build-release.js` — Windows full-pipeline orchestrator

Runs the complete Windows release pipeline in sequence.

**Usage:**
```bash
node build-release.js                  # Full pipeline
node build-release.js --skip-exe       # Skip SEA exe
node build-release.js --skip-sign      # Force skip code signing
```

**Pipeline:**
```
pnpm build
  → node bundle.js --platform win
  → node build-exe.js        (unless --skip-exe)
  → node sign.js             (if KRYTHOR_SIGN_PFX set)
  → node build-installer.js
  → node sign.js             (if KRYTHOR_SIGN_PFX set)
  → zip krythor-dist-win/ → krythor-win-x64.zip
```

**Output artifacts:**
- `krythor-win-x64.zip`
- `installer-out/Krythor-Setup-{version}.exe`
- `krythor.exe` (unless skipped)

---

### `build-pkg.js` — macOS .pkg installer

Builds a macOS package installer using the system `pkgbuild` and `productbuild` tools.

**Prerequisites:** macOS, Xcode Command Line Tools, `krythor-dist-mac/` exists

**Usage:**
```bash
node build-pkg.js               # Default arch: arm64
node build-pkg.js --arch x64    # Intel
# or
pnpm build:pkg
```

**Process:**
1. Validates `krythor-dist-mac/` exists
2. Assembles package payload at `pkg-build/payload/usr/local/lib/krythor/`
3. Writes postinstall script (creates symlinks in `/usr/local/bin/`)
4. Runs `pkgbuild` to produce component package
5. Runs `productbuild` to produce distribution package

**Output:** `krythor-{version}-macos-{arch}.pkg`

---

### `build-deb.js` — Linux .deb package

Builds a Debian package for Linux.

**Prerequisites:** Linux, `dpkg-deb` installed (`apt install dpkg`), `krythor-dist-linux/` exists

**Usage:**
```bash
node build-deb.js
# or
pnpm build:deb
```

**Process:**
1. Validates `krythor-dist-linux/` exists
2. Creates Debian package structure under `deb-build/`
3. Generates `DEBIAN/control`, `DEBIAN/postinst`, `DEBIAN/prerm` scripts
4. Runs `dpkg-deb --build`

**Output:** `krythor-{version}-linux-amd64.deb`

---

### `sign.js` — Windows code signing

Signs executables with a PFX certificate using `signtool.exe` from the Windows SDK.

**Usage:**
```bash
node sign.js                    # Sign all release artifacts
node sign.js --dry-run          # Preview (no files modified)
node sign.js --skip-if-no-cert  # Silently skip if cert not configured
```

**Required env vars:**
```
KRYTHOR_SIGN_PFX       — Path to the .pfx certificate file
KRYTHOR_SIGN_PASSWORD  — Certificate password
KRYTHOR_SIGN_TIMESTAMP — (optional) RFC 3161 timestamp server URL
                         Default: http://timestamp.sectigo.com
```

**Signs:** `krythor.exe` and `installer-out/Krythor-Setup-{version}.exe`

After signing, runs `signtool verify` and prints a warning if verification fails.

---

### `scripts/tag-release.js` — Version tagging

Bumps the version, commits, tags, and pushes to trigger GitHub Actions.

**Usage:**
```bash
node scripts/tag-release.js            # Tag current version
node scripts/tag-release.js 2.2.0     # Bump to 2.2.0, tag, push
pnpm release                           # Alias: tag current version
pnpm release 2.2.0                     # Alias: bump + tag + push
```

**Process:**
1. Reads current version from `package.json`
2. If a version argument is given: validates format (X.Y.Z), checks tag doesn't exist, bumps `package.json`, commits
3. Creates annotated git tag `v{version}`
4. Pushes commit and tag to `origin/main`
5. Prints the GitHub Actions URL to watch

---

### `start.js` — Launcher

The main entry point for all CLI commands. Handles start, status, and repair modes.

**Usage:**
```bash
node start.js                         # Start gateway + open browser
node start.js --no-browser            # Start without opening browser
node start.js --no-update-check       # Skip GitHub release check

krythor status                        # Print gateway health
krythor status --json                 # Machine-readable JSON health
krythor repair                        # Run all diagnostics
krythor repair --fix --yes            # Auto-fix issues (unattended)
```

**Health checks run during `krythor repair`:**

| Check | What it verifies |
|-------|-----------------|
| Runtime | Bundled `runtime/node` exists and executes |
| Native module | `better-sqlite3` loads without error |
| Gateway | `/health` endpoint responds (if already running) |
| Config file | `providers.json` exists and is valid JSON |
| Providers | At least one provider is configured |
| Credentials | Each provider has required keys/tokens |
| Data dir | Config directory exists and is writable |
| Agents file | `agents.json` exists (scaffolds default if missing) |
| App config | `app-config.json` exists with auth token |
| Log dir | Log directory exists |

---

## Distribution Pipeline

### Full pipeline — all platforms

```
┌──────────────────────────────────────────────────┐
│                  pnpm build                      │
│  Compiles 8 packages in dependency order:        │
│  memory → models → guard → skills                │
│  → core → setup → gateway                        │
│  → control (Vite)                                │
└────────────────────────┬─────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    Windows x64     Linux x64     macOS x64 + arm64
    bundle.js       bundle.js       bundle.js
          │              │              │
          ▼              ▼              ▼
  krythor-dist-win/ krythor-dist-linux/ krythor-dist-mac/
  (includes bundled   (includes bundled   (includes bundled
   Node 20.19.0)       Node 20.19.0)       Node 20.19.0)
          │              │              │
          ▼              ▼              ▼
  build-exe.js     build-deb.js    build-pkg.js
  krythor.exe      *.deb           *.pkg
          │
          ▼
  sign.js  (if cert)
          │
          ▼
  build-installer.js
  Krythor-Setup-{v}.exe
          │
          ▼
  sign.js  (if cert)
          │
          ▼
  zip artifacts
  krythor-win-x64.zip
```

### `better-sqlite3` rebuild requirement

`better-sqlite3` is a native Node.js addon compiled against a specific Node ABI. Each distribution bundle ships with a pre-compiled `.node` binary that matches the bundled Node.js 20.19.0 runtime for that platform. When `bundle.js` assembles the distribution, it must use a `better-sqlite3.node` file rebuilt against the bundled Node — not the one compiled against whatever Node is installed on the dev machine.

In GitHub Actions, the matrix job handles this automatically by compiling `better-sqlite3` against the downloaded bundled Node binary before packaging.

---

## Docker

### Dockerfile

`node:20-alpine` base. Installs build tools for native module compilation (`python3 make g++`), installs `pnpm@9.15.4`, copies all source, runs `pnpm install --frozen-lockfile` + `pnpm build`, then runs as a non-root `krythor` user.

The data directory is exposed as a volume at `/data` (controlled by `KRYTHOR_DATA_DIR=/data`).

```bash
# Build image
docker build -t krythor .

# Run with persistent data
docker run -p 47200:47200 -v krythor-data:/data krythor

# Or with Compose
docker compose up -d
docker compose down
docker compose logs -f
```

**docker-compose.yml:**
```yaml
services:
  krythor:
    build: .
    ports:
      - "47200:47200"
    volumes:
      - krythor-data:/data
    environment:
      - KRYTHOR_DATA_DIR=/data
      - NODE_ENV=production
    restart: unless-stopped

volumes:
  krythor-data:
```

---

## GitHub Actions CI/CD

**Workflow file:** `.github/workflows/release.yml`
**Trigger:** `push` on tags matching `v*` (e.g. `v2.1.0`)

### Jobs

#### `build` (matrix)

Runs in parallel across 4 configurations:

| Runner | Platform | Arch |
|--------|----------|------|
| `windows-latest` | Windows | x64 |
| `ubuntu-latest` | Linux | x64 |
| `macos-latest` | macOS | arm64 |
| `macos-13` | macOS | x64 |

**Steps per matrix job:**
1. Checkout code
2. Install pnpm 9.15.4 and Node 20
3. `pnpm install --frozen-lockfile`
4. Extract version from git tag
5. Patch version in `package.json` (and `installer/krythor.iss` on Windows)
6. `pnpm build` — compile all packages
7. Verify control UI output exists in `packages/control/dist/`
8. `node bundle.js --platform {platform} --arch {arch}` — create distribution bundle
9. Verify control UI present in bundle
10. Rebuild `better-sqlite3` against bundled Node runtime
11. Verify `better-sqlite3` loads under bundled runtime
12. **Windows only:** Install Inno Setup, fetch Node for installer, `node build-installer.js`, rename installer
13. **Linux only:** `node build-deb.js`
14. **macOS only:** `node build-pkg.js --arch {arch}`
15. Rename distribution folder to final artifact name
16. Zip distribution
17. Upload artifacts to GitHub Actions

#### `docker`

Builds the Docker image to verify the Dockerfile is correct. Does not push to any registry.

#### `release` (depends on `build` + `docker`)

1. Downloads all build artifacts
2. Creates GitHub Release with auto-generated release notes
3. Uploads all release assets:
   - `krythor-win-x64.zip`
   - `krythor-linux-x64.zip`
   - `krythor-macos-arm64.zip`
   - `krythor-macos-x64.zip`
   - `Krythor-Setup-{version}.exe`
   - `krythor-{version}-linux-amd64.deb`
   - `krythor-{version}-macos-arm64.pkg`
   - `krythor-{version}-macos-x64.pkg`

#### `npm-publish` (depends on `release`)

1. Checkout, install pnpm and Node 20
2. Patch version in `package.json`
3. `pnpm build`
4. Publish to npm with `NPM_TOKEN` secret

---

## Development Workflow

### First-time setup

```bash
git clone https://github.com/LuxaGrid/Krythor
cd Krythor
pnpm install
pnpm build
node start.js
```

Then open **http://localhost:47200**.

### Day-to-day development

**Gateway only (backend changes):**
```bash
pnpm dev
# tsup --watch rebuilds gateway on every save
# open http://localhost:47200 (served from packages/control/dist/)
```

**Control UI + gateway (frontend changes):**
```bash
# Terminal 1 — gateway with watch
pnpm dev

# Terminal 2 — Vite dev server
cd packages/control
pnpm dev
# open http://localhost:47210
# /api and /ws are proxied to gateway at port 47200
```

**Running tests:**
```bash
pnpm test              # All packages
pnpm --filter @krythor/memory test   # Single package
```

**Cleaning all dist folders:**
```bash
pnpm clean
```

### TypeScript

Backend packages (`gateway`, `core`, `memory`, `models`, `guard`, `skills`, `setup`) all extend `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

The control UI uses a separate tsconfig for the browser/bundler environment:
- `module: ESNext`, `moduleResolution: bundler`
- `allowImportingTsExtensions: true` (Vite handles `.tsx` imports)
- `noEmit: true` (Vite does the emit; `tsc --noEmit` is for type-checking only)
- `jsx: react-jsx`

---

## Release Workflow

### Releasing a new version

```bash
# 1. Ensure working tree is clean
git status

# 2. Run full test suite
pnpm test

# 3. Tag and push (triggers GitHub Actions)
pnpm release 2.2.0
```

`tag-release.js` will:
- Bump version in `package.json` to `2.2.0`
- Commit `chore: bump version to 2.2.0`
- Create annotated tag `v2.2.0`
- Push commit + tag to `origin/main`

GitHub Actions then runs the 4-platform matrix build, creates the GitHub Release, and publishes to npm.

### Building locally for testing

```bash
# Compile
pnpm build

# Bundle for current platform
node bundle.js

# Windows: full release pipeline
node build-release.js

# Linux: bundle + .deb
node bundle.js --platform linux
node build-deb.js

# macOS ARM64: bundle + .pkg
node bundle.js --platform mac --arch arm64
node build-pkg.js --arch arm64
```

### Manual distribution test

After bundling, test the distribution folder directly without installing:

```bash
# Windows
cd krythor-dist-win
runtime\node.exe start.js

# Linux / macOS
cd krythor-dist-linux   # or krythor-dist-mac
runtime/node start.js
```

---

## Environment & Configuration Files

### `.npmrc`

```
shamefully-hoist=true
store-dir=C:/pnpm-store
virtual-store-dir=.pnvm
```

- `shamefully-hoist` — hoists all deps to `node_modules/` root. Required because some packages (notably Fastify plugins and `better-sqlite3`) don't work correctly with pnpm's strict symlink layout.
- `store-dir` — global pnpm content-addressable store (avoids redundant downloads across projects).

### `pnpm-workspace.yaml`

```yaml
packages:
  - 'packages/*'
```

All 8 packages under `packages/` are workspace members. Packages reference each other as `workspace:*` in their `dependencies`.

### `tsconfig.base.json`

Base config inherited by all backend packages. Sets `ES2022` target, `Node16` module resolution, strict mode, and source maps. Each package's `tsconfig.json` extends this and overrides `outDir`/`rootDir`.

### Environment variables at runtime

See `docs/ENV_VARS.md` for the full list. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `KRYTHOR_DATA_DIR` | OS-specific app data | Root for all user data (SQLite DB, config files, logs) |
| `KRYTHOR_PORT` | `47200` | HTTP/WebSocket port |
| `KRYTHOR_HOST` | `127.0.0.1` | Bind address (loopback only by default) |
| `KRYTHOR_LOG_LEVEL` | `info` | Pino log level |
| `KRYTHOR_SIGN_PFX` | — | Path to PFX cert for code signing |
| `KRYTHOR_SIGN_PASSWORD` | — | PFX certificate password |
| `NODE_ENV` | `development` | Set to `production` in Docker / release builds |
