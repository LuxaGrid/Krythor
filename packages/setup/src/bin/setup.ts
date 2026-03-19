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
      : fmt.err(`Node ${sys.nodeVersion} — Krythor requires Node 18+`));
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
          const providers = JSON.parse(readFileSync(providersPath, 'utf-8')) as unknown[];
          const list = Array.isArray(providers) ? providers : [];
          if (list.length === 0) {
            console.log(fmt.warn('providers.json is empty — add a provider via: Models tab or pnpm setup'));
          } else {
            console.log(fmt.ok(`providers.json: ${list.length} provider(s) configured`));
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
          const data = await resp.json() as { version?: string; status?: string };
          console.log(fmt.ok(`Gateway running — version ${data.version ?? '?'}, status: ${data.status ?? '?'}`));
          console.log(fmt.ok('Control UI: http://127.0.0.1:47200'));
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

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log(fmt.head('Summary'));
    if (!sys.nodeVersionOk) {
      console.log(fmt.err('CRITICAL: Node.js version too old — upgrade to Node 18+'));
    } else if (!sys.hasExistingConfig) {
      console.log(fmt.warn('Run setup first: pnpm setup'));
    } else {
      console.log(fmt.ok('Krythor appears healthy. Start with: pnpm start'));
    }
    console.log('');
  })().catch(err => {
    console.error(fmt.err('Doctor failed: ' + (err instanceof Error ? err.message : String(err))));
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
