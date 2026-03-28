import { join } from 'path';
import { existsSync } from 'fs';
import { randomBytes } from 'crypto';
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
  openrouter: {
    recommendation_label:     'Best Multi-Model Access',
    recommendation_reason:    'Single API key accesses 200+ models from Anthropic, OpenAI, Google, Meta, and more.',
    priority_rank:            3,
    recommended_for_onboarding: true,
  },
  groq: {
    recommendation_label:     'Fastest Inference',
    recommendation_reason:    'Groq delivers extremely fast token throughput — great for interactive use.',
    priority_rank:            4,
    recommended_for_onboarding: true,
  },
  kimi: {
    recommendation_label:     'Best for Large Context',
    recommendation_reason:    'Kimi supports very long context windows — ideal for long documents and code review.',
    priority_rank:            5,
    recommended_for_onboarding: true,
  },
  minimax: {
    recommendation_label:     'Best Value',
    recommendation_reason:    'MiniMax offers strong performance at a lower cost.',
    priority_rank:            6,
    recommended_for_onboarding: true,
  },
  venice: {
    recommendation_label:     'Most Private',
    recommendation_reason:    'Venice is privacy-focused — prompts and responses are not logged or used for training.',
    priority_rank:            7,
    recommended_for_onboarding: true,
  },
  'z.ai': {
    recommendation_label:     'Best for Google Models',
    recommendation_reason:    'Z.AI provides access to Gemini and other Google AI models.',
    priority_rank:            8,
    recommended_for_onboarding: true,
  },
  ollama: {
    recommendation_label:     undefined,
    recommendation_reason:    'Free and fully local — no API key needed.',
    priority_rank:            9,
    recommended_for_onboarding: true,
  },
  lmstudio: {
    recommendation_label:     undefined,
    recommendation_reason:    'LM Studio — run local GGUF models with a desktop GUI.',
    priority_rank:            10,
    recommended_for_onboarding: false,
  },
  llamaserver: {
    recommendation_label:     undefined,
    recommendation_reason:    'llama-server (llama.cpp) — high-performance local GGUF inference.',
    priority_rank:            11,
    recommended_for_onboarding: false,
  },
  'openai-compat': {
    recommendation_label:     undefined,
    recommendation_reason:    'Any OpenAI-compatible API (Together AI, Fireworks, custom endpoints, etc.).',
    priority_rank:            12,
    recommended_for_onboarding: false,
  },
};

// ─── Model picker ─────────────────────────────────────────────────────────────
// Shows a numbered list of known models. The last option is always "Enter manually"
// so the user is never blocked by a stale list.

const ENTER_MANUALLY = 'Enter model name manually';

async function pickModel(knownModels: string[], defaultModel: string): Promise<string> {
  const options = [...knownModels, ENTER_MANUALLY];
  const defaultIdx = knownModels.indexOf(defaultModel);
  const chosen = await choose('  Default model', options, defaultIdx >= 0 ? defaultIdx : 0);
  if (chosen === ENTER_MANUALLY) {
    const manual = await ask(`  Model name [${defaultModel}]: `);
    return manual || defaultModel;
  }
  return chosen;
}

// ─── SetupWizard ──────────────────────────────────────────────────────────────

export interface SetupWizardOptions {
  /** Only reconfigure a specific section (provider | gateway | channels | web-search) */
  section?: 'provider' | 'gateway' | 'channels' | 'web-search';
  /** Reset config without prompting for confirmation */
  reset?: boolean;
}

export class SetupWizard {
  constructor(private readonly opts: SetupWizardOptions = {}) {}

