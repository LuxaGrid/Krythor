# AI Changelog

Tracks all AI-assisted implementation work on this codebase.

---

## 2026-03-26 — v0.2.1: Shell Execution + Live Channels + Wizard Channels Step

### Shell Execution (access profile enforced)
- `packages/gateway/src/routes/tools.shell.ts` — new file
  - `POST /api/tools/shell/exec` — spawn commands, safe=denied, standard+full allowed
  - `GET /api/tools/shell/processes` — list processes via wmic (Windows) / ps aux (Unix)
  - `POST /api/tools/shell/kill` — terminate by PID, full_access only
  - Audit logged, 1 MB output cap, 5 min timeout max, shell:false (no injection risk)
- `packages/gateway/src/routes/tools.shell.test.ts` — 15 tests
- `packages/control/src/api.ts` — added `shellExec()`, `listProcesses()`, `killProcess()`

### Live Inbound Channel Sessions
- `packages/gateway/src/TelegramInbound.ts` — new file
  - Long-poll `getUpdates` loop, typing indicator, AbortController stop, seeds offset on start
- `packages/gateway/src/WhatsAppInbound.ts` — new file
  - Dynamic import of `@whiskeysockets/baileys` (install-on-demand)
  - QR code pairing via `getPairingQR()`, reconnect with exponential backoff
- `packages/gateway/src/InboundChannelManager.ts` — new file
  - Starts/stops all enabled channels from ChatChannelRegistry on boot
  - Records health check status to registry on start/fail
- `packages/gateway/src/routes/chatChannels.ts` — added `POST /api/chat-channels/:id/restart`
- `packages/gateway/src/ChatChannelRegistry.ts` — made `recordHealthCheck` public
- `packages/gateway/src/server.ts` — wired InboundChannelManager, cleanup on close

### Setup Wizard Channels Step
- `packages/control/src/components/OnboardingWizard.tsx` — added channels step
  - New flow: welcome → provider → channels → done
  - Provider cards (Telegram/Discord/WhatsApp) with inline credential forms
  - Saves configured channels via API, "Skip for now" option
  - Done summary row shows channels configured count

### Deploy Fix
- `packages/control/scripts/deploy-dist.js` — now copies gateway dist to `~/.krythor` on every build

---

## 2026-03-26 — v0.2.0: Channel Onboarding + File Access + Access Profiles

### A. Chat Channel Onboarding
- `packages/gateway/src/ChatChannelRegistry.ts` — Telegram/Discord/WhatsApp provider registry, 6-state status, credential masking
- `packages/gateway/src/routes/chatChannels.ts` — 9 REST endpoints
- `packages/control/src/components/ChatChannelsPanel.tsx` — full UI panel
- `packages/control/src/api.ts` — Chat Channels API bindings

### B. File + Computer Access (9 operations)
- `packages/gateway/src/routes/tools.file.ts` — read/write/edit/move/copy/delete/mkdir/list/stat + audit

### C. Access Profiles
- `packages/gateway/src/AccessProfileStore.ts` — safe/standard/full_access, 500-entry ring buffer
- `packages/gateway/src/routes/agents.ts` — GET/PUT `/api/agents/:id/access-profile`
- `packages/control/src/components/AgentsPanel.tsx` — access profile badge with dropdown

### D. UI
- `packages/control/src/App.tsx` — Chat Channels tab added
- `packages/control/src/components/command-center/` — dynamic user agents in Command Center

### E. Tests
- 108 new tests: AccessProfileStore (24), ChatChannelRegistry (34), tools.file (22), chatChannels (28)

### F. Documentation
- `README.md`, `docs/channels.md`, `docs/permissions.md`, `CHANGELOG.md`

---

## 2026-03-22 — v0.4: UI Surface Pass

- Ctrl+K command palette, slash commands
- Log copy/expand
- EventStream rewrite
- Heartbeat/circuit dashboard
- Provider advanced settings
- Webhook test-fire
- reportOverride learning

---

## 2026-03-19 — v0.3: Distribution + Auto-provider Detection

- Node SEA executable build
- selectionReason/fallbackOccurred wired end-to-end
- Auto-provider detection
- Branding polish
- Migration 005

---

## 2026-03-19 — v0.2: Polish Pass

- Windows launch fix
- First-run readiness card
- Model ping lastUnavailableReason
- Memory search mode indicator
- 18 new tests

---

## 2026-03-18 — v0.1: Core Platform

- SOUL.md, HeartbeatEngine, LearningRecordStore, ModelRecommender
- Release hardening: structured logging, model fallback, memory retention, crash recovery
