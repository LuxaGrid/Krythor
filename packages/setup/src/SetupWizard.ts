import { join } from 'path';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { probe, type ProbeResult } from './SystemProbe.js';
import { Installer } from './Installer.js';
import { ask, confirm, choose, closeRL, fmt } from './Prompt.js';

// ─── SetupWizard ──────────────────────────────────────────────────────────────

export class SetupWizard {
  async run(): Promise<void> {
    this.printBanner();

    // 1. Probe the system
    console.log(fmt.info('Scanning system…'));
    const sys = await probe();
    this.printProbe(sys);

    if (!sys.nodeVersionOk) {
      console.log(fmt.err(`Node ${sys.nodeVersion} detected. Krythor requires Node 18+. Aborting.`));
      process.exit(1);
    }

    // 2. Existing config?
    const installer = new Installer(sys.configDir);
    if (sys.hasExistingConfig) {
      console.log(fmt.warn('Existing configuration detected.'));
      const reset = await confirm('  Overwrite and reconfigure?', false);
      if (!reset) {
        console.log(fmt.info('Keeping existing configuration.'));
        // Still ensure default agent exists even on keep
        if (!installer.hasDefaultAgent()) {
          installer.writeDefaultAgent();
          installer.writeAppConfig({ selectedAgentId: 'krythor-default' });
          console.log(fmt.ok('Default "Krythor" agent created.'));
        }
        await this.offerLaunch(sys);
        closeRL();
        return;
      }
    }

    // 3. Ensure directories
    installer.ensureDirs(sys.dataDir);

    // 4. Create default agent
    installer.writeDefaultAgent();
    console.log(fmt.ok('Default "Krythor" agent created.'));

    // 5. Provider setup
    console.log(fmt.head('Provider Setup'));
    const providerType = await choose(
      'Which AI provider would you like to configure?',
      ['ollama', 'openai', 'anthropic', 'openai-compat', 'skip'],
      sys.ollamaDetected ? 0 : 1,
    );

    let firstModel: string | undefined;
    if (providerType !== 'skip') {
      firstModel = await this.configureProvider(installer, providerType, sys);
    } else {
      console.log(fmt.dim('  Skipped. You can add providers via the Models tab in the Control UI.'));
    }

    // 6. Write app config with defaults
    installer.writeAppConfig({
      selectedAgentId: 'krythor-default',
      selectedModel: firstModel,
      onboardingComplete: providerType !== 'skip',
    });

    // 7. Done
    console.log(fmt.head('Setup Complete'));
    console.log(fmt.ok('Configuration written to: ' + sys.configDir));
    console.log(fmt.ok('Data directory:           ' + sys.dataDir));
    console.log('');

    await this.offerLaunch(sys);
    closeRL();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private printBanner(): void {
    console.log('\x1b[36m');
    console.log('  ██╗  ██╗██████╗ ██╗   ██╗████████╗██╗  ██╗ ██████╗ ██████╗ ');
    console.log('  ██║ ██╔╝██╔══██╗╚██╗ ██╔╝╚══██╔══╝██║  ██║██╔═══██╗██╔══██╗');
    console.log('  █████╔╝ ██████╔╝ ╚████╔╝    ██║   ███████║██║   ██║██████╔╝');
    console.log('  ██╔═██╗ ██╔══██╗  ╚██╔╝     ██║   ██╔══██║██║   ██║██╔══██╗');
    console.log('  ██║  ██╗██║  ██║   ██║      ██║   ██║  ██║╚██████╔╝██║  ██║');
    console.log('  ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝      ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝');
    console.log('\x1b[0m');
    console.log('  Local-first AI command platform  —  Setup Wizard\n');
  }

  private printProbe(sys: ProbeResult): void {
    console.log(fmt.ok(`Node ${sys.nodeVersion} (${sys.platform})`));
    console.log(sys.gatewayPortFree
      ? fmt.ok('Port 47200 is free')
      : fmt.warn('Port 47200 is in use — gateway may already be running'));
    console.log(sys.ollamaDetected
      ? fmt.ok(`Ollama detected at ${sys.ollamaBaseUrl}`)
      : fmt.dim('  Ollama not detected (not required)'));
    if (sys.hasExistingConfig) {
      console.log(fmt.warn('Existing config found at ' + sys.configDir));
    }
    console.log('');
  }

  // Returns the first model name if one was detected/entered
  private async configureProvider(
    installer: Installer,
    type: string,
    sys: ProbeResult,
  ): Promise<string | undefined> {
    console.log('');

    let name = type.charAt(0).toUpperCase() + type.slice(1);
    let endpoint: string;
    let apiKey: string | undefined;
    let models: string[] = [];

    if (type === 'ollama') {
      const url = await ask(`  Base URL [${sys.ollamaBaseUrl}]: `);
      endpoint = url || sys.ollamaBaseUrl;
      try {
        const res = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const data = await res.json() as { models?: Array<{ name: string }> };
          models = (data.models ?? []).map(m => m.name);
          if (models.length > 0) {
            console.log(fmt.ok(`Found ${models.length} model(s): ${models.slice(0, 5).join(', ')}${models.length > 5 ? '…' : ''}`));
          }
        }
      } catch { /* offline — fine */ }
    } else if (type === 'openai') {
      apiKey = await ask('  API Key: ');
      const modelInput = await ask('  Default model [gpt-4o-mini]: ');
      models = [modelInput || 'gpt-4o-mini'];
      endpoint = 'https://api.openai.com/v1';
    } else if (type === 'anthropic') {
      apiKey = await ask('  API Key: ');
      const modelInput = await ask('  Default model [claude-sonnet-4-6]: ');
      models = [modelInput || 'claude-sonnet-4-6'];
      endpoint = 'https://api.anthropic.com';
    } else {
      // openai-compat
      endpoint = await ask('  Base URL: ');
      const nameInput = await ask('  Provider name: ');
      name = nameInput || 'OpenAI-Compat';
      const modelInput = await ask('  Default model: ');
      models = modelInput ? [modelInput] : [];
      apiKey = await ask('  API Key (leave blank if none): ') || undefined;
    }

    installer.addProvider({
      name,
      type,
      endpoint,
      apiKey: apiKey || undefined,
      isDefault: true,
      isEnabled: true,
      models,
    });

    console.log(fmt.ok(`Provider "${name}" configured as default.`));
    return models[0];
  }

