# Remote Gateway Access

This guide explains how to expose a Krythor gateway running on one machine to clients on other machines — securely and without opening firewall ports directly.

---

## Overview

By default Krythor binds to `127.0.0.1:3000` (localhost only). To reach it from another device you have three options:

| Method | Difficulty | Best for |
|--------|-----------|----------|
| SSH tunnel | Low | Single developer, ad-hoc access |
| Tailscale | Low | Team / multi-device, zero config |
| Nginx reverse proxy | Medium | Production / multi-user, TLS |

All three methods require the gateway to already be running (`krythor` or `krythor --port 3000`).

---

## Option 1 — SSH Tunnel (simplest)

Requires SSH access to the machine running the gateway.

### Connecting from a remote machine

```bash
# On your laptop — forward local port 3000 to the gateway host
ssh -L 3000:127.0.0.1:3000 user@gateway-host
```

Now browse to `http://localhost:3000` or point your TUI at `http://localhost:3000`.

### Persistent tunnel (background, auto-reconnect)

```bash
ssh -fNL 3000:127.0.0.1:3000 -o ServerAliveInterval=60 -o ExitOnForwardFailure=yes user@gateway-host
```

### TUI usage after tunnel is up

```bash
krythor tui --port 3000
# or
KRYTHOR_PORT=3000 krythor tui
```

---

## Option 2 — Tailscale (recommended for teams)

[Tailscale](https://tailscale.com) creates a private mesh network between your devices. No port forwarding, no firewall changes required.

### Setup

1. Install Tailscale on both the gateway machine and client machines.
2. Authenticate both: `tailscale up`
3. Find the gateway machine's Tailscale IP: `tailscale ip -4` (e.g. `100.64.1.5`)

### Bind the gateway to its Tailscale interface

```bash
# gateway machine
KRYTHOR_HOST=0.0.0.0 krythor
# or edit start.js HOST variable if using the standalone binary
```

> **Note:** Tailscale traffic is encrypted end-to-end. You do not need TLS if you trust your Tailscale network.

### Connect from a client

```bash
krythor tui --host 100.64.1.5 --port 3000
```

Or set permanently:

```bash
export KRYTHOR_GATEWAY_HOST=100.64.1.5
export KRYTHOR_GATEWAY_PORT=3000
krythor tui
```

### Tailscale ACL (access control)

To restrict which devices can reach the gateway, use a Tailscale ACL entry in your admin panel:

```json
{
  "action": "accept",
  "src":  ["tag:krythor-client"],
  "dst":  ["tag:krythor-server:3000"]
}
```

---

## Option 3 — Nginx Reverse Proxy (production / multi-user)

Use Nginx when you want TLS termination, domain names, rate limiting, or multiple gateways behind one host.

### Prerequisites

- Nginx installed on the gateway machine (or a separate proxy host).
- A domain name pointing to your server.
- A TLS certificate (Let's Encrypt / certbot recommended).

### Nginx configuration

```nginx
server {
    listen 443 ssl http2;
    server_name krythor.example.com;

    ssl_certificate     /etc/letsencrypt/live/krythor.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/krythor.example.com/privkey.pem;

    # Only allow HTTPS
    add_header Strict-Transport-Security "max-age=31536000" always;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # Increase timeouts for long agent runs
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}

server {
    listen 80;
    server_name krythor.example.com;
    return 301 https://$host$request_uri;
}
```

### CORS configuration

If the UI or API client is on a different origin, set `CORS_ORIGINS` on the gateway:

```bash
CORS_ORIGINS=https://krythor.example.com krythor
```

Or in your config file — see [ENV_VARS.md](./ENV_VARS.md).

### Basic rate limiting (optional)

```nginx
http {
    limit_req_zone $binary_remote_addr zone=krythor:10m rate=10r/s;
}

server {
    location /api/ {
        limit_req zone=krythor burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
    }
}
```

---

## Security

### Bearer token authentication

All three remote methods still rely on Krythor's built-in Bearer token. The token is stored in `<dataDir>/config/app-config.json` under the `authToken` key.

Clients must send:
```
Authorization: Bearer <token>
```

The TUI reads the token automatically when pointing at a local gateway. For a **remote** gateway you need to supply the token explicitly:

```bash
export KRYTHOR_AUTH_TOKEN=<token>
krythor tui --host 100.64.1.5
```

Or pass it on every API call:

```bash
curl -H "Authorization: Bearer <token>" https://krythor.example.com/api/health
```

### Rotating the token

```bash
# On the gateway machine — edit app-config.json
# Restart the gateway to pick up the new token
```

### What NOT to do

- Do NOT expose port 3000 directly to the internet without authentication — the gateway does not have IP allowlisting by default.
- Do NOT disable the Bearer token (`authToken: ""`) on a public-facing gateway.
- Do NOT use HTTP (not HTTPS) over the public internet; use the Nginx TLS proxy or Tailscale instead.

---

## Multi-gateway setup

You can run multiple Krythor instances on different ports and proxy each under a different URL path:

```nginx
location /krythor-dev/ {
    proxy_pass http://127.0.0.1:3001/;
}

location /krythor-prod/ {
    proxy_pass http://127.0.0.1:3002/;
}
```

Each instance has its own `KRYTHOR_DATA_DIR` and auth token.

---

## Troubleshooting remote connections

| Symptom | Fix |
|---------|-----|
| `ERR_CONNECTION_REFUSED` | Verify gateway is running (`curl http://127.0.0.1:3000/api/health` on the host) |
| `401 Unauthorized` | Check `KRYTHOR_AUTH_TOKEN` env var or Authorization header |
| Nginx 502 Bad Gateway | Ensure Krythor is running and bound to 127.0.0.1:3000 |
| SSH tunnel drops | Add `-o ServerAliveInterval=30` to your ssh command |
| TUI shows "not reachable" | Check `--host` and `--port` flags match the tunnel/proxy |
| CORS errors in browser | Set `CORS_ORIGINS` to include your client origin |

---

## See also

- [ENV_VARS.md](./ENV_VARS.md) — all environment variables including `CORS_ORIGINS`
- [API.md](./API.md) — full REST API reference
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — general troubleshooting guide
- [START_HERE.md](./START_HERE.md) — quick start guide