  async run(): Promise<void> {
    // ── Non-interactive guard ───────────────────────────────────────────────
    // When KRYTHOR_NON_INTERACTIVE=1 is set (e.g. in CI or scripted installs),
    // the wizard exits immediately. Providers must be configured via
    // providers.json or the Control UI after the gateway starts.
    if (process.env['KRYTHOR_NON_INTERACTIVE'] === '1') {
      console.log(fmt.warn('Setup wizard skipped — KRYTHOR_NON_INTERACTIVE=1 is set.'));
      console.log(fmt.dim('  Configure providers via: krythor setup  or the Control UI.'));
      closeRL();
      return;
    }

    this.printBanner();

    // ── Section-only reconfiguration ────────────────────────────────────────
    // krythor setup --section provider|gateway|channels|web-search
    if (this.opts.section) {
      await this.runSection(this.opts.section);
      closeRL();
      return;
    }

    // 1. Probe the system
    console.log(fmt.info('Scanning system…'));
    const sys = await probe();
    this.printProbe(sys);

    if (!sys.nodeVersionOk) {
      console.log(fmt.err(`Node ${sys.nodeVersion} detected. Krythor requires Node 20+. Aborting.`));
      console.log(fmt.dim('  Download Node.js 20 LTS at: https://nodejs.org'));
      process.exit(1);
    }

    // 2. Existing config?
    const installer = new Installer(sys.configDir);
    if (sys.hasExistingConfig) {
      console.log(fmt.warn('Existing configuration detected.'));
      // --reset flag skips the prompt and forces reconfiguration
      const reset = this.opts.reset ? true : await confirm('  Overwrite and reconfigure?', false);
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

    // 3b. Install workspace templates on first setup (not update)
    // Templates are copied to <dataDir>/templates/ — users can edit them freely.
    // Never overwrites existing files so user edits survive re-runs.
    const installedTemplates = installer.installTemplates(sys.dataDir);
    if (installedTemplates.length > 0) {
      console.log(fmt.ok(`Workspace templates installed to: ${sys.dataDir}/templates/`));
      for (const f of installedTemplates) {
        console.log(fmt.dim(`    ${f}`));
      }
    }

    // 4. Create default agent
    installer.writeDefaultAgent();
    console.log(fmt.ok('Default "Krythor" agent created.'));

    // 4b. QuickStart vs Advanced mode
    console.log(fmt.head('Setup Mode'));
    console.log(fmt.dim('  QuickStart — configure a provider and start immediately (recommended)'));
    console.log(fmt.dim('  Advanced   — full control: gateway port, auth, channels, web search'));
    console.log('');
    const setupMode = await choose(
      'Choose setup mode',
      ['QuickStart (recommended)', 'Advanced (full control)'],
      0,
    );
    const isAdvanced = setupMode.startsWith('Advanced');
    console.log('');

    // 5. Provider setup
    console.log(fmt.head('Provider Setup'));
    console.log(fmt.dim('  Recommended choices for most users:'));
    for (const [id, rec] of Object.entries(PROVIDER_RECOMMENDATIONS)) {
      if (rec.recommended_for_onboarding && rec.recommendation_label) {
        console.log(fmt.dim(`    ${id.padEnd(14)} — ${rec.recommendation_label}: ${rec.recommendation_reason}`));
      }
    }
    console.log('');

    // Build provider list — show detected local providers prominently
    // Local servers always appear in the list; their labels include "(detected)" when running
    const ollamaLabel   = sys.ollamaDetected     ? 'ollama (detected — running)'     : 'ollama';
    const lmStudioLabel = sys.lmStudioDetected   ? 'lmstudio (detected — running)'   : sys.hasExistingConfig ? 'lmstudio' : undefined;
    const llamaLabel    = sys.llamaServerDetected ? 'llamaserver (detected — running)' : sys.hasExistingConfig ? 'llamaserver' : undefined;

    // Core provider list (always shown)
    const coreProviders = [
      'anthropic', 'openai', 'openrouter', 'groq',
      'kimi', 'minimax', 'venice', 'z.ai',
      ollamaLabel,
    ];
    // Local servers: always shown if detected; shown only for experienced users otherwise
    if (lmStudioLabel) coreProviders.push(lmStudioLabel);
    if (llamaLabel)    coreProviders.push(llamaLabel);
    coreProviders.push('openai-compat', 'skip');

    // Map display labels back to canonical IDs
    const labelToType: Record<string, string> = {
      [ollamaLabel]: 'ollama',
    };
    if (lmStudioLabel) labelToType[lmStudioLabel] = 'lmstudio';
    if (llamaLabel)    labelToType[llamaLabel]     = 'llamaserver';

    // Determine smart default
    let defaultProviderIdx = 0; // anthropic
    if (sys.ollamaDetected)     defaultProviderIdx = coreProviders.indexOf(ollamaLabel);
    else if (sys.lmStudioDetected && lmStudioLabel) defaultProviderIdx = coreProviders.indexOf(lmStudioLabel);
    else if (sys.llamaServerDetected && llamaLabel) defaultProviderIdx = coreProviders.indexOf(llamaLabel);

    const providerLabel = await choose(
      'Which AI provider would you like to configure?',
      coreProviders,
      defaultProviderIdx,
    );
    const providerType = labelToType[providerLabel] ?? providerLabel;

    let firstModel: string | undefined;
    if (providerType !== 'skip') {
      const rec = PROVIDER_RECOMMENDATIONS[providerType];
      if (rec?.recommendation_label) {
        console.log(fmt.dim(`  ${rec.recommendation_label}: ${rec.recommendation_reason}`));
      }
      firstModel = await this.configureProvider(installer, providerType, sys);

      // Tool security note — shown when provider is cloud-based
      // Stronger models resist prompt injection better; surface this during onboarding.
      const isCloudProvider = !['ollama', 'lmstudio', 'llamaserver'].includes(providerType);
      if (isCloudProvider && firstModel) {
        console.log('');
        console.log(fmt.dim('  Security note: if your agent will run tools (exec, web_fetch, webhooks),'));
        console.log(fmt.dim('  use the most capable model available. Weaker models are more susceptible'));
        console.log(fmt.dim('  to prompt injection via tool output. You can change the model later in'));
        console.log(fmt.dim('  the Models tab or per-agent in the Agents tab.'));
      }
    } else {
      console.log(fmt.dim('  Skipped. You can add providers via the Models tab in the Control UI.'));
    }

    // 6. Gateway configuration (port, bind, auth)
    // In QuickStart mode: use defaults (127.0.0.1:47200, token auth) — no prompts.
    if (isAdvanced) {
      await this.configureGateway(installer);
    } else {
      installer.ensureGatewayDefaults();
      console.log(fmt.ok('Gateway: 127.0.0.1:47200 (token auth, loopback only)'));
    }

    // 7. Chat channels (Telegram, Discord, Slack)
    // In QuickStart mode: skip channel setup — can be done later via Control UI.
    if (isAdvanced) {
      await this.configureChannels(installer);
    } else {
      console.log(fmt.dim('  Channels: skipped — configure via Chat Channels tab in the Control UI.'));
    }

    // 8. Web search (optional)
    // In QuickStart mode: skip — DuckDuckGo is the default and needs no config.
    if (isAdvanced) {
      await this.configureWebSearch(installer);
    }

    // 9. Write app config with defaults
    installer.writeAppConfig({
      selectedAgentId: 'krythor-default',
      selectedModel: firstModel,
      onboardingComplete: providerType !== 'skip',
    });

    // 7. Done — print setup summary
    // Only print "Setup Complete" if a provider was actually configured.
    // If the user skipped, print an honest partial-success message with a clear CTA.
    const providerConfigured = providerType !== 'skip' && firstModel !== undefined;
    if (providerConfigured) {
      console.log(fmt.head('Setup Complete'));
      console.log(fmt.ok('Configuration saved to:  ' + sys.configDir));
      console.log(fmt.ok('Data directory:          ' + sys.dataDir));
    } else {
      console.log(fmt.head('Setup Incomplete'));
      console.log(fmt.warn('No AI provider was configured.'));
      console.log(fmt.dim('  Krythor will start but cannot run any AI tasks until you add a provider.'));
      console.log(fmt.dim('  To add a provider:'));
      console.log(fmt.dim('    1. Open the Control UI at http://127.0.0.1:47200'));
      console.log(fmt.dim('    2. Go to the Models tab'));
      console.log(fmt.dim('    3. Click "Add Provider" and paste your API key'));
      console.log(fmt.dim('  Or run setup again:  pnpm setup'));
      console.log(fmt.dim(`  Config saved to: ${sys.configDir}`));
    }
    console.log('');

    // ── What you can do now ────────────────────────────────────────────────
    console.log(fmt.head('What You Can Do Now'));
    console.log('');
    console.log(fmt.dim('  Available commands:'));
    console.log(fmt.ok ('    krythor              — start the gateway and open the Control UI'));
    console.log(fmt.ok ('    krythor start --daemon — start gateway in the background'));
    console.log(fmt.ok ('    krythor stop          — stop the background daemon'));
    console.log(fmt.ok ('    krythor restart       — restart the background daemon'));
    console.log(fmt.ok ('    krythor status        — quick health check of the running gateway'));
    console.log(fmt.ok ('    krythor tui           — terminal dashboard (polls gateway every 5s)'));
    console.log(fmt.ok ('    krythor doctor        — full diagnostics report'));
    console.log(fmt.ok ('    krythor repair        — check runtime components and credentials'));
    console.log(fmt.ok ('    krythor backup        — create a timestamped backup of your data'));
    console.log(fmt.ok ('    krythor setup         — re-run this setup wizard'));
    console.log(fmt.ok ('    krythor update        — update to the latest release'));
    console.log(fmt.ok ('    krythor uninstall     — remove the Krythor installation'));
    console.log(fmt.ok ('    krythor help          — print all commands with descriptions'));
    console.log('');
    console.log(fmt.dim('  Key API endpoints (after gateway starts at http://127.0.0.1:47200):'));
    console.log(fmt.dim('    GET  /health              — status, versions, provider/model count'));
    console.log(fmt.dim('    GET  /ready               — readiness check (200 = ready, 503 = not)'));
    console.log(fmt.dim('    POST /api/command         — send a command to the default agent'));
    console.log(fmt.dim('    GET  /api/models          — list all configured models'));
    console.log(fmt.dim('    GET  /api/agents          — list all defined agents'));
    console.log(fmt.dim('    GET  /api/memory          — search agent memory'));
    console.log(fmt.dim('    GET  /api/tools           — list available tools (exec, web_search, web_fetch)'));
    console.log(fmt.dim('    GET  /api/stats           — token usage for this session'));
    console.log('');
    console.log(fmt.dim('  Where to find things:'));
    console.log(fmt.dim(`    Config:     ${sys.configDir}`));
    console.log(fmt.dim(`    Data:       ${sys.dataDir}`));
    console.log(fmt.dim(`    Templates:  ${sys.dataDir}/templates/`));
    console.log(fmt.dim('    Docs:       docs/GETTING_STARTED.md, docs/CONFIG_REFERENCE.md'));
    console.log('');
    console.log(fmt.dim('  What happens next:'));
    console.log(fmt.dim('    1. Krythor Gateway starts (or start manually with: krythor)'));
    console.log(fmt.dim('    2. Your browser opens the Control UI at http://127.0.0.1:47200'));
    console.log(fmt.dim('    3. Type a command in the input box to run your first agent'));
    console.log('');

    // Recommendation-aware summary (only when a provider was actually configured)
    if (providerConfigured) {
      const rec = PROVIDER_RECOMMENDATIONS[providerType];
      console.log(fmt.dim('  Configuration summary:'));
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
    if (sys.lmStudioDetected) {
      const modelHint = sys.lmStudioModels.length > 0
        ? ` — ${sys.lmStudioModels.length} model(s) loaded`
        : '';
      console.log(fmt.ok(`LM Studio detected at ${sys.lmStudioBaseUrl}${modelHint}`));
    }
    if (sys.llamaServerDetected) {
      console.log(fmt.ok(`llama-server detected at ${sys.llamaServerBaseUrl}`));
    }
    if (sys.hasExistingConfig) {
      console.log(fmt.warn('Existing config found at ' + sys.configDir));
    }
    console.log('');
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

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

      const OLLAMA_POPULAR = [
        'llama3.2',       // recommended — Meta Llama 3.2
        'llama3.3',       // Meta Llama 3.3 70B
        'mistral',        // Mistral 7B
        'gemma3',         // Google Gemma 3
        'qwen2.5',        // Alibaba Qwen 2.5
        'phi4',           // Microsoft Phi-4
        'deepseek-r1',    // DeepSeek R1 reasoning
        'codellama',      // code-focused
        'llava',          // vision / multimodal
      ];

      let liveModels: string[] = [];
      try {
        const res = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const data = await res.json() as { models?: Array<{ name: string }> };
          liveModels = (data.models ?? []).map(m => m.name);
        }
      } catch { /* offline — fine */ }

      if (liveModels.length > 0) {
        console.log(fmt.ok(`Found ${liveModels.length} installed model(s).`));
        models = [await pickModel(liveModels, liveModels[0]!)];
      } else {
        console.log(fmt.dim('  Ollama is offline or has no models installed yet.'));
        console.log(fmt.dim('  Choose a popular model to pre-configure (install it later with: ollama pull <model>)'));
        models = [await pickModel(OLLAMA_POPULAR, 'llama3.2')];
      }

    } else if (isDualAuth) {
      // ── Dual-auth providers (Anthropic, OpenAI) ───────────────────────────
      // Both API key (enter now) and OAuth (connect later in the app) are supported.
      const providerInfo: Record<string, { endpoint: string; keyUrl: string; defaultModel: string; models: string[] }> = {
        anthropic: {
          endpoint:     'https://api.anthropic.com',
          keyUrl:       'https://console.anthropic.com/settings/keys',
          defaultModel: 'claude-sonnet-4-6',
          models: [
            'claude-sonnet-4-6',          // recommended — latest Sonnet
            'claude-opus-4-6',            // most capable
            'claude-haiku-4-5',           // fastest / cheapest
            'claude-sonnet-4-5',          // Sonnet 4.5 (stable)
            'claude-opus-4-5',            // Opus 4.5
            'claude-sonnet-4-20250514',   // Sonnet 4 (pinned)
            'claude-3-7-sonnet-20250219', // Claude 3.7 — strong reasoning
            'claude-3-5-sonnet-20241022', // Claude 3.5 Sonnet
            'claude-3-5-haiku-20241022',  // Claude 3.5 Haiku
            'claude-3-opus-20240229',     // Claude 3 Opus (legacy)
            'claude-3-haiku-20240307',    // Claude 3 Haiku (legacy)
          ],
        },
        openai: {
          endpoint:     'https://api.openai.com/v1',
          keyUrl:       'https://platform.openai.com/api-keys',
          defaultModel: 'gpt-4.1-mini',
          models: [
            'gpt-4.1-mini',     // recommended — fast + affordable
            'gpt-4.1',          // latest flagship
            'gpt-4.1-nano',     // smallest / cheapest
            'gpt-4o',           // multimodal flagship
            'gpt-4o-mini',      // popular cheap omni
            'o4-mini',          // compact reasoning
            'o3',               // full reasoning
            'o3-mini',          // fast reasoning
            'o1',               // original reasoning model
            'o1-mini',          // fast reasoning (legacy)
            'o1-preview',       // o1 preview
            'gpt-4-turbo',      // GPT-4 Turbo
            'gpt-4',            // GPT-4 (classic)
            'gpt-3.5-turbo',    // fast + cheap (legacy)
          ],
        },
      };
      const info = providerInfo[type]!;
      endpoint = info.endpoint;

      console.log(fmt.dim('  Choose how to authenticate with this provider:'));
      console.log(fmt.dim(''));
      console.log(fmt.dim('    [1] API key — paste a key from the provider dashboard (simplest)'));
      console.log(fmt.dim('    [2] OAuth   — browser login with client ID + secret (more secure)'));
      console.log(fmt.dim('    [3] Skip    — add this provider manually later via the Models tab'));
      console.log(fmt.dim(''));

      const authChoice = await choose(
        '  How would you like to connect?',
        ['API key', 'OAuth (browser login)', 'Skip'],
        0,
      );

      if (authChoice === 'API key') {
        authMethod = 'api_key';
        console.log(fmt.dim(`  Get your API key at: ${info.keyUrl}`));
        apiKey = await ask('  API Key: ');
        models = [await pickModel(info.models, info.defaultModel)];
        console.log(fmt.ok(`Provider "${name}" configured with API key.`));

      } else if (authChoice === 'OAuth (browser login)') {
        // Real OAuth — user supplies their client ID and optionally client secret.
        // The gateway's /api/oauth/start endpoint handles the loopback flow after
        // the provider is saved and the gateway is running.
        authMethod = 'oauth';
        setupHint = 'oauth_pending';
        models = [await pickModel(info.models, info.defaultModel)];

        console.log(fmt.dim(''));
        console.log(fmt.dim('  To use OAuth you need a client ID from the provider.'));
        console.log(fmt.dim(`  Register an OAuth app at: ${info.keyUrl}`));
        console.log(fmt.dim('  Set the redirect URI to:  http://127.0.0.1:<port>/oauth/callback'));
        console.log(fmt.dim('  (the exact port is assigned when the flow starts — use a wildcard if available)'));
        console.log(fmt.dim(''));

        const clientId = await ask('  OAuth Client ID (leave blank to set later): ');
        const clientSecret = await ask('  OAuth Client Secret (optional, leave blank for PKCE-only): ');

        if (clientId.trim()) {
          // Store client credentials in setupHints so the UI can start the flow
          setupHint = JSON.stringify({
            type: 'oauth_pending',
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim() || undefined,
          });
        }

        console.log(fmt.ok(`Provider "${name}" added with OAuth auth method.`));
        console.log(fmt.dim('  Start Krythor, then go to Models tab → click "Connect with OAuth" to complete login.'));

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
      models = [await pickModel([
        'kimi-k2.5',                     // latest flagship
        'kimi-k2',                       // agentic / coding
        'kimi-latest',                   // always latest Kimi
        'moonshot-v1-128k',              // long context
        'moonshot-v1-32k',               // recommended classic
        'moonshot-v1-8k',                // short context / cheap
        'moonshot-v1-32k-vision-preview',
        'moonshot-v1-128k-vision-preview',
      ], 'kimi-k2.5')];

    } else if (type === 'minimax') {
      endpoint = 'https://api.minimax.chat/v1';
      name = 'MiniMax';
      authMethod = 'api_key';
      console.log(fmt.dim('  Get your API key at: https://www.minimax.chat/user-center/basic-information/interface-key'));
      apiKey = await ask('  API Key: ');
      models = [await pickModel([
        'MiniMax-Text-01',        // recommended — 456B, 1M context
        'MiniMax-M2.5',           // latest reasoning
        'MiniMax-M2.5-highspeed', // fast streaming
        'MiniMax-M2',             // reasoning
        'MiniMax-VL-01',          // vision-language
        'abab6.5s-chat',          // legacy fast
        'abab6.5g-chat',          // legacy general
        'abab6.5-chat',           // legacy
        'abab5.5-chat',           // legacy
      ], 'MiniMax-Text-01')];

    } else if (type === 'openrouter') {
      // ── OpenRouter — unified gateway for 200+ models ──────────────────────
      endpoint = 'https://openrouter.ai/api/v1';
      name = 'OpenRouter';
      authMethod = 'api_key';
      console.log(fmt.dim('  OpenRouter gives you access to 200+ models with a single API key.'));
      console.log(fmt.dim('  Get your API key at: https://openrouter.ai/keys'));
      apiKey = await ask('  API Key: ');

      // Try to fetch the live model list from OpenRouter (no auth needed)
      let liveModels: string[] = [];
      process.stdout.write(fmt.dim('  Fetching model list from OpenRouter… '));
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json() as { data?: Array<{ id: string; name?: string }> };
          liveModels = (data.data ?? [])
            .map(m => m.id)
            .filter(id => typeof id === 'string' && id.length > 0)
            .slice(0, 50); // Limit to top 50 for display
          console.log(`${liveModels.length} models available.`);
        } else {
          console.log('unavailable — using curated list.');
        }
      } catch {
        console.log('offline — using curated list.');
      }

      const curatedModels = [
        'anthropic/claude-sonnet-4-6',          // recommended
        'anthropic/claude-opus-4-6',
        'anthropic/claude-haiku-4-5',
        'anthropic/claude-3-5-sonnet-20241022',
        'openai/gpt-4.1',
        'openai/gpt-4.1-mini',
        'openai/gpt-4o',
        'openai/o3',
        'openai/o4-mini',
        'google/gemini-2.5-pro',
        'google/gemini-2.5-flash',
        'google/gemini-2.0-flash',
        'meta-llama/llama-3.3-70b-instruct',
        'meta-llama/llama-3.1-405b-instruct',
        'deepseek/deepseek-r1',
        'deepseek/deepseek-chat',
        'mistralai/mistral-large',
        'mistralai/mistral-small',
        'qwen/qwen-2.5-72b-instruct',
        'qwen/qwen3-235b-a22b',
        'x-ai/grok-3',
        'x-ai/grok-3-mini',
        'cohere/command-r-plus',
      ];
      const modelChoices = liveModels.length > 0 ? liveModels : curatedModels;
      models = [await pickModel(modelChoices, modelChoices[0]!)];

    } else if (type === 'groq') {
      // ── Groq — fast inference, OpenAI-compatible ──────────────────────────
      endpoint = 'https://api.groq.com/openai/v1';
      name = 'Groq';
      authMethod = 'api_key';
      console.log(fmt.dim('  Groq delivers extremely fast inference on open-weight models.'));
      console.log(fmt.dim('  Get your API key at: https://console.groq.com/keys'));
      apiKey = await ask('  API Key: ');
      models = [await pickModel([
        'llama-3.3-70b-versatile',        // recommended — fast + capable
        'llama-3.1-8b-instant',           // fastest / cheapest
        'llama-3.3-70b-specdec',          // speculative decoding
        'llama-3.1-70b-versatile',        // Llama 3.1 70B
        'llama3-70b-8192',                // Llama 3 70B
        'llama3-8b-8192',                 // Llama 3 8B
        'mixtral-8x7b-32768',             // Mixtral — long context
        'gemma2-9b-it',                   // Google Gemma 2 9B
        'gemma-7b-it',                    // Google Gemma 7B
        'qwen-qwq-32b',                   // Qwen QwQ reasoning
        'deepseek-r1-distill-llama-70b',  // DeepSeek R1 distill 70B
        'deepseek-r1-distill-qwen-32b',   // DeepSeek R1 distill 32B
        'compound-beta',                  // Groq compound (beta)
        'compound-beta-mini',             // Groq compound mini
      ], 'llama-3.3-70b-versatile')];

    } else if (type === 'venice') {
      // ── Venice — privacy-focused inference ────────────────────────────────
      endpoint = 'https://api.venice.ai/api/v1';
      name = 'Venice';
      authMethod = 'api_key';
      console.log(fmt.dim('  Venice is privacy-focused — prompts are not logged or used for training.'));
      console.log(fmt.dim('  Get your API key at: https://venice.ai/settings/api'));
      apiKey = await ask('  API Key: ');
      models = [await pickModel([
        'venice-uncensored',           // recommended — Venice flagship
        'llama-3.3-70b',              // Meta Llama 3.3 70B
        'llama-3.1-405b',             // Meta Llama 3.1 405B
        'llama-3.2-3b',               // small / fast
        'mistral-31-24b',             // Mistral 3.1 24B
        'mistral-nemo',               // Mistral NeMo
        'qwen-2.5-72b',               // Qwen 2.5 72B
        'qwen-2.5-coder-32b',         // Qwen Coder
        'deepseek-r1-671b',           // DeepSeek R1 671B reasoning
        'deepseek-r1-distill-llama-70b', // DeepSeek R1 distill
        'deepseek-v3',                // DeepSeek V3
        'phi-4',                      // Microsoft Phi-4
      ], 'venice-uncensored')];

    } else if (type === 'z.ai') {
      // ── Z.AI — Google Gemini and other models ────────────────────────────
      endpoint = 'https://api.z.ai/api/v1';
      name = 'Z.AI';
      authMethod = 'api_key';
      console.log(fmt.dim('  Z.AI provides access to Gemini and other Google AI models via OpenAI-compatible API.'));
      console.log(fmt.dim('  Get your API key at: https://z.ai/api-access'));
      apiKey = await ask('  API Key: ');
      models = [await pickModel([
        'gemini-2.5-pro',                  // recommended — most capable
        'gemini-2.5-flash',                // fast + affordable
        'gemini-2.5-flash-lite',           // lightest flash
        'gemini-2.0-flash',                // previous flash
        'gemini-2.0-flash-lite',           // previous flash lite
        'gemini-2.0-pro-exp',              // Gemini 2.0 Pro exp
        'gemini-1.5-pro',                  // Gemini 1.5 Pro
        'gemini-1.5-flash',                // Gemini 1.5 Flash
        'gemini-1.5-flash-8b',             // Gemini 1.5 Flash 8B
      ], 'gemini-2.5-pro')];

    } else if (type === 'lmstudio') {
      // ── LM Studio — local GGUF models via OpenAI-compatible API ──────────
      const url = await ask(`  Base URL [${sys.lmStudioBaseUrl}]: `);
      endpoint = url || sys.lmStudioBaseUrl;
      name = 'LM Studio';
      authMethod = 'none';

      // Use models already fetched during probe (if server was running at probe time)
      let liveModels: string[] = sys.lmStudioModels ?? [];

      // Re-fetch if user changed the URL or if we don't have models yet
      if (liveModels.length === 0 || url) {
        try {
          const res = await fetch(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            const data = await res.json() as { data?: Array<{ id: string }> };
            liveModels = (data.data ?? []).map(m => m.id);
          }
        } catch { /* LM Studio not running — OK */ }
      }

      if (liveModels.length > 0) {
        console.log(fmt.ok(`Found ${liveModels.length} loaded model(s) in LM Studio.`));
        models = [await pickModel(liveModels, liveModels[0]!)];
      } else {
        console.log(fmt.dim('  LM Studio is not running or has no model loaded.'));
        console.log(fmt.dim('  Load a model in LM Studio first, then enter its name below.'));
        const modelInput = await ask('  Model name (or leave blank): ');
        models = modelInput ? [modelInput] : [];
      }

    } else if (type === 'llamaserver') {
      // ── llama-server (llama.cpp) — high-performance local GGUF inference ─
      const url = await ask(`  Base URL [${sys.llamaServerBaseUrl}]: `);
      endpoint = url || sys.llamaServerBaseUrl;
      name = 'llama-server';
      authMethod = 'none';

      // llama-server's OpenAI-compat endpoint reports a single loaded model
      let liveModels: string[] = [];
      try {
        const res = await fetch(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const data = await res.json() as { data?: Array<{ id: string }> };
          liveModels = (data.data ?? []).map(m => m.id);
        }
      } catch { /* not running — fine */ }

      if (liveModels.length > 0) {
        console.log(fmt.ok(`Found loaded model: ${liveModels[0]}`));
        models = [await pickModel(liveModels, liveModels[0]!)];
      } else {
        console.log(fmt.dim('  llama-server is not running or model name could not be fetched.'));
        console.log(fmt.dim('  Enter the model filename or ID (e.g., my-model.gguf):'));
        const modelInput = await ask('  Model name (or leave blank): ');
        models = modelInput ? [modelInput] : [];
      }

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

    // Map wizard-specific types to internal provider types
    // kimi, minimax, openrouter, groq, venice, z.ai, lmstudio, llamaserver all use openai-compat internally
    const openAiCompatTypes = ['kimi', 'minimax', 'openrouter', 'groq', 'venice', 'z.ai', 'lmstudio', 'llamaserver'];
    const providerType = openAiCompatTypes.includes(type) ? 'openai-compat' : type;

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

  // ── Gateway configuration ───────────────────────────────────────────────────

  private async configureGateway(installer: Installer): Promise<void> {
    console.log(fmt.head('Gateway Configuration'));
    console.log(fmt.dim('  The gateway is the local HTTP server Krythor runs on your machine.'));
    console.log('');

    const existing = installer.readGatewayConfig();
    const currentPort = existing.port ?? 47200;
    const currentBind = existing.bind ?? '127.0.0.1';

    // Port
    const portInput = await ask(`  Port [${currentPort}]: `);
    const port = portInput ? parseInt(portInput, 10) : currentPort;
    if (isNaN(port) || port < 1024 || port > 65535) {
      console.log(fmt.warn('  Invalid port — keeping current value.'));
    }
    const resolvedPort = (!isNaN(port) && port >= 1024 && port <= 65535) ? port : currentPort;

    // Bind address
    console.log(fmt.dim('  Bind address controls who can reach the gateway:'));
    console.log(fmt.dim('    127.0.0.1 — loopback only (default, most secure)'));
    console.log(fmt.dim('    0.0.0.0   — all interfaces (LAN/remote access)'));
    const bindChoice = await choose(
      '  Bind address',
      ['127.0.0.1 (loopback — default)', '0.0.0.0 (all interfaces)'],
      currentBind === '0.0.0.0' ? 1 : 0,
    );
    const bind = bindChoice.startsWith('0.0.0.0') ? '0.0.0.0' : '127.0.0.1';

    // Auth mode
    console.log('');
    console.log(fmt.dim('  Auth mode controls how the Control UI authenticates:'));
    console.log(fmt.dim('    token — bearer token (recommended, auto-generated)'));
    console.log(fmt.dim('    none  — no auth (only safe on loopback)'));
    const authChoice = await choose(
      '  Auth mode',
      ['token (recommended)', 'none'],
      existing.auth?.mode === 'none' ? 1 : 0,
    );
    const authMode = authChoice.startsWith('none') ? 'none' as const : 'token' as const;

    let token: string | undefined;
    if (authMode === 'token') {
      const existingToken = existing.auth?.token;
      if (existingToken) {
        const keepToken = await confirm('  Existing auth token found — keep it?', true);
        token = keepToken ? existingToken : randomBytes(32).toString('hex');
      } else {
        token = randomBytes(32).toString('hex');
      }
      console.log(fmt.ok('  Auth token generated (stored in gateway.json).'));
    }

    installer.writeGatewayConfig({
      port: resolvedPort,
      bind,
      auth: { mode: authMode, token },
    });

    if (bind === '0.0.0.0') {
      console.log(fmt.warn('  Gateway will accept connections from all network interfaces.'));
      console.log(fmt.dim('  Make sure your firewall restricts port access appropriately.'));
    }
    console.log(fmt.ok(`Gateway configured: ${bind}:${resolvedPort} (auth: ${authMode})`));
    console.log('');
  }

  // ── Chat channel configuration ──────────────────────────────────────────────

  private async configureChannels(installer: Installer): Promise<void> {
    console.log(fmt.head('Chat Channels (optional)'));
    console.log(fmt.dim('  Connect Krythor to messaging platforms so you can chat via Telegram, Discord, or Slack.'));
    console.log(fmt.dim('  All channels are optional — skip any you do not need.'));
    console.log(fmt.dim('  You can configure channels later via the Channels tab in the Control UI.'));
    console.log('');

    const setupAny = await confirm('  Set up any chat channels now?', false);
    if (!setupAny) {
      console.log(fmt.dim('  Skipped. Add channels later via the Control UI.'));
      console.log('');
      return;
    }

    const channelChoices = await choose(
      '  Which channel would you like to configure first?',
      ['Telegram', 'Discord', 'Slack', 'Skip channels'],
      0,
    );

    if (channelChoices === 'Skip channels') {
      console.log(fmt.dim('  Skipped.'));
      console.log('');
      return;
    }

    if (channelChoices === 'Telegram') {
      await this.configureTelegram(installer);
    } else if (channelChoices === 'Discord') {
      await this.configureDiscord(installer);
    } else if (channelChoices === 'Slack') {
      await this.configureSlack(installer);
    }

    // Offer to configure additional channels
    const addAnother = await confirm('  Configure another channel?', false);
    if (addAnother) {
      const remaining = ['Telegram', 'Discord', 'Slack'].filter(c => c !== channelChoices);
      const next = await choose('  Which channel?', [...remaining, 'Skip'], 0);
      if (next === 'Telegram') await this.configureTelegram(installer);
      else if (next === 'Discord') await this.configureDiscord(installer);
      else if (next === 'Slack') await this.configureSlack(installer);
    }

    console.log('');
  }

  private async configureTelegram(installer: Installer): Promise<void> {
    console.log('');
    console.log(fmt.dim('  ── Telegram ──'));
    console.log(fmt.dim('  1. Open Telegram and find @BotFather'));
    console.log(fmt.dim('  2. Send /newbot and follow the prompts'));
    console.log(fmt.dim('  3. Copy the bot token (looks like: 123456789:ABCdef...)'));
    console.log('');

    const botToken = await ask('  Bot token: ');
    if (!botToken.trim()) {
      console.log(fmt.warn('  No token entered — Telegram channel not configured.'));
      return;
    }
    installer.writeChannelsConfig({
      telegram: { enabled: true, botToken: botToken.trim() },
    });
    console.log(fmt.ok('  Telegram channel configured.'));
    console.log(fmt.dim('  After the gateway starts: send a message to your bot to receive a pairing code,'));
    console.log(fmt.dim('  then approve it from the Channels tab in the Control UI.'));
  }

  private async configureDiscord(installer: Installer): Promise<void> {
    console.log('');
    console.log(fmt.dim('  ── Discord ──'));
    console.log(fmt.dim('  1. Go to https://discord.com/developers/applications'));
    console.log(fmt.dim('  2. Create a New Application → go to the Bot section'));
    console.log(fmt.dim('  3. Reset Token to generate a bot token (save it securely)'));
    console.log(fmt.dim('  4. Enable: Message Content Intent and Server Members Intent'));
    console.log(fmt.dim('  5. Under OAuth2, generate an invite URL with bot + applications.commands scopes'));
    console.log(fmt.dim('  6. Invite the bot to your server'));
    console.log('');

    const botToken = await ask('  Bot token: ');
    if (!botToken.trim()) {
      console.log(fmt.warn('  No token entered — Discord channel not configured.'));
      return;
    }

    const guildId = await ask('  Server (Guild) ID (right-click server → Copy ID): ');

    installer.writeChannelsConfig({
      discord: {
        enabled: true,
        botToken: botToken.trim(),
        guildId: guildId.trim() || undefined,
      },
    });
    console.log(fmt.ok('  Discord channel configured.'));
    console.log(fmt.dim('  DM the bot after the gateway starts to receive a pairing code.'));
  }

  private async configureSlack(installer: Installer): Promise<void> {
    console.log('');
    console.log(fmt.dim('  ── Slack ──'));
    console.log(fmt.dim('  1. Go to https://api.slack.com/apps and create a new app'));
    console.log(fmt.dim('  2. Enable Socket Mode and generate an App Token (xapp-...) with connections:write'));
    console.log(fmt.dim('  3. Install the app to your workspace'));
    console.log(fmt.dim('  4. Copy the Bot Token (xoxb-...) from OAuth & Permissions'));
    console.log('');

    const botToken = await ask('  Bot token (xoxb-...): ');
    if (!botToken.trim()) {
      console.log(fmt.warn('  No token entered — Slack channel not configured.'));
      return;
    }

    const appToken = await ask('  App token (xapp-...): ');
    if (!appToken.trim()) {
      console.log(fmt.warn('  No app token entered — Slack channel not configured.'));
      return;
    }

    installer.writeChannelsConfig({
      slack: {
        enabled: true,
        botToken: botToken.trim(),
        appToken: appToken.trim(),
      },
    });
    console.log(fmt.ok('  Slack channel configured.'));
    console.log(fmt.dim('  Message your bot in Slack after the gateway starts to receive a pairing code.'));
  }

  // ── Web search configuration ────────────────────────────────────────────────

  private async configureWebSearch(installer: Installer): Promise<void> {
    console.log(fmt.head('Web Search (optional)'));
    console.log(fmt.dim('  Krythor agents can search the web using DuckDuckGo (no key required) by default.'));
    console.log(fmt.dim('  Optionally configure a premium search provider for richer results.'));
    console.log('');

    const enablePremium = await confirm('  Configure a premium web search provider?', false);
    if (!enablePremium) {
      console.log(fmt.dim('  Using built-in DuckDuckGo search (no API key needed).'));
      console.log('');
      return;
    }

    const providers = [
      { label: 'Brave Search',      id: 'brave',       url: 'https://api.search.brave.com/app/keys' },
      { label: 'Perplexity',        id: 'perplexity',  url: 'https://docs.perplexity.ai/docs/getting-started' },
      { label: 'Google (Gemini)',   id: 'gemini',      url: 'https://ai.google.dev/gemini-api/docs' },
      { label: 'Kimi (Moonshot)',   id: 'kimi',        url: 'https://platform.moonshot.cn/console/api-keys' },
    ];

    const choice = await choose(
      '  Search provider',
      [...providers.map(p => p.label), 'Skip'],
      0,
    );

    const selected = providers.find(p => p.label === choice);
    if (!selected) {
      console.log(fmt.dim('  Skipped.'));
      console.log('');
      return;
    }

    console.log(fmt.dim(`  Get your API key at: ${selected.url}`));
    const apiKey = await ask(`  ${selected.label} API key: `);
    if (!apiKey.trim()) {
      console.log(fmt.warn('  No key entered — falling back to DuckDuckGo.'));
      console.log('');
      return;
    }

    installer.writeWebSearchConfig({
      enabled: true,
      provider: selected.id,
      apiKey: apiKey.trim(),
    });
    console.log(fmt.ok(`  Web search configured: ${selected.label}`));
    console.log('');
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

  // ── Section-only reconfiguration ────────────────────────────────────────────
  // `krythor setup --section <name>` reconfigures only that section.

  private async runSection(section: SetupWizardOptions['section']): Promise<void> {
    console.log(fmt.info(`Scanning system…`));
    const sys = await probe();
    const installer = new Installer(sys.configDir);
    installer.ensureDirs(sys.dataDir);

    switch (section) {
      case 'provider': {
        console.log(fmt.head('Provider Setup'));
        const providerLabel = await choose(
          'Which AI provider would you like to configure?',
          ['anthropic', 'openai', 'openrouter', 'groq', 'kimi', 'minimax', 'venice', 'z.ai', 'ollama', 'openai-compat', 'skip'],
          0,
        );
        if (providerLabel !== 'skip') {
          await this.configureProvider(installer, providerLabel, sys);
        }
        console.log(fmt.ok('Provider configuration updated.'));
        break;
      }
      case 'gateway':
        await this.configureGateway(installer);
        console.log(fmt.ok('Gateway configuration updated.'));
        break;
      case 'channels':
        await this.configureChannels(installer);
        console.log(fmt.ok('Channel configuration updated.'));
        break;
      case 'web-search':
        await this.configureWebSearch(installer);
        console.log(fmt.ok('Web search configuration updated.'));
        break;
      default:
        console.log(fmt.err(`Unknown section: ${section}`));
        console.log(fmt.dim('  Valid sections: provider, gateway, channels, web-search'));
    }
  }
}
