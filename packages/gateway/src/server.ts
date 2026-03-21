import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fastifyRateLimit from '@fastify/rate-limit';
import { join } from 'path';
import { existsSync, readFileSync, readdirSync, watch as fsWatch } from 'fs';
import { homedir, networkInterfaces } from 'os';
import { KrythorCore, AgentOrchestrator, ExecTool, CustomToolStore, WebhookTool } from '@krythor/core';
import { MemoryEngine, GuardDecisionStore, OllamaEmbeddingProvider } from '@krythor/memory';
import { ModelEngine, ModelRecommender, PreferenceStore } from '@krythor/models';
import { GuardEngine } from '@krythor/guard';
import { SkillRegistry, SkillRunner } from '@krythor/skills';
import type { SkillEvent } from '@krythor/skills';
import { registerCommandRoute } from './routes/command.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerModelRoutes } from './routes/models.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerGuardRoutes } from './routes/guard.js';
import { registerConfigRoute } from './routes/config.js';
import { registerConfigPortabilityRoutes } from './routes/config.portability.js';
import { registerConversationRoutes } from './routes/conversations.js';
import { registerSkillRoutes } from './routes/skills.js';
import { registerRecommendRoutes } from './routes/recommend.js';
import { registerToolRoutes } from './routes/tools.js';
import { registerCustomToolRoutes } from './routes/tools.custom.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerLocalModelsRoute } from './routes/local-models.js';
import { registerStreamWs } from './ws/stream.js';
import { registerDashboardRoute } from './routes/dashboard.js';
import { HeartbeatEngine, type HeartbeatRunRecord, type HeartbeatInsight } from './heartbeat/HeartbeatEngine.js';
import { logger } from './logger.js';
import { loadOrCreateToken, verifyToken } from './auth.js';
import { registerErrorHandler } from './errors.js';
import { redactErrorMessage } from './redact.js';
import { checkReadiness } from './readiness.js';
import { validateProvidersConfig } from './ConfigValidator.js';

export const GATEWAY_PORT = 47200;
export const GATEWAY_HOST = '127.0.0.1';