  private async offerLaunch(sys: ProbeResult): Promise<void> {
    const candidates = [
      join(__dirname, '..', '..', '..', 'gateway', 'dist', 'index.js'),
      join(__dirname, '..', '..', '..', '..', 'packages', 'gateway', 'dist', 'index.js'),
    ];
    const gatewayPath = candidates.find(p => existsSync(p));

    if (!gatewayPath) {
      console.log(fmt.warn('Gateway not found — build first with: pnpm -r build'));
      return;
    }

    const scriptDir = join(sys.dataDir, 'bin');
    const installer = new Installer(sys.configDir);
    installer.writeStartScript(gatewayPath, scriptDir);
    console.log(fmt.ok(`Start script written to: ${scriptDir}`));
    console.log('');

    if (!sys.gatewayPortFree) {
      console.log(fmt.info('Gateway appears to already be running at http://127.0.0.1:47200'));
      console.log(fmt.info('Control UI: http://127.0.0.1:47200'));
      return;
    }

    const launch = await confirm('Launch Krythor Gateway now?', true);
    if (!launch) {
      console.log('');
      console.log(fmt.info(`To start manually:  node "${gatewayPath}"`));
      console.log(fmt.info('Control UI:         http://127.0.0.1:47200'));
      return;
    }

    console.log('');
    console.log(fmt.info('Starting Krythor Gateway…'));
    const child = spawn(process.execPath, [gatewayPath], { detached: true, stdio: 'ignore' });
    child.unref();

    let ready = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 600));
      try {
        const r = await fetch('http://127.0.0.1:47200/health', { signal: AbortSignal.timeout(500) });
        if (r.ok) { ready = true; break; }
      } catch {}
    }

    if (ready) {
      console.log(fmt.ok('Gateway is running  →  http://127.0.0.1:47200'));
      console.log(fmt.ok('Control UI          →  http://127.0.0.1:47200'));
    } else {
      console.log(fmt.warn('Gateway did not respond in time. Check logs.'));
      console.log(fmt.info(`Manual start:  node "${gatewayPath}"`));
    }
  }
}
