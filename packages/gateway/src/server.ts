import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';
import { join } from 'path';
import { existsSync, readFileSync, readdirSync, watch as fsWatch } from 'fs';
import { homedir, networkInterfaces } from 'os';
import { KrythorCore, AgentOrchestrator, ExecTool, CustomToolStore, WebhookTool, PluginLoader, AgentWorkspaceManager, getDefaultWorkspaceDir, AgentAuthProfileStore, AgentMessageBus } from '@krythor/core';
import { MemoryEngine, GuardDecisionStore, OllamaEmbeddingProvider, AuditStore } from '@krythor/memory';
import { ModelEngine, ModelRecommender, PreferenceStore } from '@krythor/models';
import { GuardEngine } from '@krythor/guard';
import { SkillRegistry, SkillRunner } from '@krythor/skills';
import type { SkillEvent } from '@krythor/skills';
import { registerCommandRoute } from './routes/command.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerModelRoutes } from './routes/models.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerGuardRoutes } from './routes/guard.js';
import { registerConfigRoute, type HeartbeatRef } from './routes/config.js';
import { registerConfigPortabilityRoutes } from './routes/config.portability.js';
import { registerConversationRoutes } from './routes/conversations.js';
import { registerSkillRoutes } from './routes/skills.js';
import { registerRecommendRoutes } from './routes/recommend.js';
import { registerToolRoutes } from './routes/tools.js';
import { registerCustomToolRoutes } from './routes/tools.custom.js';
import { registerFileToolRoutes } from './routes/tools.file.js';
import { registerShellToolRoutes } from './routes/tools.shell.js';
import { AccessProfileStore } from './AccessProfileStore.js';
import { ShellToolDispatcher } from './ShellToolDispatcher.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerOAuthRoutes } from './routes/oauth.js';
import { registerLocalModelsRoute } from './routes/local-models.js';
import { registerStreamWs, getActiveWsConnections } from './ws/stream.js';
import { DevicePairingStore } from './ws/DevicePairingStore.js';
import { registerDashboardRoute } from './routes/dashboard.js';
import { registerGatewayRoutes, loadOrCreateGatewayId } from './routes/gateway.js';
import { registerChannelRoutes } from './routes/channels.js';
import { registerChatChannelRoutes } from './routes/chatChannels.js';
import { ChannelManager } from './ChannelManager.js';
import { ChatChannelRegistry } from './ChatChannelRegistry.js';
import { DiscordInbound } from './DiscordInbound.js';
import { DmPairingStore } from './DmPairingStore.js';
import { InboundChannelManager } from './InboundChannelManager.js';
import { PeerRegistry } from './PeerRegistry.js';
import { registerOpenAICompatRoutes } from './routes/openai.compat.js';
import { registerPluginRoutes } from './routes/plugins.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerHookRoutes } from './routes/hooks.js';
import { CronStore } from './CronStore.js';
import { CronScheduler } from './CronScheduler.js';
import { registerCronRoutes } from './routes/cron.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerNodeRoutes } from './routes/nodes.js';
import { nodeRegistry } from './ws/NodeRegistry.js';
import { registerAgentAuthRoutes } from './routes/agentAuth.js';
import { WebChatPairingStore } from './WebChatPairingStore.js';
import { registerWebChatPairingRoutes } from './routes/webchatPairing.js';
import { registerTtsRoute } from './routes/tts.js';
import { registerCanvasRoute } from './routes/canvas.js';
import { registerUpdateRoute } from './routes/update.js';
import { registerImageGenRoute, getActiveImageProvider } from './routes/imageGen.js';
import { registerMediaRoute } from './routes/media.js';
import { ApprovalManager } from './ApprovalManager.js';
import { AuditLogger } from './AuditLogger.js';
import { HeartbeatEngine, type HeartbeatRunRecord, type HeartbeatInsight } from './heartbeat/HeartbeatEngine.js';
import { logger } from './logger.js';
import { loadOrCreateToken, verifyToken } from './auth.js';
import { registerErrorHandler } from './errors.js';
import { redactErrorMessage } from './redact.js';
import { checkReadiness } from './readiness.js';
import { validateProvidersConfig } from './ConfigValidator.js';
import { SessionRouter } from './SessionRouter.js';
import type { SessionConfig } from './SessionRouter.js';
import { PrivacyRouter } from '@krythor/models';

// ── .env file loading ─────────────────────────────────────────────────────────
// Load ~/.krythor/.env into process.env before anything else reads env vars.
// Variables already set in the environment take precedence (env wins over .env).
// Format: KEY=VALUE, # comments, blank lines ignored.
(function loadDotEnv() {
  try {
    const envPath = join(homedir(), '.krythor', '.env');
    if (existsSync(envPath)) {
      const lines = readFileSync(envPath, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key && !(key in process.env)) {
          process.env[key] = val;
        }
      }
    }
  } catch { /* .env load is best-effort */ }
})();

export const GATEWAY_PORT = process.env['KRYTHOR_PORT'] ? parseInt(process.env['KRYTHOR_PORT'], 10) : 47200;
export const GATEWAY_HOST = process.env['KRYTHOR_HOST'] ?? '127.0.0.1';

/**
 * Parse KRYTHOR_TRUSTED_PROXY env var into a set of trusted IP addresses.
 * Format: comma-separated list of IPv4/IPv6 addresses.
 * Example: KRYTHOR_TRUSTED_PROXY=127.0.0.1,::1,192.168.1.1
 *
 * When a request arrives from a trusted proxy IP, the gateway accepts
 * X-Forwarded-User or X-Remote-User as a bearer-equivalent auth signal
 * instead of requiring a token. This enables reverse-proxy auth setups
 * (Caddy, nginx, Traefik) where the proxy handles authentication.
 *
 * Security: only enable this when Krythor is behind a trusted reverse proxy
 * on a secured network. Never expose this on a public interface without TLS.
 */
function parseTrustedProxies(): Set<string> {
  const raw = process.env['KRYTHOR_TRUSTED_PROXY'] ?? '';
  if (!raw.trim()) return new Set();
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}

export const TRUSTED_PROXIES: Set<string> = parseTrustedProxies();

// Read version from package.json at module load time — single source of truth.
function readPackageVersion(): string {
  try {
    // From dist/index.js: ../../.. = install root (~/.krythor) or repo root
    const pkgPath = join(__dirname, '..', '..', '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

export const KRYTHOR_VERSION = readPackageVersion();

function getDataDir(): string {
  // KRYTHOR_DATA_DIR allows users to relocate Krythor's data directory.
  // Useful for backups, multi-user setups, and testing.
  // Must match the same env var in SystemProbe.ts and start.js.
  if (process.env['KRYTHOR_DATA_DIR']) {
    return process.env['KRYTHOR_DATA_DIR'];
  }
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Krythor');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Krythor');
  }
  return join(homedir(), '.local', 'share', 'krythor');
}

export { verifyToken } from './auth.js';

/** Print a warning if the machine has any non-loopback network interfaces,
 *  since a misconfigured firewall could expose the gateway port to the LAN. */
export function warnIfNetworkExposed(host: string): void {
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    logger.warn('SECURITY WARNING: Krythor is not binding to loopback only', { host, port: GATEWAY_PORT });
    if (TRUSTED_PROXIES.size > 0) {
      logger.info('Trusted proxy auth active', { trustedProxies: [...TRUSTED_PROXIES], note: 'ensure this host is behind a reverse proxy with TLS' });
    }
    return;
  }
  // Even on loopback, warn if the port is likely forwarded by firewall rules
  const nets = networkInterfaces();
  const publicIps: string[] = [];
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces ?? []) {
      if (!iface.internal && iface.family === 'IPv4') publicIps.push(iface.address);
    }
  }
  if (publicIps.length > 0) {
    logger.info('Gateway bound to loopback only — not reachable from network', { host, port: GATEWAY_PORT });
  }
}

