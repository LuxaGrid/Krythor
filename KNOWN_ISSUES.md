# Known Issues

## Active

### WhatsApp Live Session — QR Pairing Required
- **Status:** Installed (baileys v7.0.0-rc.9)
- **Impact:** WhatsApp inbound channels require a one-time QR code scan to link to a WhatsApp account
- **Setup:**
  1. Add a WhatsApp channel in the Chat Channels tab
  2. Click "Get Pairing Code" — this starts the session and generates a QR code logged to the gateway console
  3. Scan the QR with WhatsApp on your phone (Linked Devices → Link a Device)
  4. The channel status will change to `connected` once paired
- **Note:** Auth state persists in `~/.krythor/whatsapp-session/` — no re-scan needed after restart

### Node.js Version Mismatch (binary install)
- **Status:** Known
- **Impact:** Running gateway from `~/.krythor` with a different Node.js version than the one used to compile `better-sqlite3` causes `ERR_DLOPEN_FAILED`
- **Fix:** Always use the bundled runtime at `~/.krythor/runtime/node.exe` (Windows) to start the installed gateway. The `Krythor.bat` launcher handles this automatically.

### Bundle Size Warning (control)
- **Status:** Non-blocking warning
- **Impact:** `packages/control` builds a single ~1.27 MB JS bundle. Vite warns but the build succeeds and the app loads correctly.
- **Fix (future):** Code-split with `build.rollupOptions.output.manualChunks` to reduce initial load time.

### SOUL.md Not Found
- **Status:** Non-blocking
- **Impact:** Gateway logs `[SystemIdentityProvider] SOUL.md not found — using built-in fallback identity.` on startup in dev/test environments.
- **Fix:** Place a `SOUL.md` file in the repo root or `~/.krythor/` to customize the agent identity.

## Resolved

- **v0.2.1**: deploy-dist.js now copies gateway dist to `~/.krythor` on every build — previously required a manual copy after gateway code changes.
- **v0.2.0**: Channel status was not persisted to registry on InboundChannelManager start — fixed by calling `recordHealthCheck()` on start/fail.
- **v0.1.x**: Safety mode "Balanced" always reverted to "power-user" when no custom rules existed — fixed by persisting chosen mode to localStorage.
