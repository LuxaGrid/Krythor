import { join } from 'path';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { probe, type ProbeResult } from './SystemProbe.js';
import { Installer } from './Installer.js';
import { ask, confirm, choose, closeRL, fmt } from './Prompt.js';

// ─── Provider recommendation metadata ────────────────────────────────────────
//
// These hooks allow the wizard to surface guidance to users during onboarding.
// They are presentation-only and do not affect routing or model selection logic.
// recommendation_label, recommendation_reason, priority_rank, and
// recommended_for_onboarding are intentionally kept separate from provider config
// so they can be consumed by the broader recommendation engine in future.
//

export interface ProviderRecommendation {
  recommendation_label?:    string;
  recommendation_reason?:   string;
  priority_rank:            number;
  recommended_for_onboarding: boolean;
}

export const PROVIDER_RECOMMENDATIONS: Record<string, ProviderRecommendation> = {
  anthropic: {
    recommendation_label:     'Best Overall / Recommended',
    recommendation_reason:    'Claude is highly capable for reasoning, code, and general tasks.',
    priority_rank:            1,
    recommended_for_onboarding: true,
  },
  openai: {
    recommendation_label:     'Most Versatile',
    recommendation_reason:    'Broad model selection with wide ecosystem support.',
    priority_rank:            2,
    recommended_for_onboarding: true,
  },
  kimi: {
    recommendation_label:     'Best for Large Context',
    recommendation_reason:    'Kimi supports very long context windows — ideal for long documents and code review.',
    priority_rank:            3,
    recommended_for_onboarding: true,
  },
  minimax: {
    recommendation_label:     'Best Value',
    recommendation_reason:    'MiniMax offers strong performance at a lower cost.',
    priority_rank:            4,
    recommended_for_onboarding: true,
  },
  ollama: {
    recommendation_label:     undefined,
    recommendation_reason:    'Free and fully local — no API key needed.',
    priority_rank:            5,
    recommended_for_onboarding: true,
  },
  'openai-compat': {
    recommendation_label:     undefined,
    recommendation_reason:    'Any OpenAI-compatible API (LM Studio, Together, etc.).',
    priority_rank:            6,
    recommended_for_onboarding: false,
  },
};

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
    console.log(fmt.dim('  Recommended choices for most users:'));
    for (const [id, rec] of Object.entries(PROVIDER_RECOMMENDATIONS)) {
      if (rec.recommended_for_onboarding && rec.recommendation_label) {
        console.log(fmt.dim(`    ${id.padEnd(14)} — ${rec.recommendation_label}: ${rec.recommendation_reason}`));
      }
    }
    console.log('');

    // Default: if Ollama is detected, prefer it (local = free); otherwise prefer Anthropic
    const defaultProviderIdx = sys.ollamaDetected ? 4 : 0; // ollama is index 4, anthropic is 0
    const providerOptions = ['anthropic', 'openai', 'kimi', 'minimax', 'ollama', 'openai-compat', 'skip'] as const;
    const providerType = await choose(
      'Which AI provider would you like to configure?',
      providerOptions as unknown as string[],
      defaultProviderIdx,
    );

    let firstModel: string | undefined;
    if (providerType !== 'skip') {
      const rec = PROVIDER_RECOMMENDATIONS[providerType];
      if (rec?.recommendation_label) {
        console.log(fmt.dim(`  ${rec.recommendation_label}: ${rec.recommendation_reason}`));
      }
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

    // 7. Done — print setup summary
    console.log(fmt.head('Setup Complete'));
    console.log(fmt.ok('Configuration saved to:  ' + sys.configDir));
    console.log(fmt.ok('Data directory:          ' + sys.dataDir));
    console.log('');
    console.log(fmt.dim('  What happens next:'));
    console.log(fmt.dim('    1. Krythor Gateway starts (or you can start it manually)'));
    console.log(fmt.dim('    2. Your browser opens the Control UI at http://127.0.0.1:47200'));
    console.log(fmt.dim('    3. Type a command in the input box to run your first agent'));
    console.log('');
    console.log(fmt.dim('  Useful commands:'));
    console.log(fmt.dim('    pnpm start        — start the gateway'));
    console.log(fmt.dim('    pnpm doctor       — run diagnostics'));
    console.log(fmt.dim('    pnpm setup        — re-run setup wizard'));
    console.log('');

    // Recommendation-aware summary
    if (providerType !== 'skip') {
      const rec = PROVIDER_RECOMMENDATIONS[providerType];
      console.log(fmt.dim('  Setup summary:'));
      console.log(fmt.dim(`    Primary AI  : ${providerType}${rec?.recommendation_label ? ` (${rec.recommendation_label})` : ''}`));
      if (firstModel) {
        console.log(fmt.dim(`    Model       : ${firstModel}`));
      }
      if (rec?.recommendation_reason) {
        console.log(fmt.dim(`    Notes       : ${rec.recommendation_reason}`));
      }
      console.log('');
    }

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

  // Returns the first model name if one was detected/entered, or undefined if skipped
  private async configureProvider(
    installer: Installer,
    type: string,
    sys: ProbeResult,
  ): Promise<string | undefined> {
    console.log('');

    let name = type.charAt(0).toUpperCase() + type.slice(1);
    let endpoint: string;
    let apiKey: string | undefined;
    let authMethod: 'api_key' | 'oauth' | 'none' = 'none';
    let setupHint: string | undefined;
    let models: string[] = [];

    // Providers that support both API key and OAuth get a three-way choice.
    // The actual OAuth browser flow lives in the desktop UI — not the CLI wizard.
    const dualAuthTypes = ['anthropic', 'openai'];
    const isDualAuth = dualAuthTypes.includes(type);

    if (type === 'ollama') {
      // ── Local provider — no auth needed ───────────────────────────────────
      const url = await ask(`  Base URL [${sys.ollamaBaseUrl}]: `);
      endpoint = url || sys.ollamaBaseUrl;
      authMethod = 'none';
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

    } else if (isDualAuth) {
      // ── Dual-auth providers (Anthropic, OpenAI) ───────────────────────────
      // Both API key (enter now) and OAuth (connect later in the app) are supported.
      const providerInfo: Record<string, { endpoint: string; keyUrl: string; defaultModel: string }> = {
        anthropic: {
          endpoint:     'https://api.anthropic.com',
          keyUrl:       'https://console.anthropic.com/settings/keys',
          defaultModel: 'claude-sonnet-4-6',
        },
        openai: {
          endpoint:     'https://api.openai.com/v1',
          keyUrl:       'https://platform.openai.com/api-keys',
          defaultModel: 'gpt-4o-mini',
        },
      };
      const info = providerInfo[type]!;
      endpoint = info.endpoint;

      console.log(fmt.dim('  This provider supports two connection methods:'));
      console.log(fmt.dim(''));
      console.log(fmt.dim('    [1] Enter API key now   — paste a key from the provider dashboard (fastest)'));
      console.log(fmt.dim('    [2] Connect with OAuth  — skip for now; use the in-app button after launch'));
      console.log(fmt.dim('    [3] Skip entirely       — add this provider manually later'));
      console.log(fmt.dim(''));

      const authChoice = await choose(
        '  How would you like to connect?',
        ['Enter API key now', 'Connect with OAuth later (in the app)', 'Skip'],
        0,
      );

      if (authChoice === 'Enter API key now') {
        authMethod = 'api_key';
        console.log(fmt.dim(`  Get your API key at: ${info.keyUrl}`));
        apiKey = await ask('  API Key: ');
        const modelInput = await ask(`  Default model [${info.defaultModel}]: `);
        models = [modelInput || info.defaultModel];
        console.log(fmt.ok(`Provider "${name}" configured with API key.`));

      } else if (authChoice === 'Connect with OAuth later (in the app)') {
        // Persist the provider shell so the UI can surface an OAuth CTA on first launch
        authMethod = 'none';
        setupHint = 'oauth_available';
        const modelInput = await ask(`  Default model [${info.defaultModel}]: `);
        models = [modelInput || info.defaultModel];
        console.log(fmt.ok(`Provider "${name}" added. Connect with OAuth after launch.`));
        console.log(fmt.dim('  → Open the Models tab and click "OAuth" next to this provider.'));

      } else {
        // Skip entirely — do not write any provider entry
        console.log(fmt.dim(`  Skipped. Add ${name} later from the Models tab.`));
        return undefined;
      }

    } else if (type === 'kimi') {
      endpoint = 'https://api.moonshot.cn/v1';
      name = 'Kimi';
      authMethod = 'api_key';
      console.log(fmt.dim('  Get your API key at: https://platform.moonshot.cn/console/api-keys'));
      apiKey = await ask('  API Key: ');
      const modelInput = await ask('  Default model [moonshot-v1-128k]: ');
      models = [modelInput || 'moonshot-v1-128k'];

    } else if (type === 'minimax') {
      endpoint = 'https://api.minimax.chat/v1';
      name = 'MiniMax';
      authMethod = 'api_key';
      console.log(fmt.dim('  Get your API key at: https://www.minimax.chat/user-center/basic-information/interface-key'));
      apiKey = await ask('  API Key: ');
      const modelInput = await ask('  Default model [abab6.5s-chat]: ');
      models = [modelInput || 'abab6.5s-chat'];

    } else {
      // ── openai-compat ──────────────────────────────────────────────────────
      endpoint = await ask('  Base URL: ');
      const nameInput = await ask('  Provider name: ');
      name = nameInput || 'OpenAI-Compat';
      const modelInput = await ask('  Default model: ');
      models = modelInput ? [modelInput] : [];
      const keyInput = await ask('  API Key (leave blank if none): ');
      if (keyInput) {
        apiKey = keyInput;
        authMethod = 'api_key';
      } else {
        authMethod = 'none';
      }
    }

    // kimi and minimax use the openai-compat provider type internally
    const providerType = (type === 'kimi' || type === 'minimax') ? 'openai-compat' : type;

    installer.addProvider({
      name,
      type: providerType,
      endpoint,
      authMethod,
      apiKey: apiKey || undefined,
      setupHint,
      isDefault: authMethod === 'api_key' || authMethod === 'none', // oauth-pending providers can still be default placeholder
      isEnabled: true,
      models,
    });

    if (!isDualAuth || authMethod === 'api_key') {
      console.log(fmt.ok(`Provider "${name}" configured as default.`));
    }

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