export async function buildServer(): Promise<ReturnType<typeof Fastify>> {
  const dataDir = getDataDir();
  // Log the resolved data directory immediately — helps users find their config.
  logger.info('Krythor Gateway initializing', {
    dataDir,
    configDir: join(dataDir, 'config'),
    dataDirOverridden: !!process.env['KRYTHOR_DATA_DIR'],
  });

  // Load or generate the auth token before the server starts.
  const authCfg = loadOrCreateToken(join(dataDir, 'config'));
  if (!authCfg.authDisabled) {
    if ((authCfg as unknown as Record<string, unknown>)['firstRun']) {
      logger.info('Auth token generated (first run) — stored in app-config.json');
    } else if (process.env['KRYTHOR_GATEWAY_TOKEN']) {
      logger.info('Auth token loaded from KRYTHOR_GATEWAY_TOKEN env var');
    }
  } else {
    logger.warn('Auth is DISABLED — all API routes are unprotected');
  }

  // Use pino-pretty only in dev AND when it is resolvable as a real module.
  // In a bundled dist pino-pretty cannot be loaded as a worker thread even if
  // bundled inline — it must exist on disk. Disable it silently if absent.
  // Also disable when running from a dist/ folder (bundled mode) since the
  // thread-stream worker.js path resolution breaks for bundled pino transport.
  const isDev = process.env['NODE_ENV'] !== 'production';
  const isBundle = __dirname.endsWith('dist') || __dirname.includes('/dist/') || __dirname.includes('\\dist\\');
  let usePretty = false;
  if (isDev && !isBundle) {
    try { require.resolve('pino-pretty'); usePretty = true; } catch { /* not available */ }
  }
  const app = Fastify({
    bodyLimit: 1_048_576, // 1 MB — prevents OOM from oversized request bodies
    logger: usePretty
      ? {
          level: 'info',
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss',
              ignore: 'pid,hostname',
            },
          },
        }
      : { level: 'info' },
  });

  // Global error handler — formats all unhandled throws as { code, message, hint?, requestId? }
  registerErrorHandler(app);

  // CORS — restrict to loopback origins only by default. Rejects cross-origin requests from
  // arbitrary websites, preventing DNS rebinding and CSRF-style attacks.
  // Set CORS_ORIGINS env var to allow additional origins (comma-separated).
  // Example: CORS_ORIGINS=http://my-tool.local:3000,http://192.168.1.10:47200
  const defaultOrigins = [
    `http://127.0.0.1:${GATEWAY_PORT}`,
    `http://localhost:${GATEWAY_PORT}`,
  ];
  // When bound to a non-loopback host, also allow that origin
  if (GATEWAY_HOST !== '127.0.0.1' && GATEWAY_HOST !== 'localhost' && GATEWAY_HOST !== '::1') {
    defaultOrigins.push(`http://${GATEWAY_HOST}:${GATEWAY_PORT}`);
  }
  const extraOrigins = process.env['CORS_ORIGINS']
    ? process.env['CORS_ORIGINS'].split(',').map(o => o.trim()).filter(Boolean)
    : [];
  const corsOrigins = [...defaultOrigins, ...extraOrigins];
  if (extraOrigins.length > 0) {
    logger.info('CORS: additional origins allowed via CORS_ORIGINS env var', { extraOrigins });
  }
  await app.register(fastifyCors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: false,
  });

  // Content-Security-Policy — injected on every response to restrict what the
  // served UI can load and connect to. 'unsafe-inline' is required for the token
  // injection script block added to index.html at serve time.
  app.addHook('onSend', async (_req, reply) => {
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        `connect-src 'self' ws://127.0.0.1:${GATEWAY_PORT} ws://localhost:${GATEWAY_PORT}` +
          (GATEWAY_HOST !== '127.0.0.1' && GATEWAY_HOST !== 'localhost' ? ` ws://${GATEWAY_HOST}:${GATEWAY_PORT}` : ''),
        "frame-ancestors 'none'",
      ].join('; '),
    );
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
  });

  // Host header validation — secondary defence against DNS rebinding.
  // Applied only to /api/* and /ws/* so that static assets load normally.
  // When KRYTHOR_HOST is set to a non-loopback address, that host:port pair is
  // also allowed so reverse-proxy setups work correctly.
  const allowedHosts = new Set([
    `127.0.0.1:${GATEWAY_PORT}`,
    `localhost:${GATEWAY_PORT}`,
  ]);
  if (GATEWAY_HOST !== '127.0.0.1' && GATEWAY_HOST !== 'localhost' && GATEWAY_HOST !== '::1') {
    allowedHosts.add(`${GATEWAY_HOST}:${GATEWAY_PORT}`);
  }
  app.addHook('preHandler', async (req, reply) => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/') && !url.startsWith('/ws/') && !url.startsWith('/v1/')) return;
    const host = req.headers['host'] ?? '';
    if (!allowedHosts.has(host)) {
      reply.code(400).send({ error: 'Invalid Host header — requests must come from a known host' });
    }
  });

  // Rate limiting — applied globally; generous limits for local single-user use.
  // Command/inference routes get a tighter limit to prevent runaway loops.
  await app.register(fastifyRateLimit, {
    global: true,
    max: 300,          // 300 req / minute across all routes
    timeWindow: 60_000,
    errorResponseBuilder: () => ({ error: 'Too many requests — slow down' }),
  });

  // Auth preHandler — protects /api/* and /ws/* routes.
  // /health is public (UI polls it before token is loaded).
  //
  // Three auth paths (in priority order):
  //   1. authDisabled — all routes open (dev/trusted-network mode)
  //   2. Trusted proxy — request from a KRYTHOR_TRUSTED_PROXY IP with a non-empty
  //      X-Forwarded-User or X-Remote-User header is accepted without a token.
  //      Only enable this when Krythor is behind a TLS-terminating reverse proxy.
  //   3. Bearer token — Authorization: Bearer <token> or ?token= query param.
  if (!authCfg.authDisabled) {
    if (TRUSTED_PROXIES.size > 0) {
      logger.info('Trusted proxy auth active', { trustedProxies: [...TRUSTED_PROXIES] });
    }
    app.addHook('preHandler', async (req, reply) => {
      const url = req.url ?? '';
      // Public routes — no token required
      if (url === '/health'    || url.startsWith('/health?'))    return;
      if (url === '/ready'     || url.startsWith('/ready?'))     return;
      if (url === '/healthz'   || url.startsWith('/healthz?'))   return;
      if (url === '/liveness'  || url.startsWith('/liveness?'))  return;
      if (url === '/readyz'    || url.startsWith('/readyz?'))    return;
      if (!url.startsWith('/api/') && !url.startsWith('/ws/')) return;

      // Trusted proxy auth — accept X-Forwarded-User / X-Remote-User from known proxy IPs.
      // remoteAddress may be IPv4-mapped IPv6 (::ffff:127.0.0.1) — normalise it.
      if (TRUSTED_PROXIES.size > 0) {
        const remoteAddr = (req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
        if (TRUSTED_PROXIES.has(remoteAddr)) {
          const forwardedUser = req.headers['x-forwarded-user'] ?? req.headers['x-remote-user'];
          if (forwardedUser && String(forwardedUser).trim().length > 0) {
            // Trusted proxy presented a user identity — allow through.
            return;
          }
        }
      }

      const authHeader = req.headers['authorization'] ?? '';
      const bearerToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;

      // WebSocket clients pass token as ?token= query param
      const wsToken = (req.query as Record<string, string>)['token'];

      const token = bearerToken ?? wsToken;
      if (!verifyToken(token, authCfg.token)) {
        reply.code(401).send({ error: 'Unauthorized — invalid or missing token' });
      }
    });
  }

  await app.register(fastifyWebsocket);

  // Serve control UI from packages/control/dist if present.
  // On every request for index.html, inject the auth token as a global so the
  // UI can bootstrap without reading the public /health endpoint.
  //
  // Path resolution: try multiple candidates in priority order so this works
  // whether the gateway is run from the monorepo source tree or from a binary
  // install where __dirname points inside ~/.krythor/packages/gateway/dist/.
  const uiDistCandidates = [
    join(__dirname, '..', '..', 'control', 'dist'),           // monorepo: packages/gateway/dist → packages/control/dist
    join(__dirname, '..', '..', '..', 'control', 'dist'),     // binary:   .krythor/packages/gateway/dist/../../control/dist
    join(homedir(), '.krythor', 'packages', 'control', 'dist'), // absolute fallback
  ];
  const resolvedUiDist = uiDistCandidates.find(d => existsSync(join(d, 'index.html')));
  if (!resolvedUiDist) {
    logger.warn('Control UI dist not found — UI will not be served. Run `pnpm build` in packages/control.');
  }
  const uiDist = resolvedUiDist ?? uiDistCandidates[0];
  if (resolvedUiDist) {
    await app.register(fastifyStatic, { root: uiDist, prefix: '/', index: false });

    const serveIndex = (_req: unknown, reply: { type: (t: string) => void; send: (b: unknown) => void; code: (n: number) => { send: (b: unknown) => void } }) => {
      const indexPath = join(uiDist, 'index.html');
      if (!existsSync(indexPath)) {
        (reply as unknown as { code: (n: number) => { send: (b: unknown) => void } }).code(404).send('index.html not found');
        return;
      }
      const html = readFileSync(indexPath, 'utf-8');
      const tokenScript = authCfg.authDisabled
        ? '<script>window.__KRYTHOR_TOKEN__=null;</script>'
        : `<script>window.__KRYTHOR_TOKEN__=${JSON.stringify(authCfg.token)};</script>`;
      const injected = html.replace('</head>', `${tokenScript}</head>`);
      type ChainableReply = { type: (t: string) => ChainableReply; send: (b: unknown) => void };
      (reply as unknown as ChainableReply).type('text/html').send(injected);
    };

    // Explicit root route
    app.get('/', (req, reply) => serveIndex(req, reply as unknown as Parameters<typeof serveIndex>[1]));

    // GET /chat — minimal standalone web chat page.
    // Serves a self-contained HTML page with inline styles and SSE streaming.
    // The auth token is injected as window.__KRYTHOR_TOKEN__ so the page can
    // authenticate with /api/command without the user needing to copy the token.
    // Uses stream:true so responses appear word-by-word as they are generated.
    app.get('/chat', (_req, reply) => {
      const tokenScript = authCfg.authDisabled
        ? 'window.__KRYTHOR_TOKEN__=null;'
        : `window.__KRYTHOR_TOKEN__=${JSON.stringify(authCfg.token)};`;
      const chatHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Krythor Chat</title>
<script>${tokenScript}</script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#18181b;color:#e4e4e7;height:100vh;display:flex;flex-direction:column}
#header{padding:10px 14px;border-bottom:1px solid #27272a;font-size:13px;font-weight:600;color:#a1a1aa;letter-spacing:.05em;display:flex;align-items:center;justify-content:space-between}
#header-title{letter-spacing:.05em}
#status-dot{width:6px;height:6px;border-radius:50%;background:#52525b}
#status-dot.streaming{background:#22c55e;animation:pulse 1s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
#msgs{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.wrap{display:flex;flex-direction:column;max-width:85%}
.wrap.user{align-self:flex-end}
.wrap.assistant{align-self:flex-start}
.msg{padding:8px 12px;border-radius:10px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.msg.user{background:#2563eb;color:#fff}
.msg.assistant{background:#27272a;color:#f4f4f5}
.msg.error{background:#450a0a;color:#fca5a5}
.meta{font-size:10px;color:#52525b;margin-top:2px}
.meta.user{text-align:right}
#input-row{border-top:1px solid #27272a;padding:10px 12px;display:flex;gap:8px}
#input{flex:1;background:#27272a;border:1px solid #3f3f46;border-radius:8px;padding:7px 10px;font-size:13px;color:#f4f4f5;outline:none;resize:none;height:38px;overflow:hidden}
#send{background:#2563eb;color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;white-space:nowrap}
#send:disabled{background:#3f3f46;cursor:not-allowed}
#placeholder{color:#52525b;font-size:13px;text-align:center;margin-top:24px}
</style>
</head>
<body>
<div id="header">
  <span id="header-title">KRYTHOR CHAT</span>
  <span id="status-dot" title="Idle"></span>
</div>
<div id="msgs"><p id="placeholder">Send a message to get started.</p></div>
<div id="input-row">
<textarea id="input" placeholder="Type a message…" autocomplete="off" rows="1"></textarea>
<button id="send">Send</button>
</div>
<script>
const msgs=document.getElementById('msgs');
const input=document.getElementById('input');
const send=document.getElementById('send');
const dot=document.getElementById('status-dot');
const placeholder=document.getElementById('placeholder');
let sending=false;
let abortCtrl=null;

// Auto-resize textarea
input.addEventListener('input',()=>{
  input.style.height='auto';
  input.style.height=Math.min(input.scrollHeight,120)+'px';
});

function removePlaceholder(){if(placeholder&&placeholder.parentNode)placeholder.remove();}

function addMsg(role,text){
  removePlaceholder();
  const wrap=document.createElement('div');
  wrap.className='wrap '+role;
  const div=document.createElement('div');
  div.className='msg '+role;
  div.textContent=text;
  wrap.appendChild(div);
  const meta=document.createElement('p');
  meta.className='meta'+(role==='user'?' user':'');
  meta.textContent=new Date().toLocaleTimeString();
  wrap.appendChild(meta);
  msgs.appendChild(wrap);
  msgs.scrollTop=msgs.scrollHeight;
  return div;
}

function setSending(v){
  sending=v;
  send.disabled=v;
  input.disabled=v;
  send.textContent=v?'Stop':'Send';
  dot.className=v?'streaming':'';
  dot.title=v?'Streaming…':'Idle';
}

async function doSend(){
  if(sending){
    // Stop button — abort in-flight stream
    if(abortCtrl)abortCtrl.abort();
    return;
  }
  const text=input.value.trim();
  if(!text)return;
  input.value='';
  input.style.height='38px';
  setSending(true);
  addMsg('user',text);

  // Create streaming assistant bubble
  removePlaceholder();
  const wrap=document.createElement('div');
  wrap.className='wrap assistant';
  const bubble=document.createElement('div');
  bubble.className='msg assistant';
  bubble.textContent='';
  wrap.appendChild(bubble);
  const meta=document.createElement('p');
  meta.className='meta';
  wrap.appendChild(meta);
  msgs.appendChild(wrap);
  msgs.scrollTop=msgs.scrollHeight;

  abortCtrl=new AbortController();
  try{
    const token=window.__KRYTHOR_TOKEN__;
    const headers={'Content-Type':'application/json'};
    if(token)headers['Authorization']='Bearer '+token;
    const r=await fetch('/api/command',{
      method:'POST',
      headers,
      body:JSON.stringify({input:text,stream:true}),
      signal:abortCtrl.signal
    });
    if(!r.ok||!r.body){
      const err=await r.json().catch(()=>({output:'HTTP '+r.status}));
      bubble.className='msg error';
      bubble.textContent=err.output||err.error||'HTTP '+r.status;
      meta.textContent=new Date().toLocaleTimeString();
      setSending(false);
      return;
    }
    const reader=r.body.getReader();
    const dec=new TextDecoder();
    let buf='';
    let finalOutput='';
    while(true){
      const{done,value}=await reader.read();
      if(done)break;
      buf+=dec.decode(value,{stream:true});
      const lines=buf.split('\\n');
      buf=lines.pop()||'';
      for(const line of lines){
        if(!line.startsWith('data:'))continue;
        try{
          const d=JSON.parse(line.slice(5).trim());
          if(d.type==='done'){finalOutput=d.output||finalOutput;break;}
          if(d.type==='chunk'||d.output){
            const chunk=d.chunk||d.output||'';
            bubble.textContent+=chunk;
            finalOutput+=chunk;
            msgs.scrollTop=msgs.scrollHeight;
          }
          if(d.type==='error'){
            bubble.className='msg error';
            bubble.textContent=d.message||'Error';
          }
        }catch{}
      }
    }
    if(!bubble.textContent&&finalOutput)bubble.textContent=finalOutput;
    meta.textContent=new Date().toLocaleTimeString();
  }catch(e){
    if(e.name==='AbortError'){
      meta.textContent='stopped · '+new Date().toLocaleTimeString();
    }else{
      bubble.className='msg error';
      bubble.textContent=e.message||'Request failed';
      meta.textContent=new Date().toLocaleTimeString();
    }
  }
  abortCtrl=null;
  setSending(false);
  msgs.scrollTop=msgs.scrollHeight;
}

send.onclick=doSend;
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();doSend();}});
</script>
</body>
</html>`;
      (reply as unknown as { type: (t: string) => { send: (b: unknown) => void } }).type('text/html').send(chatHtml);
    });

    // SPA fallback — serves index.html with token injected for all non-asset routes
    app.setNotFoundHandler((req, reply) => {
      // Only inject for HTML navigations — pass through if it looks like an asset request
      if (req.url.includes('.') && !req.url.endsWith('.html')) {
        (reply as unknown as { code: (n: number) => { send: (b: unknown) => void } }).code(404).send('Not found');
        return;
      }
      serveIndex(req, reply as unknown as Parameters<typeof serveIndex>[1]);
    });
  }

  // Validate providers.json at startup — log clear errors for invalid/skipped entries.
  // This runs before ModelEngine so errors appear early in the log output.
  const configValidation = validateProvidersConfig(join(dataDir, 'config'));
  if (configValidation.fileNotFound) {
    logger.info('ConfigValidator: providers.json not found — will be created on first setup');
  } else if (configValidation.malformedJson) {
    logger.warn('ConfigValidator: providers.json has JSON syntax errors — no providers loaded');
  } else if (configValidation.skippedCount > 0) {
    logger.warn(
      `ConfigValidator: ${configValidation.skippedCount} provider(s) skipped — ` +
      'fix or remove invalid entries in providers.json, then restart or POST /api/config/reload',
    );
  }

  // Initialise subsystems — MemoryEngine opens a single shared SQLite connection;
  // both MemoryStore and ConversationStore are accessed through it.
  const memory = new MemoryEngine(
    join(dataDir, 'memory'),
    (level, msg, data) => logger[level](msg, data),
  );
  const convStore = memory.convStore;
  const models = new ModelEngine(
    join(dataDir, 'config'),
    (msg, data) => logger.warn(msg, data),
    (msg, data) => logger.info(msg, data),
  );

  // PrivacyRouter — reads privacyRoutingEnabled from app-config.json.
  // When enabled, classifies prompt sensitivity before forwarding to ModelEngine
  // and re-routes private/restricted content to a local provider.
  let privacyRouter: PrivacyRouter | undefined;
  {
    const appCfgPath = join(dataDir, 'config', 'app-config.json');
    let privacyEnabled = false;
    let blockOnSensitive = false;
    try {
      if (existsSync(appCfgPath)) {
        const raw = JSON.parse(readFileSync(appCfgPath, 'utf-8')) as Record<string, unknown>;
        privacyEnabled    = raw['privacyRoutingEnabled']  === true;
        blockOnSensitive  = raw['privacyBlockOnSensitive'] === true;
      }
    } catch { /* best-effort */ }
    if (privacyEnabled) {
      privacyRouter = new PrivacyRouter(models, blockOnSensitive);
      logger.info('PrivacyRouter enabled', { blockOnSensitive });
    }
  }

  // Initialise guard (loads/creates policy.json on first run)
  const guard = new GuardEngine(join(dataDir, 'config'), dataDir);

  // Approval manager — handles require-approval guard decisions
  const approvalManager = new ApprovalManager();

  // Structured audit logger — separate from guard-audit.ndjson, higher-level events
  const auditLogger = new AuditLogger(join(dataDir, 'logs'));

  // Guard decision audit store — shares the same SQLite connection as memory
  const guardDecisionStore = new GuardDecisionStore(memory.db);

  // Initialise skills registry and runner.
  // The event emitter is wired after `broadcast` is defined — forward skill
  // lifecycle events to all connected WebSocket clients.
  const skillRegistry = new SkillRegistry(join(dataDir, 'config'));

  // Wire Ollama embedding provider if any Ollama provider is configured and enabled.
  // Uses the first enabled Ollama provider's endpoint with the nomic-embed-text model,
  // which is the standard lightweight embedding model for Ollama.
  const ollamaProviders = models.listProviders().filter(p => p.type === 'ollama' && p.isEnabled);
  if (ollamaProviders.length > 0) {
    const ollamaEndpoint = ollamaProviders[0]!.endpoint ?? 'http://127.0.0.1:11434';
    const embeddingProvider = new OllamaEmbeddingProvider(ollamaEndpoint, 'nomic-embed-text');
    memory.registerEmbeddingProvider(embeddingProvider);
    memory.setActiveEmbeddingProvider(embeddingProvider.name);
    logger.info('Ollama embedding provider wired', { endpoint: ollamaEndpoint, model: 'nomic-embed-text' });
    logger.info('Embedding provider registered', { provider: embeddingProvider.name });
  }

  // Log provider load status at startup — surface actionable warnings when no providers
  // are configured or when entries were skipped due to validation errors.
  const providerStats = models.stats();
  if (providerStats.providerCount === 0) {
    logger.warn(
      'No AI providers configured — inference will fail until a provider is added. ' +
      'Run: krythor setup  OR  open the Models tab in the Control UI.',
    );
  } else {
    logger.info('Providers loaded', {
      providerCount: providerStats.providerCount,
      modelCount:    providerStats.modelCount,
      hasDefault:    providerStats.hasDefault,
    });
  }

  // Log embedding status so startup logs always record whether semantic search is active
  const embStatus = memory.embeddingStatus();
  if (embStatus.degraded) {
    logger.warn('Embedding degraded — semantic memory search will return keyword-only results', {
      activeProvider: embStatus.providerName,
    });
  } else {
    logger.info('Embedding ready', { provider: embStatus.providerName });
  }

  // ── Hot config reload ───────────────────────────────────────────────────────
  // Watch config files for changes and reload without restarting the process.
  // Uses fs.watch() (built-in, no extra deps). Debounced to 500ms to avoid
  // spurious double-fires from editors that write atomically (write + rename).
  // Behavior is controlled by configReloadMode in app-config.json:
  //   'hot'     — watch providers.json only (default)
  //   'hybrid'  — watch providers.json, agents.json, and guard.json
  //   'restart' — do not watch; log that restart is required
  //   'off'     — disable all config file watching
  if (process.env['NODE_ENV'] !== 'test') {
    const startupAppConfigPath = join(dataDir, 'config', 'app-config.json');
    let startupConfig: Record<string, unknown> = {};
    try {
      if (existsSync(startupAppConfigPath)) {
        startupConfig = JSON.parse(readFileSync(startupAppConfigPath, 'utf-8')) as Record<string, unknown>;
      }
    } catch { /* ignore — defaults apply */ }
    const reloadMode = (typeof startupConfig['configReloadMode'] === 'string'
      ? startupConfig['configReloadMode']
      : 'hot') as 'hot' | 'hybrid' | 'restart' | 'off';

    if (reloadMode === 'off') {
      logger.info('Config watcher disabled (configReloadMode=off) — restart required for config changes');
    } else if (reloadMode === 'restart') {
      logger.info('Config watcher disabled (configReloadMode=restart) — restart required for config changes');
    } else {
      // 'hot' watches providers.json only; 'hybrid' also watches agents.json and guard.json
      const watchedFiles = reloadMode === 'hybrid'
        ? new Set(['providers.json', 'agents.json', 'guard.json'])
        : new Set(['providers.json']);
      const providersFile = join(dataDir, 'config', 'providers.json');
      let reloadDebounce: ReturnType<typeof setTimeout> | undefined;
      try {
        fsWatch(join(dataDir, 'config'), (eventType, filename) => {
          if (!filename || !watchedFiles.has(filename)) return;
          if (reloadDebounce) clearTimeout(reloadDebounce);
          reloadDebounce = setTimeout(() => {
            try {
              models.reloadProviders();
              const s = models.stats();
              logger.info(`Hot reload: ${filename} changed — providers reloaded`, {
                providerCount: s.providerCount,
                modelCount:    s.modelCount,
              });
              if (s.providerCount === 0) {
                logger.warn('Hot reload: no providers configured after reload — inference will fail');
              }
            } catch (err) {
              logger.warn(`Hot reload: failed to reload after ${filename} changed`, {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }, 500);
        });
        logger.info('Config watcher active', { watching: providersFile, mode: reloadMode });
      } catch {
        // fs.watch() can fail on some platforms or in restricted environments — non-fatal
        logger.info('Config watcher unavailable — manual restart required for config changes');
      }
    }
  }

  // GET /api/stats — per-provider token usage for this session (auth required)
  app.get('/api/stats', async (_req, reply) => {
    return reply.send(models.tokenTracker.snapshot());
  });

  // GET /api/stats/history — inference history ring buffer (auth required)
  // Returns last 1000 inferences with timestamp, provider, model, and token counts.
  app.get('/api/stats/history', async (_req, reply) => {
    return reply.send(models.tokenTracker.getHistory());
  });

  // POST /api/config/reload — manual trigger for hot config reload (auth required)
  app.post('/api/config/reload', async (_req, reply) => {
    try {
      models.reloadProviders();
      const s = models.stats();
      const msg = `Provider config reloaded — ${s.providerCount} provider${s.providerCount !== 1 ? 's' : ''} active`;
      logger.info(msg, { providerCount: s.providerCount, modelCount: s.modelCount });
      return reply.send({ ok: true, message: msg, providerCount: s.providerCount, modelCount: s.modelCount });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Manual config reload failed', { error: message });
      return reply.code(500).send({ ok: false, message: `Reload failed: ${message}` });
    }
  });

  // Initialise recommendation engine with persistent preference store
  const preferenceStore = new PreferenceStore(join(dataDir, 'config'));
  const recommender = new ModelRecommender(models, preferenceStore);

  // Initialise core and wire subsystems.
  // Pass the repo root as a search path so SOUL.md is found during development.
  const orchestrator = new AgentOrchestrator(
    memory,
    models,
    join(dataDir, 'config'),
    // Learning recorder — captures structured signals from every agent run
    (signal) => {
      try {
        const id = memory.learningStore.record({
          taskType:                   signal.taskType,
          agentId:                    signal.agentId,
          modelId:                    signal.modelId,
          providerId:                 signal.providerId,
          recommendedModelId:         signal.recommendedModelId,
          userAcceptedRecommendation: signal.userAcceptedRecommendation,
          outcome:                    signal.outcome,
          latencyMs:                  signal.latencyMs,
          retries:                    signal.retries,
          turnCount:                  signal.turnCount,
          wasPinnedPreference:        signal.wasPinnedPreference,
        });
        if (id) logger.learningRecordWritten(id, signal.taskType, signal.outcome);
      } catch (err) {
        logger.warn('LearningRecorder failed to write record', { error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
  // Initialise agent workspace — ensures bootstrap files exist and wires the
  // workspace dir into the orchestrator so every agent run gets Project Context.
  const workspaceDir = getDefaultWorkspaceDir();
  const workspaceManager = new AgentWorkspaceManager(workspaceDir);
  workspaceManager.ensureWorkspace();
  orchestrator.setWorkspaceDir(workspaceDir);
  logger.system('workspace_init', { dir: workspaceDir });

  // Session transcript storage — one JSONL file per run at:
  //   <dataDir>/agents/<agentId>/sessions/<runId>.jsonl
  orchestrator.setSessionsDir(dataDir);
  logger.info('Session transcript storage configured', { dir: dataDir });

  // Per-agent auth profile store — credentials for external services per agent.
  //   <dataDir>/agents/<agentId>/auth-profiles.json
  const agentAuthStore = new AgentAuthProfileStore(dataDir);

  const core = new KrythorCore([join(__dirname, '..', '..', '..', '..', 'SOUL.md')]);
  core.attachMemory(memory);
  core.attachModels(models);
  core.attachOrchestrator(orchestrator);
  logger.system('soul_load', {
    loaded: core.identity.isLoaded,
    path:   core.identity.meta.loadedFrom,
    version: core.identity.meta.version,
  });

  // Broadcast helper — sends a message to all connected WebSocket clients
  const broadcast = (msg: unknown): void => {
    app.websocketServer?.clients.forEach((client: { readyState: number; send: (data: string) => void }) => {
      if (client.readyState === 1 /* OPEN */) {
        client.send(JSON.stringify(msg));
      }
    });
  };

  // Wire broadcast into approval manager so UI clients get notified immediately
  // when a new pending approval is created (no need to wait for polling interval).
  approvalManager.setOnNewApproval((approval) => {
    broadcast({ type: 'approval:pending', payload: approval });
  });

  // Track run start times for accurate duration calculation
  const runStartTimes = new Map<string, number>();
  // Map runId → requestId for end-to-end log correlation
  const runRequestIds = new Map<string, string>();

  /** Register a requestId for a given runId so the event listener can include it in logs. */
  (app as unknown as Record<string, unknown>)['registerRunRequestId'] = (runId: string, requestId: string): void => {
    runRequestIds.set(runId, requestId);
  };

  // Forward agent and guard events to WebSocket clients; also log to disk
  // Channel events are emitted here so all outbound webhooks fire on lifecycle events.
  orchestrator.on('agent:event', (event) => {
    broadcast({ type: 'agent:event', payload: event });
    const requestId = runRequestIds.get(event.runId);
    // Disk logging for key lifecycle events
    if (event.type === 'run:started') {
      runStartTimes.set(event.runId, Date.now());
      const agentName = orchestrator.registry.getById(event.agentId)?.name ?? '';
      logger.agentRunStarted(event.runId, event.agentId, agentName, requestId);
      auditLogger.log({
        actionType: 'agent:run',
        agentId: event.agentId,
        agentName,
        requestId,
        executionOutcome: undefined, // still running
        reason: 'Agent run started',
      });
    } else if (event.type === 'run:completed') {
      const p = event.payload as { output?: string; modelUsed?: string; fallbackOccurred?: boolean } | undefined;
      const durationMs = runStartTimes.get(event.runId) ? Date.now() - runStartTimes.get(event.runId)! : 0;
      runStartTimes.delete(event.runId);
      runRequestIds.delete(event.runId);
      logger.agentRunCompleted(event.runId, event.agentId, durationMs, p?.modelUsed, requestId);
      auditLogger.log({
        actionType: 'agent:run',
        agentId: event.agentId,
        agentName: orchestrator.registry.getById(event.agentId)?.name,
        requestId,
        modelUsed: p?.modelUsed,
        fallbackOccurred: p?.fallbackOccurred,
        executionOutcome: 'success',
        durationMs,
      });
      // Fire channel event
      channelMgr.emit('agent_run_complete', { runId: event.runId, agentId: event.agentId, durationMs, modelUsed: p?.modelUsed });
    } else if (event.type === 'run:stopped') {
      runStartTimes.delete(event.runId);
      runRequestIds.delete(event.runId);
    } else if (event.type === 'run:failed') {
      runStartTimes.delete(event.runId);
      runRequestIds.delete(event.runId);
      const p = event.payload as { error?: string } | undefined;
      logger.agentRunFailed(event.runId, event.agentId, redactErrorMessage(p?.error ?? 'unknown'), requestId);
      auditLogger.log({
        actionType: 'agent:run',
        agentId: event.agentId,
        agentName: orchestrator.registry.getById(event.agentId)?.name,
        requestId,
        executionOutcome: 'error',
        reason: redactErrorMessage(p?.error ?? 'unknown'),
      });
      // Fire channel event
      channelMgr.emit('agent_run_failed', { runId: event.runId, agentId: event.agentId, error: p?.error });
    }
  });
  guard.on('guard:denied', (payload) => {
    broadcast({ type: 'guard:denied', payload });
    const p = payload as { context?: Record<string, unknown>; verdict?: { reason?: string } } | undefined;
    logger.guardDenied(p?.context ?? {}, p?.verdict?.reason ?? 'denied');
  });

  // Record every guard decision (allow and deny) for the audit log.
  // The guard:decided event fires after every check() call.
  guard.on('guard:decided', (payload: { context: Record<string, unknown>; verdict: Record<string, unknown> }) => {
    try {
      guardDecisionStore.record(
        payload.context as import('@krythor/memory').GuardContextInput,
        payload.verdict as unknown as import('@krythor/memory').GuardVerdictInput,
      );
    } catch (err) { logger.warn('GuardDecisionStore failed to record decision', { error: err instanceof Error ? err.message : String(err) }); }
    // Also log to disk for off-process audit trail
    const v = payload.verdict as { allowed: boolean; action: string; ruleId?: string; reason?: string };
    const c = payload.context as { operation: string; source?: string; sourceId?: string };
    logger.guardDecisionLogged(c.operation, v.allowed, v.action, v.ruleId);
    // Structured audit log — record non-trivial guard decisions
    if (!v.allowed || v.action === 'warn') {
      auditLogger.log({
        actionType: c.operation,
        agentId: c.sourceId,
        policyDecision: v.action as 'allow' | 'deny' | 'warn' | 'require-approval',
        executionOutcome: v.allowed ? undefined : 'blocked',
        reason: v.reason,
      });
    }
  });

  // SkillRunner — constructed here so it can close over `broadcast` for event forwarding.
  // The permission checker maps a skill's declared SkillPermission to a guard operation,
  // enforcing the same policy engine used for all other operations.
  const skillRunner = new SkillRunner(
    (request, context, signal) => models.infer(request, context, signal),
    (id) => skillRegistry.getById(id),
    (event) => broadcast({ type: 'skill:event', payload: event }),
    (skill, permission) => {
      const verdict = guard.check({
        operation: `skill:permission:${permission}` as import('@krythor/guard').OperationType,
        source: 'skill',
        sourceId: skill.id,
      });
      return verdict.allowed;
    },
  );

  // Exec tool — allows agents/users to run allowlisted local commands.
  // Guard engine is wired in so 'command:execute' operations are policy-checked.
  const execTool = new ExecTool(guard);

  // Wire ExecTool into the orchestrator so agents can use structured tool calls.
  // Must be done after both are constructed (ExecTool depends on guard,
  // orchestrator was constructed before execTool is available).
  orchestrator.setExecTool(execTool);

  // Wire the guard engine into the orchestrator so agent tool calls for
  // web_search, web_fetch, and webhook:call are checked by policy.
  orchestrator.setGuard(guard);

  // Custom tool store — persists user-defined webhook tools to custom-tools.json
  const customToolStore = new CustomToolStore(join(dataDir, 'config'));
  const webhookTool = new WebhookTool();

  // Audit store — persists access-profile audit entries to SQLite (migration 011).
  // Shares the same DB connection as the rest of the memory subsystem.
  const auditStore = new AuditStore(memory.db);

  // Access profile store — persists per-agent filesystem access levels.
  // Constructed before the custom tool dispatcher so ShellToolDispatcher can
  // reference it synchronously at dispatch time.
  const accessProfileStore = new AccessProfileStore(join(dataDir, 'config'), auditStore);

  // Shell tool dispatcher — routes shell_exec and list_processes tool calls
  // through the access profile + guard layer before executing.
  const shellDispatcher = new ShellToolDispatcher(guard, accessProfileStore);

  // Wire custom tool dispatcher into orchestrator so agents can call shell and webhook tools.
  // Dispatch order: session tools → shell tools → custom webhook tools.
  orchestrator.setCustomToolDispatcher(async (toolName: string, input: string, agentId: string) => {
    // ── Session tools (read-only, no guard check required) ─────────────────
    if (toolName === 'sessions_list') {
      try {
        const params = JSON.parse(input) as { limit?: number; agentId?: string; includeArchived?: boolean; activeMinutes?: number };
        const limit = Math.min(Math.max(1, params.limit ?? 20), 100);
        const allConvs = convStore.listConversations(params.includeArchived ?? false);
        const filtered = params.agentId
          ? allConvs.filter(c => c.agentId === params.agentId)
          : allConvs;
        const now = Date.now();
        const IDLE_MS = 30 * 60 * 1000;
        const activeThreshold = params.activeMinutes ? params.activeMinutes * 60_000 : null;
        // Build a lookup of conversationId → sessionKey
        const sessionEntries = memory.sessionStore.list();
        const convToSession = new Map(sessionEntries.map(e => [e.conversationId, e]));
        const rows = filtered
          .filter(c => activeThreshold === null || (now - c.updatedAt) <= activeThreshold)
          .slice(0, limit)
          .map(c => {
            const se = convToSession.get(c.id);
            return {
              id:          c.id,
              sessionKey:  se?.sessionKey ?? null,
              title:       c.name ?? c.title,
              agentId:     c.agentId,
              channel:     se?.channel ?? null,
              chatType:    se?.chatType ?? null,
              displayName: se?.displayName ?? null,
              updatedAt:   c.updatedAt,
              isIdle:      (now - c.updatedAt) >= IDLE_MS,
              archived:    c.archived,
              pinned:      c.pinned,
              sendPolicy:  se?.sendPolicy ?? null,
            };
          });
        return JSON.stringify(rows, null, 2);
      } catch (err) {
        return `sessions_list error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (toolName === 'sessions_history') {
      try {
        const params = JSON.parse(input) as { conversationId?: string; sessionKey?: string; limit?: number; includeTools?: boolean };
        // Accept either conversationId or sessionKey
        let conversationId = params.conversationId;
        if (!conversationId && params.sessionKey) {
          const sessionEntry = memory.sessionStore.getByKey(params.sessionKey);
          if (!sessionEntry) return `sessions_history: session "${params.sessionKey}" not found`;
          conversationId = sessionEntry.conversationId;
        }
        if (!conversationId) return 'sessions_history: conversationId or sessionKey is required';
        const conv = convStore.getConversation(conversationId);
        if (!conv) return `sessions_history: conversation "${conversationId}" not found`;
        const limit = Math.min(Math.max(1, params.limit ?? 20), 50);
        const all = convStore.getMessages(conversationId);
        const messages = all
          .filter(m => params.includeTools ? true : (m.role === 'user' || m.role === 'assistant'))
          .slice(-limit)
          .map(m => ({ role: m.role, content: m.content, createdAt: m.createdAt }));
        return JSON.stringify({ conversationId: conv.id, title: conv.name ?? conv.title, messages }, null, 2);
      } catch (err) {
        return `sessions_history error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (toolName === 'sessions_send') {
      try {
        const params = JSON.parse(input) as {
          sessionKey?: string;
          conversationId?: string;
          message: string;
          timeoutSeconds?: number;
        };
        if (!params.message) return 'sessions_send: message is required';

        // Resolve conversationId from sessionKey if needed
        let conversationId = params.conversationId;
        let targetAgentId = agentId;
        if (!conversationId && params.sessionKey) {
          const entry = memory.sessionStore.getByKey(params.sessionKey);
          if (!entry) return `sessions_send: session "${params.sessionKey}" not found`;
          conversationId = entry.conversationId;
          if (entry.agentId) targetAgentId = entry.agentId;
        }
        if (!conversationId) return 'sessions_send: sessionKey or conversationId is required';

        const conv = convStore.getConversation(conversationId);
        if (!conv) return `sessions_send: conversation "${conversationId}" not found`;
        if (conv.agentId) targetAgentId = conv.agentId;

        const timeoutMs = ((params.timeoutSeconds ?? 30) * 1000);
        const contextMsgs = convStore.getMessages(conversationId)
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .slice(-50)
          .map(m => ({ role: m.role, content: m.content }));

        if (timeoutMs <= 0) {
          // Fire-and-forget
          const runId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          void orchestrator.runAgent(targetAgentId, { input: params.message }, { contextMessages: contextMsgs, runId })
            .then(run => {
              if (run.output) {
                convStore.addMessage(conversationId!, 'user', params.message);
                convStore.addMessage(conversationId!, 'assistant', run.output, run.modelUsed);
              }
            }).catch(() => {});
          return JSON.stringify({ runId, status: 'accepted' });
        }

        // Wait up to timeoutMs
        let timedOut = false;
        const timeoutPromise = new Promise<null>(resolve => setTimeout(() => { timedOut = true; resolve(null); }, timeoutMs));
        const runPromise = orchestrator.runAgent(targetAgentId, { input: params.message }, { contextMessages: contextMsgs });
        const run = await Promise.race([runPromise, timeoutPromise]);

        if (run === null || timedOut) {
          return JSON.stringify({ status: 'timeout', error: `sessions_send timed out after ${params.timeoutSeconds}s` });
        }

        if (run.output) {
          convStore.addMessage(conversationId, 'user', params.message);
          convStore.addMessage(conversationId, 'assistant', run.output, run.modelUsed);
        }

        if (run.status === 'failed') {
          return JSON.stringify({ status: 'error', error: run.errorMessage ?? 'run failed' });
        }

        return JSON.stringify({ status: 'ok', reply: run.output ?? '' });
      } catch (err) {
        return `sessions_send error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (toolName === 'sessions_spawn') {
      try {
        const params = JSON.parse(input) as {
          task: string;
          agentId?: string;
          label?: string;
          model?: string;
          runTimeoutSeconds?: number;
        };
        if (!params.task) return 'sessions_spawn: task is required';

        const targetAgentId = params.agentId ?? agentId;
        const agent = orchestrator.listAgents().find(a => a.id === targetAgentId);
        if (!agent) return `sessions_spawn: agent "${targetAgentId}" not found`;

        const runId = `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const conv = convStore.createConversation(targetAgentId);
        const runTimeoutMs = (params.runTimeoutSeconds ?? 0) * 1000;

        // Non-blocking: start the run in the background
        void (async () => {
          try {
            let runPromise = orchestrator.runAgent(targetAgentId, {
              input: params.task,
              ...(params.model && { modelOverride: params.model }),
            }, { runId });

            if (runTimeoutMs > 0) {
              const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), runTimeoutMs));
              const result = await Promise.race([runPromise, timeout]);
              if (result === null) {
                orchestrator.stopRun(runId);
                convStore.addMessage(conv.id, 'assistant', `[Sub-agent ${runId} timed out after ${params.runTimeoutSeconds}s]`);
                return;
              }
              // result is the run
              const run = result;
              convStore.addMessage(conv.id, 'user', params.task);
              if (run.output) convStore.addMessage(conv.id, 'assistant', run.output, run.modelUsed);
            } else {
              const run = await runPromise;
              convStore.addMessage(conv.id, 'user', params.task);
              if (run.output) convStore.addMessage(conv.id, 'assistant', run.output, run.modelUsed);
            }
          } catch (err) {
            logger.warn('[sessions_spawn] Sub-agent run failed', { runId, err: err instanceof Error ? err.message : String(err) });
          }
        })();

        return JSON.stringify({
          status: 'accepted',
          runId,
          childConversationId: conv.id,
          label: params.label ?? null,
        });
      } catch (err) {
        return `sessions_spawn error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // ── Agent tools ────────────────────────────────────────────────────────────
    if (toolName === 'agents_list') {
      try {
        const agents = orchestrator.listAgents().map(a => ({
          id:          a.id,
          name:        a.name,
          description: a.description ?? '',
          modelId:     a.modelId ?? null,
          tags:        a.tags ?? [],
        }));
        return JSON.stringify(agents, null, 2);
      } catch (err) {
        return `agents_list error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // ── Image generation ────────────────────────────────────────────────────
    if (toolName === 'generate_image') {
      const imgProvider = getActiveImageProvider();
      if (!imgProvider || !imgProvider.isAvailable()) return '{"error":"No image provider configured"}';
      try {
        const p = JSON.parse(input) as { prompt: string; size?: string; model?: string };
        const result = await imgProvider.generate(p.prompt, { size: p.size, model: p.model });
        return JSON.stringify(result);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : 'Generation failed' });
      }
    }

    if (toolName === 'agent_ping') {
      try {
        const params = JSON.parse(input) as { agentId?: string; message?: string };
        if (!params.agentId) return 'agent_ping: agentId is required';
        if (!params.message) return 'agent_ping: message is required';

        // Verify the calling agent has agent_ping in its allowedTools
        const callerAgent = orchestrator.getAgent(agentId);
        if (!callerAgent?.allowedTools?.includes('agent_ping')) {
          return `agent_ping: "${agentId}" does not have "agent_ping" in allowedTools`;
        }

        const targetAgent = orchestrator.getAgent(params.agentId);
        if (!targetAgent) return `agent_ping: agent "${params.agentId}" not found`;

        const run = await orchestrator.runAgent(params.agentId, {
          input: params.message,
          contextOverride: `[agent_ping from agent ${agentId}]`,
        }, {});
        return run.output ?? '(no response)';
      } catch (err) {
        return `agent_ping error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // ── Shell tools — profile-checked and guard-checked by ShellToolDispatcher ─
    const shellResult = await shellDispatcher.dispatch(agentId, toolName, input);
    if (shellResult !== null) return shellResult;
    // Webhook / custom tools
    const tool = customToolStore.get(toolName);
    if (!tool) return null;
    return webhookTool.run(tool, input);
  });

  // Plugin loader — loads user-defined JS tools from <dataDir>/plugins/.
  // Runs at startup; plugins are registered into TOOL_REGISTRY and dispatched
  // via the custom tool dispatcher (plugin names take priority over webhook tools).
  const pluginLoader = new PluginLoader(dataDir);
  pluginLoader.load();

  // Channels (outbound webhooks) — #16
  // Created here so emit() is available to route handlers below.
  const gatewayId = loadOrCreateGatewayId(join(dataDir, 'config'));
  const channelMgr = new ChannelManager(join(dataDir, 'config'), gatewayId);
  const channelEmit = (event: string, data: Record<string, unknown>) => channelMgr.emit(event as import('./ChannelManager.js').ChannelEvent, data);

  // Device pairing store — created early so it can be passed to command route (for /devices slash command)
  // and to the WS stream handler. Storage path is <dataDir>/devices/devices.json.
  const devicePairingStore = new DevicePairingStore(join(dataDir, 'devices'));

  // Late-bound heartbeat reference — filled in after HeartbeatEngine is created below.
  const heartbeatRef: HeartbeatRef = {};

  // Agent message bus — in-process agent-to-agent messaging and delegation
  const agentMessageBus = new AgentMessageBus();

  // Register routes
  registerCommandRoute(app, core, orchestrator, broadcast, guard, convStore, devicePairingStore, approvalManager, privacyRouter);
  registerMemoryRoutes(app, memory, models, guard, channelEmit, approvalManager);
  registerModelRoutes(app, models, memory, guard, channelEmit, approvalManager);
  registerAgentRoutes(app, orchestrator, guard, accessProfileStore, approvalManager, agentMessageBus);
  registerGuardRoutes(app, guard, guardDecisionStore);
  registerConfigRoute(app, join(dataDir, 'config'), guard, orchestrator, memory, heartbeatRef, approvalManager);
  registerConversationRoutes(app, convStore, guard, channelEmit, memory ?? undefined, approvalManager);
  registerSkillRoutes(app, skillRegistry, guard, skillRunner, approvalManager);
  registerRecommendRoutes(app, models, recommender, guard);
  registerToolRoutes(app, guard, execTool, core);
  registerCustomToolRoutes(app, customToolStore, guard);
  registerFileToolRoutes(app, guard, accessProfileStore, approvalManager, orchestrator);
  registerShellToolRoutes(app, guard, accessProfileStore, approvalManager);
  registerProviderRoutes(app, models);
  registerOAuthRoutes(app, models);
  registerLocalModelsRoute(app);
  registerConfigPortabilityRoutes(app, models);
  registerPluginRoutes(app, pluginLoader);
  registerApprovalRoutes(app, approvalManager);
  registerAuditRoutes(app, auditLogger, auditStore, accessProfileStore);
  registerWorkspaceRoutes(app);

  // Inbound webhook routes — POST /api/hooks/wake + /api/hooks/agent
  // Token is read from app-config.json on every request (picks up changes without restart).
  const appConfigPath = join(dataDir, 'config', 'app-config.json');
  const getWebhookToken = (): string | undefined => {
    try {
      if (!existsSync(appConfigPath)) return undefined;
      const cfg = JSON.parse(readFileSync(appConfigPath, 'utf-8')) as Record<string, unknown>;
      return typeof cfg['webhookToken'] === 'string' ? cfg['webhookToken'] : undefined;
    } catch { return undefined; }
  };
  registerHookRoutes(app, orchestrator, getWebhookToken);

  // Cron — user-defined scheduled agent jobs
  const cronStore = new CronStore(join(dataDir, 'config'));
  const cronScheduler = new CronScheduler(cronStore, orchestrator);
  registerCronRoutes(app, cronStore, cronScheduler);
  registerAgentAuthRoutes(app, agentAuthStore);

  // Web Chat pairing — shareable one-time links for /chat
  const webChatPairingStore = new WebChatPairingStore();
  registerWebChatPairingRoutes(app, webChatPairingStore, () => authCfg.token, uiDist);

  registerTtsRoute(app);
  registerCanvasRoute(app, dataDir);
  registerUpdateRoute(app);
  registerImageGenRoute(app);
  registerMediaRoute(app);

  registerStreamWs(app, core, () => authCfg.token, guard, devicePairingStore, gatewayId, KRYTHOR_VERSION);
  registerDeviceRoutes(app, devicePairingStore, broadcast);
  registerNodeRoutes(app);

  // Templates endpoint — lists workspace template files available in the user's data dir.
  // Returns { name, filename, size, description } for each .md file in <dataDir>/templates/.
  // `description` is extracted from the first H1 heading (# Title) or the first non-empty line.
  // Authenticated — templates may contain user-edited personal context.
  app.get('/api/templates', async (_req, reply) => {
    const templatesDir = join(dataDir, 'templates');
    if (!existsSync(templatesDir)) {
      return reply.send({ templates: [] });
    }
    let files: string[];
    try { files = readdirSync(templatesDir).filter(f => f.endsWith('.md')); }
    catch { return reply.send({ templates: [] }); }

    const templates = files.map(file => {
      const filePath = join(templatesDir, file);
      let content = '';
      let size = 0;
      try {
        content = readFileSync(filePath, 'utf-8');
        size = Buffer.byteLength(content, 'utf-8');
      } catch {}

      // Extract description: first H1 heading or first non-empty line
      let description = '';
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('# ')) {
          description = trimmed.slice(2).trim(); // strip "# " prefix
        } else {
          description = trimmed;
        }
        break;
      }

      // name = filename without .md extension (display name)
      const name = file.replace(/\.md$/i, '');
      return { name, filename: file, size, description };
    });
    return reply.send({ templates });
  });

  // Health check — intentionally public (no auth required).
  // The token is returned here so the browser UI can bootstrap itself without
  // the user ever needing to copy/paste it. This is safe for a local-only tool:
  // any caller that can reach /health can already read app-config.json from disk.
  app.get('/health', async () => {
    const modelStats = models.stats();
    const agentStats = orchestrator.stats();
    return {
      status: 'ok',
      version: KRYTHOR_VERSION,
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
      memory: { ...memory.stats(), ...memory.embeddingStatus() },
      models: modelStats,
      circuits: models.circuitStats(),
      guard: guard.stats(),
      agents: agentStats,
      heartbeat: {
        enabled:    heartbeat.getConfig().enabled,
        recentRuns: heartbeat.history(3).length,
        lastRun:    heartbeat.getLastRun() ?? undefined,
        warnings:   heartbeat.getActiveWarnings(),
      },
      soul: {
        loaded:  core.identity.isLoaded,
        version: core.identity.meta.version,
      },
      firstRun: modelStats.providerCount === 0 && agentStats.agentCount === 0,
      totalTokens: models.tokenTracker.totalTokens(),
      wsConnections: getActiveWsConnections(),
      nodes: nodeRegistry.list().length,
      devices: (() => {
        const allDevices = devicePairingStore.listAll();
        return {
          total:    allDevices.length,
          approved: allDevices.filter(d => d.status === 'approved').length,
          pending:  allDevices.filter(d => d.status === 'pending').length,
        };
      })(),
      // Location fields help users find their data — safe to expose on loopback-only endpoint.
      dataDir,
      configDir: join(dataDir, 'config'),
      // Token is intentionally NOT included here — it is injected into index.html
      // at serve time so the UI can bootstrap without exposing it on a public endpoint.
    };
  });

  // Readiness check — returns 200 when db + guard are ok, 503 otherwise.
  // Public (no auth required) so load balancers and health checks can poll it.
  app.get('/ready', async (_req, reply) => {
    const result = await checkReadiness(memory, models, guard);
    reply.code(result.ready ? 200 : 503).send(result);
  });

  // Liveness probe — minimal response for Docker/k8s HEALTHCHECK and load balancers.
  // Always returns 200 as long as the process is alive and the event loop is running.
  // Aliased at both /healthz and /liveness.
  // Public (no auth required) — callers that can reach this already have network access.
  const livenessHandler = async () => ({ ok: true, ts: Date.now() });
  app.get('/healthz',  livenessHandler);
  app.get('/liveness', livenessHandler);

  // Readiness alias for k8s convention.
  app.get('/readyz', async (_req, reply) => {
    const result = await checkReadiness(memory, models, guard);
    reply.code(result.ready ? 200 : 503).send(result);
  });

  // GET /api/heartbeat/history — per-provider rolling health history (auth required).
  // Returns last up to 100 health check entries per provider.
  // Entries: { timestamp, ok, latencyMs }
  app.get('/api/heartbeat/history', async () => {
    return heartbeat.getProviderHealthHistory();
  });

  // Heartbeat status — returns last run summary + active warnings.
  // Authenticated. Polled by the UI status bar to surface non-critical warnings.
  app.get('/api/heartbeat/status', async () => {
    const last  = heartbeat.getLastRun();
    const warns = heartbeat.getActiveWarnings();
    const persisted = memory?.heartbeatInsightStore.recent(24) ?? [];
    return {
      enabled:         heartbeat.getConfig().enabled,
      lastRun:         last ?? null,
      warnings:        warns,
      warningCount:    warns.length,
      persistedWarnings: persisted,
      embeddingStatus: memory.embeddingStatus(),
    };
  });

  // Startup recovery — mark any 'running' DB rows as 'failed'.
  // These are orphans from a previous process that crashed or was killed before
  // it could update their status. Resolving them immediately prevents the UI from
  // showing "forever running" ghosts.
  const orphansResolved = memory.agentRunStore.resolveOrphanedRuns();
  if (orphansResolved > 0) {
    logger.warn('Startup recovery: orphaned runs resolved', { count: orphansResolved });
  } else {
    logger.info('Startup recovery: no orphaned runs found', { count: 0 });
  }

  // Start heartbeat maintenance loop.
  // Disabled in test environments to prevent timer leaks.
  const heartbeat = new HeartbeatEngine(memory, models, orchestrator, undefined, recommender, logger);
  if (process.env['NODE_ENV'] !== 'test') {
    heartbeat.start();
    cronScheduler.start();
    app.addHook('onClose', async () => { cronScheduler.stop(); });
  }

  // Dashboard route is registered after heartbeat is instantiated so it can
  // reference heartbeat directly (avoids a late-binding closure or re-export).
  registerDashboardRoute(app, models, memory, orchestrator, heartbeat);
  // Patch the heartbeat into the heartbeatRef so the config route can update it at runtime.
  heartbeatRef.instance = heartbeat;

  // Apply startup heartbeat config from app-config.json (deferred because HeartbeatEngine was
  // created after registerConfigRoute, so the startup block in config.ts couldn't apply it).
  try {
    if (existsSync(appConfigPath)) {
      const startupAppCfg = JSON.parse(readFileSync(appConfigPath, 'utf-8')) as Record<string, unknown>;
      const hbPatch: Record<string, unknown> = {};
      if ('heartbeatDirectPolicy' in startupAppCfg) hbPatch['directPolicy'] = startupAppCfg['heartbeatDirectPolicy'];
      if ('heartbeatThinkingDefault' in startupAppCfg) hbPatch['thinkingDefault'] = startupAppCfg['heartbeatThinkingDefault'];
      if ('heartbeatMentionPatterns' in startupAppCfg) hbPatch['mentionPatterns'] = startupAppCfg['heartbeatMentionPatterns'];
      if ('heartbeatResetTriggers' in startupAppCfg) hbPatch['resetTriggers'] = startupAppCfg['heartbeatResetTriggers'];
      if (Object.keys(hbPatch).length > 0) {
        heartbeat.patchConfig(hbPatch as Parameters<typeof heartbeat.patchConfig>[0]);
      }
    }
  } catch { /* startup heartbeat config is best-effort */ }

  // Apply per-agent rate limit from app-config.json
  try {
    if (existsSync(appConfigPath)) {
      const rateCfg = JSON.parse(readFileSync(appConfigPath, 'utf-8')) as Record<string, unknown>;
      if (typeof rateCfg['agentMaxRunsPerMinute'] === 'number') {
        orchestrator.setMaxRunsPerMinute(rateCfg['agentMaxRunsPerMinute']);
        logger.info('Per-agent rate limit configured', { agentMaxRunsPerMinute: rateCfg['agentMaxRunsPerMinute'] });
      }
    }
  } catch { /* best-effort */ }

  // Chat channel registry (inbound bot channels — Telegram, Discord, WhatsApp)
  const chatChannelRegistry = new ChatChannelRegistry(join(dataDir, 'config'));

  // Channel routes (outbound webhooks) — #16
  registerChannelRoutes(app, channelMgr);

  // Session router — reads session config from app-config.json
  const sessionConfig = ((): SessionConfig => {
    try {
      if (existsSync(appConfigPath)) {
        const cfg = JSON.parse(readFileSync(appConfigPath, 'utf-8')) as Record<string, unknown>;
        return (cfg['session'] ?? {}) as SessionConfig;
      }
    } catch { /* fallback to defaults */ }
    return {};
  })();
  const sessionRouter = new SessionRouter(memory.sessionStore, convStore, sessionConfig);

  // Inbound channel manager — manages Telegram, Discord, WhatsApp from registry
  const inboundMgr = new InboundChannelManager(chatChannelRegistry, orchestrator, dataDir, logger, convStore, sessionRouter);
  if (process.env['NODE_ENV'] !== 'test') {
    inboundMgr.startAll().catch(err => logger.error('[inbound] startAll error', { err: err instanceof Error ? err.message : String(err) }));
  }
  app.addHook('onClose', async () => { inboundMgr.stopAll(); });

  // Chat channel routes (inbound bot channels)
  registerChatChannelRoutes(app, chatChannelRegistry, inboundMgr);

  // Discord inbound channel — legacy standalone wiring kept for /api/discord routes
  // and env-var-based configuration (env vars take precedence over registry).
  // Uses its own pairing store scoped to the legacy env-var channel.
  const legacyDiscordPairingStore = new DmPairingStore(join(dataDir, 'pairing'));
  const discordInbound = new DiscordInbound(orchestrator, legacyDiscordPairingStore, convStore);

  // Bootstrap from env vars if present
  const discordToken     = process.env['KRYTHOR_DISCORD_TOKEN'];
  const discordChannelId = process.env['KRYTHOR_DISCORD_CHANNEL_ID'];
  const discordAgentId   = process.env['KRYTHOR_DISCORD_AGENT_ID'];
  if (discordToken && discordChannelId && discordAgentId && process.env['NODE_ENV'] !== 'test') {
    discordInbound.configure({ token: discordToken, channelId: discordChannelId, agentId: discordAgentId, enabled: true });
    discordInbound.start().then(r => {
      if (!r.ok) logger.warn('[discord] Failed to start inbound', { error: r.error });
    }).catch(err => logger.error('[discord] Start error', { err: err instanceof Error ? err.message : String(err) }));
  }

  // Discord configuration routes (auth-gated via global preHandler)
  app.get('/api/discord', async (_req, reply) => {
    return reply.send({ config: discordInbound.getConfig(), running: discordInbound.isRunning() });
  });

  app.put<{ Body: { token: string; channelId: string; agentId: string; enabled?: boolean } }>('/api/discord', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'channelId', 'agentId'],
        properties: {
          token:     { type: 'string', minLength: 1, maxLength: 200 },
          channelId: { type: 'string', minLength: 1, maxLength: 50 },
          agentId:   { type: 'string', minLength: 1, maxLength: 100 },
          enabled:   { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body;
    discordInbound.stop();
    discordInbound.configure({ ...body, enabled: body.enabled ?? true });
    const result = await discordInbound.start();
    return reply.send({ ok: result.ok, running: discordInbound.isRunning(), error: result.error });
  });

  app.delete('/api/discord', async (_req, reply) => {
    discordInbound.stop();
    return reply.send({ ok: true, running: false });
  });

  app.addHook('onClose', async () => { discordInbound.stop(); });

  // Peer registry (LAN discovery + manual peers) — #18
  const peerRegistry = new PeerRegistry(join(dataDir, 'config'), gatewayId, GATEWAY_PORT, KRYTHOR_VERSION);
  if (process.env['NODE_ENV'] !== 'test') {
    peerRegistry.startDiscovery();
    app.addHook('onClose', async () => peerRegistry.stopDiscovery());
  }


  // Gateway identity and capability routes (auth required via global preHandler).
  registerGatewayRoutes(app, join(dataDir, 'config'), peerRegistry);

  // OpenAI-compatible API routes — allows OpenAI SDK users to point baseURL at Krythor.
  // Auth is handled inside the route (flexible — allows no-token usage for local-only setups).
  registerOpenAICompatRoutes(
    app,
    models,
    () => authCfg.token,
    authCfg.authDisabled ?? false,
  );

  // ── Session idle cleanup job ─────────────────────────────────────────────────
  // Archives conversations idle for more than 24 hours (non-pinned only).
  // Runs every 10 minutes. Disabled in test environments to prevent timer leaks.
  const IDLE_ARCHIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
  const IDLE_CLEANUP_INTERVAL_MS  = 10 * 60 * 1000;      // 10 minutes
  let idleCleanupInterval: ReturnType<typeof setInterval> | undefined;
  if (process.env['NODE_ENV'] !== 'test') {
    idleCleanupInterval = setInterval(() => {
      try {
        const archived = convStore.archiveIdleConversations(IDLE_ARCHIVE_THRESHOLD_MS);
        if (archived > 0) {
          logger.info('Session cleanup: archived idle conversations', { count: archived });
        }
      } catch (err) {
        logger.warn('Session cleanup: archiveIdleConversations failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, IDLE_CLEANUP_INTERVAL_MS);
  }

  app.addHook('onClose', async () => {
    if (idleCleanupInterval) clearInterval(idleCleanupInterval);
    heartbeat.stop();
    // memory.close() closes the shared SQLite connection used by both stores
    memory.close();
  });

  // Expose a checkReady helper so index.ts can log readiness after listen()
  (app as unknown as Record<string, unknown>)['checkReady'] = () =>
    checkReadiness(memory, models, guard);

  return app;
}
