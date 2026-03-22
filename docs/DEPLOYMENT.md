# Krythor Deployment Guide

## Running in Production

### Daemon mode (recommended for persistent use)

Start Krythor as a background daemon process:

```bash
krythor start --daemon
```

Stop:

```bash
krythor stop
```

Restart:

```bash
krythor restart
```

The daemon writes a PID file to `<dataDir>/krythor.pid`. The gateway logs to stdout/stderr of the spawned process.

### Daemon on Linux with systemd

Create `/etc/systemd/system/krythor.service`:

```ini
[Unit]
Description=Krythor AI Gateway
After=network.target

[Service]
Type=simple
User=<your-user>
WorkingDirectory=/home/<your-user>/.krythor
ExecStart=/home/<your-user>/.krythor/runtime/node /home/<your-user>/.krythor/start.js --no-browser
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable krythor
sudo systemctl start krythor
sudo systemctl status krythor
```

### Daemon on macOS with launchd

Create `~/Library/LaunchAgents/ai.krythor.gateway.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.krythor.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/<your-user>/.krythor/runtime/node</string>
    <string>/Users/<your-user>/.krythor/start.js</string>
    <string>--no-browser</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/krythor.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/krythor.err</string>
</dict>
</plist>
```

Load:

```bash
launchctl load ~/Library/LaunchAgents/ai.krythor.gateway.plist
```

---

## Docker

### Quick start

```bash
docker compose up -d
```

This builds the image, starts the gateway on port 47200, and mounts a named volume (`krythor-data`) for persistent storage.

### Build only (no compose)

```bash
docker build -t krythor .
docker run -d -p 47200:47200 -v krythor-data:/data krythor
```

### Environment variables in Docker

```bash
docker run -d \
  -p 47200:47200 \
  -v krythor-data:/data \
  -e KRYTHOR_DATA_DIR=/data \
  -e NODE_ENV=production \
  krythor
```

### Accessing the control UI from Docker

Open `http://localhost:47200` in your browser. The auth token is injected into the UI automatically.

To find the token for API access:

```bash
docker exec -it <container-id> cat /data/config/app-config.json
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `KRYTHOR_DATA_DIR` | Platform default | Override the data directory path |
| `NODE_ENV` | `development` | Set to `production` to disable pino-pretty logging |
| `CORS_ORIGINS` | (none) | Comma-separated additional allowed origins |

Platform defaults for `KRYTHOR_DATA_DIR`:

| Platform | Default path |
|---|---|
| Windows | `%LOCALAPPDATA%\Krythor` |
| macOS | `~/Library/Application Support/Krythor` |
| Linux | `~/.local/share/krythor` |

---

## Backup Strategy

### Manual backup

```bash
krythor backup
```

Creates a timestamped zip archive in the current directory. Use `--output <dir>` to specify a destination.

### What is backed up

The `krythor backup` command archives the entire data directory, which includes:

- `config/` — providers, agents, policy, app-config, gateway-id
- `memory/` — SQLite database (all memory entries, conversations, agent runs, learning records)
- `templates/` — user-edited workspace templates

### Automated backup with cron

```cron
# Back up Krythor daily at 2am
0 2 * * * krythor backup --output /backups/krythor/
```

### Restore from backup

```bash
# Unzip to the data directory
unzip krythor-backup-2026-03-21-020000.zip -d "$(krythor status --json | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).dataDir")"
```

Or use the rollback feature for database-only recovery:

```bash
krythor-setup --rollback
```

---

## Update Flow

### From one-line installer (recommended)

```bash
krythor update
```

Re-runs the one-line installer for your platform. Your data and configuration are preserved.

### Manual update

1. Download the new zip from the [Releases page](https://github.com/LuxaGrid/Krythor/releases/latest)
2. Stop Krythor: `krythor stop`
3. Extract over the existing installation (overwrite all files)
4. Start Krythor: `krythor start`

Data is never stored in the installation directory, so overwriting is always safe.

### Docker update

```bash
docker compose pull
docker compose up -d
```

Or rebuild:

```bash
docker compose build --no-cache
docker compose up -d
```

---

## Production Checklist

- [ ] Gateway starts on boot (systemd/launchd/Docker restart policy)
- [ ] Data directory is outside the installation folder (default — no action needed)
- [ ] Backup runs regularly (cron or manual)
- [ ] `krythor doctor` reports no critical issues
- [ ] Auth token is non-empty (check `app-config.json`)
- [ ] Port 47200 is not exposed to the internet (default: loopback only)
- [ ] Providers have valid credentials (`krythor doctor` validates these)
