#!/usr/bin/env node
import { SetupWizard } from '../SetupWizard.js';
import { Installer } from '../Installer.js';
import { probe } from '../SystemProbe.js';
import { fmt } from '../Prompt.js';

const args = process.argv.slice(2);

if (args.includes('doctor')) {
  // ── Doctor mode ────────────────────────────────────────────────────────────
  // Checks config, DB, providers, and port health; prints a human-readable
  // diagnostic report. Does not start any processes or modify any files.
  //
  // Usage: krythor-setup doctor
  //
  (async () => {
    console.log(fmt.head('Krythor Doctor'));
    console.log(fmt.dim('  Running diagnostics — this may take a moment…\n'));

    const sys = await probe();

    // ── System ──────────────────────────────────────────────────────────────
    console.log(fmt.head('System'));
    console.log(sys.nodeVersionOk
      ? fmt.ok(`Node ${sys.nodeVersion} (${sys.platform})`)
      : fmt.err(`Node ${sys.nodeVersion} — Krythor requires Node 20+ (https://nodejs.org)`));
    console.log(sys.gatewayPortFree
      ? fmt.ok('Port 47200 is free')
      : fmt.warn('Port 47200 is in use — gateway may already be running'));
    console.log(sys.ollamaDetected
      ? fmt.ok(`Ollama detected at ${sys.ollamaBaseUrl}`)
      : fmt.dim('  Ollama not detected (not required)'));
    console.log('');

    // ── Config ──────────────────────────────────────────────────────────────
    console.log(fmt.head('Configuration'));
    if (!sys.hasExistingConfig) {
      console.log(fmt.warn('No configuration found. Run: pnpm setup'));
      console.log('');
    } else {
      console.log(fmt.ok(`Config directory: ${sys.configDir}`));
      // Check for providers.json and agents.json
      const { existsSync, readFileSync } = await import('fs');
      const { join } = await import('path');

      const providersPath = join(sys.configDir, 'providers.json');
      const agentsPath    = join(sys.configDir, 'agents.json');

      if (!existsSync(providersPath)) {
        console.log(fmt.warn('providers.json not found — no providers configured'));
      } else {
        try {
          const rawProviders = JSON.parse(readFileSync(providersPath, 'utf-8')) as unknown;
          // Handle both storage formats: flat array or wrapped { providers: [...] }
          let providerList: unknown[];
          if (Array.isArray(rawProviders)) {
            providerList = rawProviders;
          } else if (
            rawProviders && typeof rawProviders === 'object' &&
            'providers' in (rawProviders as object) &&
            Array.isArray((rawProviders as { providers: unknown }).providers)
          ) {
            providerList = (rawProviders as { providers: unknown[] }).providers;
          } else {
            providerList = [];
          }

          if (providerList.length === 0) {
            console.log(fmt.warn('providers.json is empty — add a provider via: Models tab or pnpm setup'));
          } else {
            console.log(fmt.ok(`providers.json: ${providerList.length} provider(s) configured`));

            // ── Per-provider auth check ──────────────────────────────────────
            // Validate that each enabled provider has credentials.
            // This catches stale OAuth tokens, missing API keys, and misconfigured entries.
            let authWarnings = 0;
            for (const p of providerList) {
              if (!p || typeof p !== 'object') continue;
              const entry = p as Record<string, unknown>;
              const name = typeof entry['name'] === 'string' ? entry['name'] : 'unknown';
              const type = typeof entry['type'] === 'string' ? entry['type'] : '';
              const authMethod = typeof entry['authMethod'] === 'string' ? entry['authMethod'] : 'none';
              const isEnabled = entry['isEnabled'] !== false; // default true

              if (!isEnabled) {
                console.log(fmt.dim(`    ${name} — disabled (skipped)`));
                continue;
              }

              if (authMethod === 'api_key') {
                const hasKey = typeof entry['apiKey'] === 'string' && entry['apiKey'].length > 0;
                if (hasKey) {
                  console.log(fmt.ok(`    ${name} — API key present`));
                } else {
                  console.log(fmt.err(`    ${name} — API key missing! Re-run setup or add key in Models tab`));
                  authWarnings++;
                }
              } else if (authMethod === 'oauth') {
                const oa = entry['oauthAccount'] as Record<string, unknown> | undefined;
                const hasToken = oa && typeof oa['accessToken'] === 'string' && oa['accessToken'].length > 0;
                if (hasToken) {
                  const expiresAt = typeof oa!['expiresAt'] === 'number' ? oa!['expiresAt'] : 0;
                  const isExpired = expiresAt > 0 && expiresAt < Date.now();
                  if (isExpired) {
                    console.log(fmt.warn(`    ${name} — OAuth token expired. Reconnect in the Models tab`));
                    authWarnings++;
                  } else {
                    console.log(fmt.ok(`    ${name} — OAuth connected`));
                  }
                } else {
                  console.log(fmt.err(`    ${name} — OAuth not connected. Open Models tab to connect`));
                  authWarnings++;
                }
              } else if (authMethod === 'none') {
                // Local providers (ollama) don't need auth — OK.
                // Cloud providers without auth are suspicious.
                if (type !== 'ollama' && type !== 'gguf') {
                  console.log(fmt.warn(`    ${name} — no auth configured (add API key or connect OAuth)`));
                  authWarnings++;
                } else {
                  console.log(fmt.ok(`    ${name} — local provider (no auth required)`));
                }
              }
            }
            if (authWarnings > 0) {
              console.log(fmt.warn(`  ${authWarnings} provider(s) need attention — see above`));
            }
          }
        } catch {
          console.log(fmt.err('providers.json is malformed — run: pnpm setup'));
        }
      }

      if (!existsSync(agentsPath)) {
        console.log(fmt.warn('agents.json not found — no agents configured'));
      } else {
        try {
          const agents = JSON.parse(readFileSync(agentsPath, 'utf-8')) as unknown[];
          const list = Array.isArray(agents) ? agents : [];
          console.log(list.length > 0
            ? fmt.ok(`agents.json: ${list.length} agent(s) configured`)
            : fmt.warn('agents.json is empty — a default agent will be created on next setup'));
        } catch {
          console.log(fmt.err('agents.json is malformed — run: pnpm setup'));
        }
      }
      console.log('');
    }

    // ── Database ────────────────────────────────────────────────────────────
    console.log(fmt.head('Database'));
    const { existsSync } = await import('fs');
    const { join } = await import('path');
    const dbPath = join(sys.dataDir, 'memory', 'memory.db');
    if (!existsSync(dbPath)) {
      console.log(fmt.warn('memory.db not found — will be created on first run'));
    } else {
      console.log(fmt.ok(`memory.db found at: ${dbPath}`));
      const { statSync } = await import('fs');
      const sizeKb = Math.round(statSync(dbPath).size / 1024);
      console.log(fmt.dim(`  Size: ${sizeKb} KB`));
    }
    console.log('');

    // ── Gateway ─────────────────────────────────────────────────────────────
    console.log(fmt.head('Gateway'));
    if (!sys.gatewayPortFree) {
      try {
        const resp = await fetch('http://127.0.0.1:47200/health', { signal: AbortSignal.timeout(2000) });
        if (resp.ok) {
          const data = await resp.json() as {
            version?: string;
            status?: string;
            models?: { providerCount?: number; modelCount?: number; hasDefault?: boolean };
            dataDir?: string;
            configDir?: string;
            firstRun?: boolean;
          };
          console.log(fmt.ok(`Gateway running — version ${data.version ?? '?'}, status: ${data.status ?? '?'}`));
          console.log(fmt.ok('Control UI: http://127.0.0.1:47200'));
          if (data.models) {
            const pc = data.models.providerCount ?? 0;
            const mc = data.models.modelCount ?? 0;
            if (pc === 0) {
              console.log(fmt.warn('  No providers configured — run: pnpm setup'));
            } else {
              console.log(fmt.ok(`  Providers: ${pc}, Models: ${mc}, Default: ${data.models.hasDefault ? 'yes' : 'no'}`));
            }
          }
          if (data.dataDir)   console.log(fmt.dim(`  Data dir:   ${data.dataDir}`));
          if (data.configDir) console.log(fmt.dim(`  Config dir: ${data.configDir}`));
          if (data.firstRun) {
            console.log(fmt.warn('  First-run state detected — run: pnpm setup'));
          }
        } else {
          console.log(fmt.warn('Port 47200 in use but /health returned non-OK response'));
        }
      } catch {
        console.log(fmt.warn('Port 47200 in use but /health did not respond (may be another process)'));
      }
    } else {
      console.log(fmt.dim('  Gateway is not running — start with: pnpm start'));
    }
    console.log('');

    // ── Embedding ────────────────────────────────────────────────────────────
    console.log(fmt.head('Embedding'));
    if (!sys.gatewayPortFree) {
      // Gateway is running — try to fetch embedding status from /health
      try {
        const resp = await fetch('http://127.0.0.1:47200/health', { signal: AbortSignal.timeout(2000) });
        if (resp.ok) {
          const data = await resp.json() as { memory?: { embeddingDegraded?: boolean; embeddingProvider?: string } };
          const deg = data.memory?.embeddingDegraded;
          if (deg === false) {
            console.log(fmt.ok(`Semantic search active (provider: ${data.memory?.embeddingProvider ?? '?'})`));
          } else {
            console.log(fmt.warn('Semantic memory search is degraded — no real embedding provider active.'));
            console.log(fmt.dim('  Keyword and stored memory features still work.'));
            console.log(fmt.dim('  To enable semantic search, add an Ollama provider via: pnpm setup'));
          }
        }
      } catch {
        console.log(fmt.dim('  Could not fetch embedding status from gateway.'));
      }
    } else {
      console.log(fmt.dim('  Gateway not running — embedding status unavailable.'));
    }
    console.log('');

    // ── Migration integrity check ────────────────────────────────────────────
    // Open the DB (read-only) and compare applied migrations against SQL files on disk.
    // ITEM 7: Doctor — Migration integrity
    console.log(fmt.head('Migrations'));
    {
      const { existsSync: existsSyncMig, readdirSync } = await import('fs');
      const { join: joinMig } = await import('path');

      const dbPath = joinMig(sys.dataDir, 'memory', 'memory.db');
      if (!existsSyncMig(dbPath)) {
        console.log(fmt.dim('  memory.db not found — migrations will run on first start'));
      } else {
        try {
          // Dynamically load better-sqlite3 — it may not be available in all envs
          const Database = (await import('better-sqlite3')).default;
          const db = new Database(dbPath, { readonly: true });

          // Read applied migrations from the tracking table
          let appliedVersions: Set<number> = new Set();
          try {
            const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
            appliedVersions = new Set(rows.map((r: { version: number }) => r.version));
          } catch { /* table may not exist yet */ }

          // Find SQL migration files on disk — located in packages/memory/src/db/migrations/
          // Walk up from __dirname to find the packages directory
          const candidates = [
            joinMig(__dirname, '..', '..', '..', '..', 'packages', 'memory', 'src', 'db', 'migrations'),
            joinMig(__dirname, '..', '..', '..', 'memory', 'src', 'db', 'migrations'),
            joinMig(__dirname, '..', '..', 'memory', 'dist', 'db', 'migrations'),
          ];
          let migrationsDir: string | undefined;
          for (const c of candidates) {
            if (existsSyncMig(c)) { migrationsDir = c; break; }
          }

          let expectedTotal = 0;
          if (migrationsDir) {
            try {
              const files = readdirSync(migrationsDir).filter((f: string) => f.endsWith('.sql'));
              expectedTotal = files.length;
            } catch {}
          }

          const appliedCount = appliedVersions.size;

          if (expectedTotal === 0) {
            // Can't find migration files on disk — report applied count only
            console.log(fmt.ok(`Migrations: ${appliedCount} applied`));
            console.log(fmt.dim('  (migration SQL files not found — cannot verify total)'));
          } else if (appliedCount >= expectedTotal) {
            console.log(fmt.ok(`Migrations: ${appliedCount}/${expectedTotal} applied`));
          } else {
            console.log(fmt.warn(`Migrations: ${appliedCount}/${expectedTotal} applied — run: krythor repair`));
            console.log(fmt.dim('  Missing migrations will be applied automatically on next gateway start.'));
          }

          db.close();
        } catch (err) {
          console.log(fmt.dim(`  Could not inspect migrations: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
    }
    console.log('');

    // ── Stale agent model references ─────────────────────────────────────────
    // ITEM 9: Doctor — stale agent detection
    // Check if any agent references a model that is not in any configured provider.
    console.log(fmt.head('Agents — Model References'));
    {
      const { existsSync: existsSyncAgents, readFileSync: readFileSyncAgents } = await import('fs');
      const { join: joinAgents } = await import('path');

      const agentsPath = joinAgents(sys.configDir, 'agents.json');
      const providersPath = joinAgents(sys.configDir, 'providers.json');

      if (!existsSyncAgents(agentsPath) || !existsSyncAgents(providersPath)) {
        console.log(fmt.dim('  Config not found — skipping stale agent check'));
      } else {
        try {
          const rawAgents = JSON.parse(readFileSyncAgents(agentsPath, 'utf-8'));
          const rawProviders = JSON.parse(readFileSyncAgents(providersPath, 'utf-8'));

          const agentList = Array.isArray(rawAgents) ? rawAgents : [];
          // Build a set of all known model IDs across all providers
          let allModels: Set<string> = new Set();
          try {
            const providerArr = Array.isArray(rawProviders)
              ? rawProviders
              : (rawProviders?.providers ?? []);
            for (const p of providerArr) {
              if (p && Array.isArray(p.models)) {
                for (const m of p.models) {
                  if (typeof m === 'string') allModels.add(m);
                }
              }
            }
          } catch {}

          if (allModels.size === 0) {
            console.log(fmt.dim('  No models configured — cannot check agent model references'));
          } else {
            const staleAgents: Array<{ name: string; modelId: string }> = [];
            for (const agent of agentList) {
              if (!agent || typeof agent !== 'object') continue;
              const modelId = (agent as Record<string, unknown>)['modelId'];
              if (typeof modelId === 'string' && modelId.length > 0) {
                if (!allModels.has(modelId)) {
                  const name = typeof (agent as Record<string, unknown>)['name'] === 'string'
                    ? (agent as Record<string, unknown>)['name'] as string
                    : 'unknown';
                  staleAgents.push({ name, modelId });
                }
              }
            }

            if (staleAgents.length === 0) {
              console.log(fmt.ok(`All ${agentList.length} agent(s) reference valid models`));
            } else {
              for (const { name, modelId } of staleAgents) {
                console.log(fmt.warn(`Agent '${name}' references model '${modelId}' which is not in any configured provider`));
                console.log(fmt.dim('    Fix: update the agent\'s model in the Control UI → Agents tab'));
              }
            }
          }
        } catch (err) {
          console.log(fmt.dim(`  Could not check agent model references: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
    }
    console.log('');

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log(fmt.head('Summary'));
    let criticalIssues = 0;
    let warnings = 0;

    if (!sys.nodeVersionOk) {
      console.log(fmt.err('CRITICAL: Node.js version too old — upgrade to Node 20+ (https://nodejs.org)'));
      criticalIssues++;
    }
    if (!sys.hasExistingConfig) {
      console.log(fmt.warn('No configuration found.'));
      console.log(fmt.dim('  Next action: pnpm setup'));
      warnings++;
    }

    if (criticalIssues > 0) {
      console.log('');
      console.log(fmt.err(`${criticalIssues} critical issue(s) found — Krythor cannot start until resolved.`));
      process.exit(1);
    } else if (warnings > 0) {
      console.log('');
      console.log(fmt.warn(`${warnings} warning(s) found — see above for details.`));
      process.exit(0); // Warnings do not block startup
    } else {
      console.log(fmt.ok('Krythor appears healthy.'));
      console.log('');
      if (sys.gatewayPortFree) {
        console.log(fmt.dim('  Next action: pnpm start'));
      } else {
        console.log(fmt.dim('  Gateway is running — open http://127.0.0.1:47200 in your browser.'));
      }
    }
    console.log('');
  })().catch(err => {
    console.error(fmt.err('Doctor failed: ' + (err instanceof Error ? err.message : String(err))));
    process.exit(1);
  });
} else if (args.includes('--test-providers')) {
  // ── Test-providers mode ────────────────────────────────────────────────────
  // Makes a minimal live API call to each configured, enabled provider and
  // reports whether the credentials are valid and the endpoint is reachable.
  //
  // Usage: krythor doctor --test-providers
  //
  (async () => {
    console.log(fmt.head('Krythor — Provider Live Test'));
    console.log(fmt.dim('  Making a minimal API call to each enabled provider…\n'));

    const { join } = await import('path');
    const { ModelRegistry } = await import('@krythor/models');

    const sys = await probe();
    const configDir = join(sys.dataDir, 'config');

    let registry: InstanceType<typeof ModelRegistry>;
    try {
      registry = new ModelRegistry(configDir);
    } catch (err) {
      console.error(fmt.err('Failed to load ModelRegistry: ' + (err instanceof Error ? err.message : String(err))));
      process.exit(1);
    }

    const configs = registry.listConfigs().filter(c => c.isEnabled);

    if (configs.length === 0) {
      console.log(fmt.warn('No enabled providers found. Run: krythor setup'));
      process.exit(0);
    }

    let passed = 0;
    let failed = 0;

    for (const cfg of configs) {
      const label = `${cfg.name} (${cfg.type})`;
      process.stdout.write(`  ${label.padEnd(40)} `);

      try {
        let ok = false;
        let detail = '';

        if (cfg.type === 'ollama' || cfg.type === 'gguf') {
          // Ollama / local: GET <endpoint>/api/tags
          const endpoint = cfg.endpoint.replace(/\/$/, '');
          const tagsUrl = `${endpoint}/api/tags`;
          const res = await fetch(tagsUrl, { signal: AbortSignal.timeout(5000) });
          ok = res.ok;
          if (!ok) detail = `HTTP ${res.status}`;
          else {
            const body = await res.json() as { models?: unknown[] };
            const count = Array.isArray(body.models) ? body.models.length : 0;
            detail = `${count} model(s) available`;
          }

        } else if (cfg.type === 'anthropic') {
          // Anthropic: GET /v1/models
          const apiKey = cfg.apiKey ?? '';
          if (!apiKey) {
            ok = false;
            detail = 'no API key configured';
          } else {
            const res = await fetch('https://api.anthropic.com/v1/models', {
              headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
              },
              signal: AbortSignal.timeout(8000),
            });
            ok = res.ok;
            if (!ok) {
              const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
              detail = `HTTP ${res.status}${body.error?.message ? `: ${body.error.message}` : ''}`;
            } else {
              const body = await res.json() as { data?: unknown[] };
              const count = Array.isArray(body.data) ? body.data.length : 0;
              detail = `${count} model(s) visible`;
            }
          }

        } else if (cfg.type === 'openai') {
          // OpenAI: GET /v1/models
          const apiKey = cfg.apiKey ?? '';
          if (!apiKey) {
            ok = false;
            detail = 'no API key configured';
          } else {
            const res = await fetch('https://api.openai.com/v1/models', {
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: AbortSignal.timeout(8000),
            });
            ok = res.ok;
            if (!ok) {
              const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
              detail = `HTTP ${res.status}${body.error?.message ? `: ${body.error.message}` : ''}`;
            } else {
              const body = await res.json() as { data?: unknown[] };
              const count = Array.isArray(body.data) ? body.data.length : 0;
              detail = `${count} model(s) visible`;
            }
          }

        } else if (cfg.type === 'openai-compat') {
          // OpenAI-compat: GET <endpoint>/v1/models
          const endpoint = cfg.endpoint.replace(/\/$/, '');
          const modelsUrl = endpoint.endsWith('/v1') ? `${endpoint}/models` : `${endpoint}/v1/models`;
          const headers: Record<string, string> = {};
          if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
          const res = await fetch(modelsUrl, {
            headers,
            signal: AbortSignal.timeout(8000),
          });
          ok = res.ok;
          if (!ok) detail = `HTTP ${res.status}`;
          else {
            const body = await res.json() as { data?: unknown[] };
            const count = Array.isArray(body.data) ? body.data.length : 0;
            detail = `${count} model(s) available`;
          }

        } else {
          ok = false;
          detail = `unknown provider type '${cfg.type}'`;
        }

        if (ok) {
          console.log(`${fmt.ok('')}${detail}`);
          passed++;
        } else {
          console.log(`${fmt.err('')}${detail}`);
          failed++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`${fmt.err('')}${msg}`);
        failed++;
      }
    }

    console.log('');
    if (failed === 0) {
      console.log(fmt.ok(`All ${passed} provider(s) passed live test.`));
      process.exit(0);
    } else {
      console.log(fmt.warn(`${passed} passed, ${failed} failed. See above for details.`));
      process.exit(1);
    }
  })().catch(err => {
    console.error(fmt.err('Provider test failed: ' + (err instanceof Error ? err.message : String(err))));
    process.exit(1);
  });

} else if (args.includes('--rollback')) {
  // ── Rollback mode ──────────────────────────────────────────────────────────
  // Finds the most recent pre-migration backup for the Krythor SQLite DB and
  // restores it, replacing the live database file.
  //
  // Usage: krythor-setup --rollback
  //
  // Prerequisites:
  //   - The Krythor gateway must be stopped before running rollback.
  //   - A `.bak` file must exist (created automatically before each migration).
  //
  probe().then(sys => {
    const dbFilePath = `${sys.dataDir}/memory/memory.db`;
    const installer = new Installer(sys.configDir);

    console.log(fmt.info('Rollback mode — scanning for latest backup…'));

    const backupPath = installer.findLatestBackup(dbFilePath);
    if (!backupPath) {
      console.error(fmt.err('No backup file found. Cannot rollback.'));
      console.error(fmt.err(`  Looked in: ${sys.dataDir}/memory/`));
      process.exit(1);
    }

    console.log(fmt.warn(`Found backup: ${backupPath}`));
    console.log(fmt.warn('This will REPLACE the current database with the backup.'));
    console.log(fmt.warn('Make sure the Krythor gateway is stopped before proceeding.'));
    console.log('');

    // Proceed — user invoked --rollback explicitly (non-interactive)
    try {
      installer.restoreBackup(backupPath, dbFilePath);
      console.log(fmt.ok(`Database restored from: ${backupPath}`));
      console.log(fmt.ok('Rollback complete. You may restart the Krythor gateway.'));
    } catch (err) {
      console.error(fmt.err('Rollback failed: ' + (err instanceof Error ? err.message : String(err))));
      process.exit(1);
    }
  }).catch(err => {
    console.error(fmt.err('Rollback failed: ' + (err instanceof Error ? err.message : String(err))));
    process.exit(1);
  });
} else {
  // ── Normal wizard mode ─────────────────────────────────────────────────────
  new SetupWizard().run().catch(err => {
    console.error('\x1b[31mSetup failed:\x1b[0m', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