// Read version from package.json at module load time — single source of truth.
function readPackageVersion(): string {
  try {
    const pkgPath = new URL('../../package.json', import.meta.url).pathname;
    const raw = readFileSync(pkgPath.startsWith('/') ? pkgPath : '/' + pkgPath, 'utf-8');
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
 *  since a misconfigured firewall could expose port 47200 to the LAN. */
export function warnIfNetworkExposed(host: string): void {
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    logger.warn('SECURITY WARNING: Krythor is not binding to loopback only', { host, port: GATEWAY_PORT });
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
    }
  } else {
    logger.warn('Auth is DISABLED — all API routes are unprotected');
  }

  // Use pino-pretty only in dev AND when it is resolvable as a real module.
  // In a bundled dist pino-pretty cannot be loaded as a worker thread even if
  // bundled inline — it must exist on disk. Disable it silently if absent.
  const isDev = process.env['NODE_ENV'] !== 'production';
  let usePretty = false;
  if (isDev) {
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
        `connect-src 'self' ws://127.0.0.1:${GATEWAY_PORT} ws://localhost:${GATEWAY_PORT}`,
        "frame-ancestors 'none'",
      ].join('; '),
    );
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
  });

  // Host header validation — secondary defence against DNS rebinding.
  // Applied only to /api/* and /ws/* so that static assets load normally.
  app.addHook('preHandler', async (req, reply) => {
    const url = req.url ?? '';
    if (!url.startsWith('/api/') && !url.startsWith('/ws/')) return;
    const host = req.headers['host'] ?? '';
    const allowed = [`127.0.0.1:${GATEWAY_PORT}`, `localhost:${GATEWAY_PORT}`];
    if (!allowed.includes(host)) {
      reply.code(400).send({ error: 'Invalid Host header — requests must come from localhost' });
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
  if (!authCfg.authDisabled) {
    app.addHook('preHandler', async (req, reply) => {
      const url = req.url ?? '';
      // Public routes — no token required
      if (url === '/health' || url.startsWith('/health?')) return;
      if (url === '/ready' || url.startsWith('/ready?')) return;
      if (!url.startsWith('/api/') && !url.startsWith('/ws/')) return;

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
  const uiDist = join(__dirname, '..', '..', 'control', 'dist');
  if (existsSync(uiDist)) {
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
      (reply as unknown as { type: (t: string) => void; send: (b: unknown) => void }).type('text/html').send(injected);
    };

    // Explicit root route
    app.get('/', (req, reply) => serveIndex(req, reply as unknown as Parameters<typeof serveIndex>[1]));

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

  // Initialise guard (loads/creates policy.json on first run)
  const guard = new GuardEngine(join(dataDir, 'config'));

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
  // Watch providers.json for changes and reload without restarting the process.
  // Uses fs.watch() (built-in, no extra deps). Debounced to 500ms to avoid
  // spurious double-fires from editors that write atomically (write + rename).
  if (process.env['NODE_ENV'] !== 'test') {
    const providersFile = join(dataDir, 'config', 'providers.json');
    let reloadDebounce: ReturnType<typeof setTimeout> | undefined;
    try {
      fsWatch(join(dataDir, 'config'), (eventType, filename) => {
        if (filename !== 'providers.json') return;
        if (reloadDebounce) clearTimeout(reloadDebounce);
        reloadDebounce = setTimeout(() => {
          try {
            models.reloadProviders();
            const s = models.stats();
            logger.info('Hot reload: providers.json changed — providers reloaded', {
              providerCount: s.providerCount,
              modelCount:    s.modelCount,
            });
            if (s.providerCount === 0) {
              logger.warn('Hot reload: no providers configured after reload — inference will fail');
            }
          } catch (err) {
            logger.warn('Hot reload: failed to reload providers.json', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }, 500);
      });
      logger.info('Config watcher active', { watching: providersFile });
    } catch {
      // fs.watch() can fail on some platforms or in restricted environments — non-fatal
      logger.info('Config watcher unavailable — manual restart required for config changes');
    }
  }

  // GET /api/stats — per-provider token usage for this session (auth required)
  app.get('/api/stats', async (_req, reply) => {
    return reply.send(models.tokenTracker.snapshot());
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

  // Track run start times for accurate duration calculation
  const runStartTimes = new Map<string, number>();
  // Map runId → requestId for end-to-end log correlation
  const runRequestIds = new Map<string, string>();

  /** Register a requestId for a given runId so the event listener can include it in logs. */
  (app as unknown as Record<string, unknown>)['registerRunRequestId'] = (runId: string, requestId: string): void => {
    runRequestIds.set(runId, requestId);
  };

  // Forward agent and guard events to WebSocket clients; also log to disk
  orchestrator.on('agent:event', (event) => {
    broadcast({ type: 'agent:event', payload: event });
    const requestId = runRequestIds.get(event.runId);
    // Disk logging for key lifecycle events
    if (event.type === 'run:started') {
      runStartTimes.set(event.runId, Date.now());
      const agentName = orchestrator.registry.getById(event.agentId)?.name ?? '';
      logger.agentRunStarted(event.runId, event.agentId, agentName, requestId);
    } else if (event.type === 'run:completed') {
      const p = event.payload as { output?: string; modelUsed?: string } | undefined;
      const durationMs = runStartTimes.get(event.runId) ? Date.now() - runStartTimes.get(event.runId)! : 0;
      runStartTimes.delete(event.runId);
      runRequestIds.delete(event.runId);
      logger.agentRunCompleted(event.runId, event.agentId, durationMs, p?.modelUsed, requestId);
    } else if (event.type === 'run:stopped') {
      runStartTimes.delete(event.runId);
      runRequestIds.delete(event.runId);
    } else if (event.type === 'run:failed') {
      runStartTimes.delete(event.runId);
      runRequestIds.delete(event.runId);
      const p = event.payload as { error?: string } | undefined;
      logger.agentRunFailed(event.runId, event.agentId, redactErrorMessage(p?.error ?? 'unknown'), requestId);
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
    const v = payload.verdict as { allowed: boolean; action: string; ruleId?: string };
    const c = payload.context as { operation: string };
    logger.guardDecisionLogged(c.operation, v.allowed, v.action, v.ruleId);
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
        operation: `skill:permission:${permission}`,
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

  // Custom tool store — persists user-defined webhook tools to custom-tools.json
  const customToolStore = new CustomToolStore(join(dataDir, 'config'));
  const webhookTool = new WebhookTool();

  // Wire custom tool dispatcher into orchestrator so agents can call webhook tools
  orchestrator.setCustomToolDispatcher(async (toolName: string, input: string) => {
    const tool = customToolStore.get(toolName);
    if (!tool) return null;
    return webhookTool.run(tool, input);
  });

  // Register routes
  registerCommandRoute(app, core, orchestrator, broadcast, guard, convStore);
  registerMemoryRoutes(app, memory, models, guard);
  registerModelRoutes(app, models, memory, guard);
  registerAgentRoutes(app, orchestrator, guard);
  registerGuardRoutes(app, guard, guardDecisionStore);
  registerConfigRoute(app, join(dataDir, 'config'), guard);
  registerConversationRoutes(app, convStore, guard);
  registerSkillRoutes(app, skillRegistry, guard, skillRunner);
  registerRecommendRoutes(app, models, recommender, guard);
  registerToolRoutes(app, guard, execTool);
  registerCustomToolRoutes(app, customToolStore, guard);
  registerProviderRoutes(app, models);
  registerLocalModelsRoute(app);
  registerConfigPortabilityRoutes(app, models);
  registerStreamWs(app, core, () => authCfg.token, guard);

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
  }

  // Dashboard route is registered after heartbeat is instantiated so it can
  // reference heartbeat directly (avoids a late-binding closure or re-export).
  registerDashboardRoute(app, models, memory, orchestrator, heartbeat);

  app.addHook('onClose', async () => {
    heartbeat.stop();
    // memory.close() closes the shared SQLite connection used by both stores
    memory.close();
  });

  // Expose a checkReady helper so index.ts can log readiness after listen()
  (app as unknown as Record<string, unknown>)['checkReady'] = () =>
    checkReadiness(memory, models, guard);

  return app;
}
