# Tailscale Networking

Krythor Gateway supports Tailscale for secure network access without VPN setup or port forwarding.

## Modes

### Off (default)
Tailscale integration is disabled. The gateway binds to `127.0.0.1` (loopback) as normal.

### Serve (tailnet only)
```
tailscaleMode: "serve"
```
Uses `tailscale serve` to proxy the gateway over your private tailnet.
Only devices on your tailnet can reach the gateway. Traffic is routed through the Tailscale daemon
and appears at `https://<machine>.tailnet-name.ts.net`.

When Serve mode is active, the gateway also proxies WebSocket connections so the Control UI works
over the tailnet URL.

Use this when you want to access your gateway from other machines on your tailnet (e.g. phone, laptop, home server) without exposing it to the internet.

### Funnel (public HTTPS)
```
tailscaleMode: "funnel"
```
Uses `tailscale funnel` to expose the gateway publicly over HTTPS via Tailscale's infrastructure.
Anyone on the internet can reach the gateway URL. **Password auth mode is required** — see below.

Use this when you want to access your gateway from devices not on your tailnet (e.g. a shared agent endpoint, webhook receiver).

## Bind modes

`gatewayBind` controls which address the gateway process listens on.

| Value | Description |
|---|---|
| `loopback` | `127.0.0.1` — recommended. Tailscale daemon forwards traffic from tailnet. |
| `tailnet` | Bind directly to the Tailscale interface IP (advanced). |
| `auto` | Let the gateway choose based on mode. |

For both Serve and Funnel, `loopback` is the recommended and expected bind mode. The Tailscale daemon handles all external connectivity.

## Auth behavior

`gatewayAuthMode` controls how the gateway authenticates requests:

| Value | Description |
|---|---|
| `token` | Standard bearer token (default). Clients supply `Authorization: Bearer <token>`. |
| `password` | Future extension — required for Funnel mode to prevent unauthenticated access. |

### `allowTailscale`
When `allowTailscale: true`, the gateway accepts requests that carry a `Tailscale-User-Login` header
injected by the Tailscale Serve daemon. This allows tailnet-authenticated users to skip the bearer token.

**Only enable this when the gateway is exclusively reachable via Tailscale Serve** — on a direct TCP
connection, any client could set the `Tailscale-User-Login` header and bypass auth entirely.

## Why Funnel requires password auth

Funnel makes the gateway reachable from the public internet. If token auth were allowed in funnel mode,
a misconfigured or weak token would expose the gateway and all connected agents to anyone.

Password auth provides an extra layer of enforcement and a clear UI signal that the gateway is public.
The config validator (`TailscaleService.validateConfig`) hard-rejects funnel + token auth before startup.

## `resetOnExit`

When `tailscaleResetOnExit: true`, the gateway runs `tailscale serve reset` on process exit.
This cleans up the Tailscale Serve configuration so the gateway URL stops responding when Krythor stops.

Useful for development workflows where you start and stop the gateway frequently.

## When to use which mode

| Scenario | Mode |
|---|---|
| Local-only access | `off` |
| Access from your own devices via tailnet | `serve` |
| Public webhook receiver or shared agent | `funnel` + password auth |
| CI/CD or container deployment | `off` or `serve` |

## Security requirements for `allowTailscale`

- Must only be enabled when gateway bind is `loopback` and mode is `serve`
- The `Tailscale-User-Login` header is only injected by the local tailscaled daemon on Serve connections
- Direct HTTP connections to `127.0.0.1:47200` bypass Tailscale and can send arbitrary headers
- Do not enable `allowTailscale` if the gateway port is reachable from any non-Tailscale path

## Configuration reference

All fields are in `app-config.json` (or editable via Settings > Tailscale Networking in the Control UI):

```json
{
  "tailscaleMode": "serve",
  "tailscaleResetOnExit": true,
  "gatewayBind": "loopback",
  "gatewayAuthMode": "token",
  "allowTailscale": true
}
```

## Startup behaviour

If `tailscaleMode` is not `off`, the gateway validates the config at startup:

1. Checks that `tailscale` CLI is installed
2. Checks that tailscale is logged in (`tailscale status --json`)
3. Validates config combination (funnel requires password auth)
4. Applies `tailscale serve` or `tailscale funnel` commands
5. Logs success and continues startup

If any check fails, the gateway **refuses to start** (`process.exit(1)`). This prevents a silently
broken networking setup where the gateway starts but Tailscale connectivity does not work.
