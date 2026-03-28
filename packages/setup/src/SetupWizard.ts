import { join } from 'path';
import { existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { probe, type ProbeResult } from './SystemProbe.js';
import { Installer, type SecretRef, type SkillSeedEntry } from './Installer.js';
import { ask, confirm, choose, closeRL, fmt } from './Prompt.js';

// ─── Provider recommendation metadata ────────────────────────────────────────

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

// ─── Built-in skills offered during setup ────────────────────────────────────

const BUILTIN_SKILLS: SkillSeedEntry[] = [
  {
    name: 'Summarize',
    description: 'Condense long text into a concise summary.',
    systemPrompt: 'You are a summarization assistant. Provide a clear, concise summary of the input. Preserve key facts and omit filler.',
    tags: ['summarize', 'text'],
    permissions: ['memory:read'],
  },
  {
    name: 'Translate',
    description: 'Translate text between languages.',
    systemPrompt: 'You are a translation assistant. Translate the input text accurately. Preserve formatting and tone. State the target language if specified, otherwise infer it from context.',
    tags: ['translate', 'language'],
    permissions: [],
  },
  {
    name: 'Explain',
    description: 'Explain a concept, code snippet, or piece of text in plain language.',
    systemPrompt: 'You are an explanation assistant. Break down the input into clear, simple language. Use analogies where helpful. Adjust depth based on how technical the input is.',
    tags: ['explain', 'education'],
    permissions: ['memory:read'],
  },
];

// ─── Model picker ─────────────────────────────────────────────────────────────

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
  section?: 'provider' | 'gateway' | 'channels' | 'web-search' | 'workspace' | 'skills' | 'daemon';
  reset?: boolean;
  /** 'full' also clears the workspace dir pointer in app-config (does NOT delete files). */
  resetScope?: 'config' | 'full';
  /** 'ref' = non-interactive: store env-backed SecretRefs instead of inline API keys. */
  secretInputMode?: 'prompt' | 'ref';
}

export class SetupWizard {
  constructor(private readonly opts: SetupWizardOptions = {}) {}

  async run(): Promise<void> {
    if (process.env['KRYTHOR_NON_INTERACTIVE'] === '1') {
      console.log(fmt.warn('Setup wizard skipped — KRYTHOR_NON_INTERACTIVE=1 is set.'));
      console.log(fmt.dim('  Configure providers via: krythor setup  or the Control UI.'));
      closeRL();
      return;
    }

    this.printBanner();

    if (this.opts.section) {
      await this.runSection(this.opts.section);
      closeRL();
      return;
    }

    // 0. Remote mode check — before everything else
    const isRemote = await this.checkRemoteMode();
    if (isRemote) { closeRL(); return; }

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
      const reset = this.opts.reset ? true : await confirm('  Overwrite and reconfigure?', false);
      if (!reset) {
        console.log(fmt.info('Keeping existing configuration.'));
        if (!installer.hasDefaultAgent()) {
          installer.writeDefaultAgent();
          installer.writeAppConfig({ selectedAgentId: 'krythor-default' });
          console.log(fmt.ok('Default "Krythor" agent created.'));
        }
        await this.offerLaunchAndHealthCheck(sys);
        closeRL();
        return;
      }
      // --reset-scope full: clear workspace pointer (files are kept)
      if (this.opts.resetScope === 'full') {
        installer.writeAppConfig({ workspaceDir: undefined });
        console.log(fmt.dim('  Workspace path cleared — you will be asked to re-confirm it.'));
      }
    }

    // 3. Ensure directories
    installer.ensureDirs(sys.dataDir);

    // 4. Create default agent
    installer.writeDefaultAgent();
    console.log(fmt.ok('Default "Krythor" agent created.'));

    // 4b. QuickStart vs Advanced mode
    console.log(fmt.head('Setup Mode'));
    console.log(fmt.dim('  QuickStart — configure a provider and start immediately (recommended)'));
    console.log(fmt.dim('  Advanced   — full control: workspace, gateway, channels, skills, daemon'));
    console.log('');
    const setupMode = await choose(
      'Choose setup mode',
      ['QuickStart (recommended)', 'Advanced (full control)'],
      0,
    );
    const isAdvanced = setupMode.startsWith('Advanced');
    console.log('');

    // 5. Workspace (Advanced only — QuickStart uses default silently)
    if (isAdvanced) {
      await this.configureWorkspace(installer, sys);
    } else {
      installer.writeWorkspaceConfig(sys.defaultWorkspaceDir);
    }

    // 6. Provider setup
    console.log(fmt.head('Provider Setup'));
    console.log(fmt.dim('  Recommended choices for most users:'));
    for (const [id, rec] of Object.entries(PROVIDER_RECOMMENDATIONS)) {
      if (rec.recommended_for_onboarding && rec.recommendation_label) {
        console.log(fmt.dim(`    ${id.padEnd(14)} — ${rec.recommendation_label}: ${rec.recommendation_reason}`));
      }
    }
    console.log('');

    const ollamaLabel   = sys.ollamaDetected     ? 'ollama (detected — running)'      : 'ollama';
    const lmStudioLabel = sys.lmStudioDetected   ? 'lmstudio (detected — running)'    : sys.hasExistingConfig ? 'lmstudio' : undefined;
    const llamaLabel    = sys.llamaServerDetected ? 'llamaserver (detected — running)' : sys.hasExistingConfig ? 'llamaserver' : undefined;

    const coreProviders = [
      'anthropic', 'openai', 'openrouter', 'groq',
      'kimi', 'minimax', 'venice', 'z.ai',
      ollamaLabel,
    ];
    if (lmStudioLabel) coreProviders.push(lmStudioLabel);
    if (llamaLabel)    coreProviders.push(llamaLabel);
    coreProviders.push(
      'Custom (OpenAI-compatible)',
      'Custom (Anthropic-compatible)',
      'Custom (auto-detect)',
      'skip',
    );

    const labelToType: Record<string, string> = {
      [ollamaLabel]: 'ollama',
      'Custom (OpenAI-compatible)':   'openai-compat',
      'Custom (Anthropic-compatible)': 'anthropic-compat',
      'Custom (auto-detect)':          'openai-compat',
    };
    if (lmStudioLabel) labelToType[lmStudioLabel] = 'lmstudio';
    if (llamaLabel)    labelToType[llamaLabel]     = 'llamaserver';

    let defaultProviderIdx = 0;
    if (sys.ollamaDetected)                                defaultProviderIdx = coreProviders.indexOf(ollamaLabel);
    else if (sys.lmStudioDetected && lmStudioLabel)        defaultProviderIdx = coreProviders.indexOf(lmStudioLabel);
    else if (sys.llamaServerDetected && llamaLabel)        defaultProviderIdx = coreProviders.indexOf(llamaLabel);

    const providerLabel = await choose(
      'Which AI provider would you like to configure?',
      coreProviders,
      defaultProviderIdx,
    );
    const providerType = labelToType[providerLabel] ?? providerLabel;

    // Track token/ref for daemon step
    let gatewayTokenOrRef: string | SecretRef | undefined;

    let firstModel: string | undefined;
    if (providerType !== 'skip') {
      const rec = PROVIDER_RECOMMENDATIONS[providerType];
      if (rec?.recommendation_label) {
        console.log(fmt.dim(`  ${rec.recommendation_label}: ${rec.recommendation_reason}`));
      }
      firstModel = await this.configureProvider(installer, providerType, sys);

      const isCloudProvider = !['ollama', 'lmstudio', 'llamaserver'].includes(providerType);
      if (isCloudProvider && firstModel) {
        console.log('');
        console.log(fmt.dim('  Security note: if your agent will run tools (exec, web_fetch, webhooks),'));
        console.log(fmt.dim('  prefer the strongest latest-generation model available — weaker/older models'));
        console.log(fmt.dim('  are more susceptible to prompt injection via tool output. Keep tool policy'));
        console.log(fmt.dim('  strict. You can change the model later in the Models tab or per-agent.'));
      }
    } else {
      console.log(fmt.dim('  Skipped. You can add providers via the Models tab in the Control UI.'));
    }

    // 7. Gateway
    if (isAdvanced) {
      gatewayTokenOrRef = await this.configureGateway(installer, sys);
    } else {
      installer.ensureGatewayDefaults();
      console.log(fmt.ok('Gateway: 127.0.0.1:47200 (token auth, loopback only)'));
    }

    // 8. Chat channels
    if (isAdvanced) {
      await this.configureChannels(installer, sys);
    } else {
      console.log(fmt.dim('  Channels: skipped — configure via Chat Channels tab in the Control UI.'));
    }

    // 9. Web search
    if (isAdvanced) {
      await this.configureWebSearch(installer);
    }

    // 10. Skills (Advanced only)
    if (isAdvanced) {
      await this.configureSkills(installer);
    }

    // 11. Daemon (Advanced only)
    if (isAdvanced) {
      await this.configureDaemon(installer, sys, gatewayTokenOrRef);
    }

    // 12. Write app config
    installer.writeAppConfig({
      selectedAgentId: 'krythor-default',
      selectedModel: firstModel,
      onboardingComplete: providerType !== 'skip',
    });

    // 13. Summary
    const providerConfigured = providerType !== 'skip' && firstModel !== undefined;
    if (providerConfigured) {
      console.log(fmt.head('Setup Complete'));
      console.log(fmt.ok('Configuration saved to:  ' + sys.configDir));
      console.log(fmt.ok('Data directory:          ' + sys.dataDir));
    } else {
      console.log(fmt.head('Setup Incomplete'));
      console.log(fmt.warn('No AI provider was configured.'));
      console.log(fmt.dim('  Krythor will start but cannot run AI tasks until you add a provider.'));
      console.log(fmt.dim('  To add a provider:'));
      console.log(fmt.dim('    1. Open the Control UI at http://127.0.0.1:47200'));
      console.log(fmt.dim('    2. Go to the Models tab'));
      console.log(fmt.dim('    3. Click "Add Provider" and paste your API key'));
      console.log(fmt.dim('  Or run setup again:  krythor setup'));
      console.log(fmt.dim(`  Config saved to: ${sys.configDir}`));
    }
    console.log('');

    console.log(fmt.head('What You Can Do Now'));
    console.log('');
    console.log(fmt.dim('  Available commands:'));
    console.log(fmt.ok ('    krythor               — start the gateway and open the Control UI'));
    console.log(fmt.ok ('    krythor start --daemon — start gateway in the background'));
    console.log(fmt.ok ('    krythor stop           — stop the background daemon'));
    console.log(fmt.ok ('    krythor restart        — restart the background daemon'));
    console.log(fmt.ok ('    krythor status         — quick health check of the running gateway'));
    console.log(fmt.ok ('    krythor tui            — terminal dashboard (polls gateway every 5s)'));
    console.log(fmt.ok ('    krythor doctor         — full diagnostics report'));
    console.log(fmt.ok ('    krythor repair         — check runtime components and credentials'));
    console.log(fmt.ok ('    krythor backup         — create a timestamped backup of your data'));
    console.log(fmt.ok ('    krythor setup          — re-run this setup wizard'));
    console.log(fmt.ok ('    krythor setup --section provider|gateway|channels|workspace|skills|daemon'));
    console.log(fmt.ok ('    krythor update         — update to the latest release'));
    console.log(fmt.ok ('    krythor uninstall      — remove the Krythor installation'));
    console.log(fmt.ok ('    krythor help           — print all commands with descriptions'));
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
    console.log(fmt.dim(`    Workspace:  ${sys.defaultWorkspaceDir}`));
    console.log(fmt.dim(`    Templates:  ${sys.dataDir}/templates/`));
    console.log(fmt.dim('    Docs:       docs/GETTING_STARTED.md, docs/CONFIG_REFERENCE.md'));
    console.log('');

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

    await this.offerLaunchAndHealthCheck(sys);
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
    console.log(fmt.ok(`Node ${sys.nodeVersion} (${sys.platform}${sys.isWSL2 ? ' / WSL2' : ''})`));
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
    if (sys.tailscaleDetected) {
      console.log(fmt.ok(`Tailscale detected${sys.tailscaleSocketPath ? ` (${sys.tailscaleSocketPath})` : ''}`));
    }
    if (sys.hasExistingConfig) {
      console.log(fmt.warn('Existing config found at ' + sys.configDir));
    }
    console.log('');
  }

  // ── Step 0: Remote mode ─────────────────────────────────────────────────────

  private async checkRemoteMode(): Promise<boolean> {
    console.log(fmt.head('Install Mode'));
    const choice = await choose(
      'How would you like to use Krythor?',
      [
        'Local install — run the gateway on this machine (recommended)',
        'Remote client — connect to a Krythor gateway running elsewhere',
      ],
      0,
    );
    console.log('');

    if (!choice.startsWith('Remote')) return false;

    console.log(fmt.head('Remote Gateway Connection'));
    console.log(fmt.dim('  This will configure your local CLI/client to connect to an existing Krythor gateway.'));
    console.log(fmt.dim('  Nothing will be installed or changed on the remote host.'));
    console.log('');

    const gatewayUrl = await ask('  Gateway URL (e.g. http://192.168.1.10:47200): ');
    if (!gatewayUrl.trim()) {
      console.log(fmt.warn('  No URL entered — aborting remote setup.'));
      return true;
    }

    const { key: authToken, ref: authRef } = await this.askApiKey('gateway auth token', gatewayUrl);

    // Probe the remote gateway
    process.stdout.write(fmt.dim('  Testing connection… '));
    try {
      const headers: Record<string, string> = {};
      const resolvedToken = authToken ?? (authRef ? new Installer('').resolveSecretRef(authRef) : undefined);
      if (resolvedToken) headers['Authorization'] = `Bearer ${resolvedToken}`;
      const res = await fetch(`${gatewayUrl.replace(/\/$/, '')}/health`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as { version?: string };
        console.log(fmt.ok(`connected (v${data.version ?? '?'})`));
      } else {
        console.log(fmt.warn(`HTTP ${res.status} — saving config anyway.`));
      }
    } catch {
      console.log(fmt.warn('could not reach gateway — saving config anyway.'));
    }

    const sys = await probe();
    const installer = new Installer(sys.configDir);
    installer.ensureDirs(sys.dataDir);
    installer.writeRemoteClientConfig({
      mode: 'remote',
      gatewayUrl: gatewayUrl.trim(),
      authToken: authRef ?? authToken ?? '',
    });

    console.log(fmt.ok('Remote client config saved to: ' + sys.configDir));
    console.log(fmt.dim('  Start the Krythor client with: krythor --remote'));
    return true;
  }

  // ── Step 4: Workspace ───────────────────────────────────────────────────────

  private async configureWorkspace(installer: Installer, sys: ProbeResult): Promise<void> {
    console.log(fmt.head('Workspace'));
    console.log(fmt.dim('  The workspace is where agent files, scratch pads, and outputs are stored.'));
    console.log('');
    const input = await ask(`  Workspace directory [${sys.defaultWorkspaceDir}]: `);
    const workspaceDir = input.trim() || sys.defaultWorkspaceDir;
    installer.writeWorkspaceConfig(workspaceDir);

    // Install templates into the data dir (not the workspace — templates are docs)
    const installedTemplates = installer.installTemplates(sys.dataDir);
    if (installedTemplates.length > 0) {
      console.log(fmt.ok(`Workspace templates installed to: ${sys.dataDir}/templates/`));
      for (const f of installedTemplates) {
        console.log(fmt.dim(`    ${f}`));
      }
    }
    console.log(fmt.ok(`Workspace: ${workspaceDir}`));
    console.log('');
  }

  // ── API key / SecretRef input helper ────────────────────────────────────────

  private async askApiKey(
    providerName: string,
    keyUrl: string,
  ): Promise<{ key?: string; ref?: SecretRef }> {
    // Non-interactive ref mode: expect env var name, fail fast if unset
    if (this.opts.secretInputMode === 'ref') {
      const envName = await ask(`  Env var for ${providerName} API key: `);
      if (!envName.trim()) {
        console.error(fmt.err(`  --secret-input-mode ref requires an env var name. Aborting.`));
        process.exit(1);
      }
      const ref: SecretRef = { type: 'env', name: envName.trim() };
      const resolved = new Installer('').resolveSecretRef(ref);
      if (!resolved) {
        console.error(fmt.err(`  Env var $${envName.trim()} is not set. Set it and retry.`));
        process.exit(1);
      }
      return { ref };
    }

    // Interactive: offer direct entry or secret reference
    if (keyUrl) console.log(fmt.dim(`  Get your API key at: ${keyUrl}`));
    const inputMode = await choose(
      '  How would you like to provide the API key?',
      ['Paste key directly', 'Use env var reference', 'Use file reference'],
      0,
    );

    if (inputMode === 'Paste key directly') {
      const key = await ask('  API Key: ');
      return { key: key || undefined };
    }

    if (inputMode === 'Use env var reference') {
      const envName = await ask('  Environment variable name: ');
      if (!envName.trim()) return {};
      const ref: SecretRef = { type: 'env', name: envName.trim() };
      const resolved = new Installer('').resolveSecretRef(ref);
      if (!resolved) {
        console.log(fmt.warn(`  $${envName.trim()} is not set — saving reference anyway. Set it before starting the gateway.`));
      } else {
        console.log(fmt.ok(`  $${envName.trim()} is set.`));
      }
      return { ref };
    }

    // File reference
    const filePath = await ask('  File path: ');
    if (!filePath.trim()) return {};
    const ref: SecretRef = { type: 'file', path: filePath.trim() };
    const resolved = new Installer('').resolveSecretRef(ref);
    if (!resolved) {
      console.log(fmt.warn(`  File "${filePath.trim()}" not found or empty — saving reference anyway.`));
    } else {
      console.log(fmt.ok(`  File reference validated.`));
    }
    return { ref };
  }

  // ── Provider configuration ──────────────────────────────────────────────────

  private async configureProvider(
    installer: Installer,
    type: string,
    sys: ProbeResult,
  ): Promise<string | undefined> {
    console.log('');

    let name = type.charAt(0).toUpperCase() + type.slice(1);
    let endpoint: string;
    let apiKey: string | undefined;
    let apiKeyRef: SecretRef | undefined;
    let authMethod: 'api_key' | 'oauth' | 'none' = 'none';
    let setupHint: string | undefined;
    let models: string[] = [];

    const dualAuthTypes = ['anthropic', 'openai'];
    const isDualAuth = dualAuthTypes.includes(type);

    if (type === 'ollama') {
      const url = await ask(`  Base URL [${sys.ollamaBaseUrl}]: `);
      endpoint = url || sys.ollamaBaseUrl;
      authMethod = 'none';

      const OLLAMA_POPULAR = [
        'llama3.2', 'llama3.3', 'mistral', 'gemma3', 'qwen2.5',
        'phi4', 'deepseek-r1', 'codellama', 'llava',
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
      const providerInfo: Record<string, { endpoint: string; keyUrl: string; defaultModel: string; models: string[] }> = {
        anthropic: {
          endpoint:     'https://api.anthropic.com',
          keyUrl:       'https://console.anthropic.com/settings/keys',
          defaultModel: 'claude-sonnet-4-6',
          models: [
            'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5',
            'claude-sonnet-4-5', 'claude-opus-4-5', 'claude-sonnet-4-20250514',
            'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022',
            'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307',
          ],
        },
        openai: {
          endpoint:     'https://api.openai.com/v1',
          keyUrl:       'https://platform.openai.com/api-keys',
          defaultModel: 'gpt-4.1-mini',
          models: [
            'gpt-4.1-mini', 'gpt-4.1', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini',
            'o4-mini', 'o3', 'o3-mini', 'o1', 'o1-mini', 'o1-preview',
            'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo',
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
        const { key, ref } = await this.askApiKey(name, info.keyUrl);
        apiKey = key;
        apiKeyRef = ref;
        models = [await pickModel(info.models, info.defaultModel)];
        console.log(fmt.ok(`Provider "${name}" configured with API key.`));

      } else if (authChoice === 'OAuth (browser login)') {
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
          setupHint = JSON.stringify({
            type: 'oauth_pending',
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim() || undefined,
          });
        }

        console.log(fmt.ok(`Provider "${name}" added with OAuth auth method.`));
        console.log(fmt.dim('  Start Krythor, then go to Models tab → click "Connect with OAuth" to complete login.'));

      } else {
        console.log(fmt.dim(`  Skipped. Add ${name} later from the Models tab.`));
        return undefined;
      }

    } else if (type === 'kimi') {
      endpoint = 'https://api.moonshot.cn/v1';
      name = 'Kimi';
      authMethod = 'api_key';
      const { key, ref } = await this.askApiKey('Kimi', 'https://platform.moonshot.cn/console/api-keys');
      apiKey = key; apiKeyRef = ref;
      models = [await pickModel([
        'kimi-k2.5', 'kimi-k2', 'kimi-latest',
        'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k',
        'moonshot-v1-32k-vision-preview', 'moonshot-v1-128k-vision-preview',
      ], 'kimi-k2.5')];

    } else if (type === 'minimax') {
      endpoint = 'https://api.minimax.chat/v1';
      name = 'MiniMax';
      authMethod = 'api_key';
      const { key, ref } = await this.askApiKey('MiniMax', 'https://www.minimax.chat/user-center/basic-information/interface-key');
      apiKey = key; apiKeyRef = ref;
      models = [await pickModel([
        'MiniMax-Text-01', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed',
        'MiniMax-M2', 'MiniMax-VL-01',
        'abab6.5s-chat', 'abab6.5g-chat', 'abab6.5-chat', 'abab5.5-chat',
      ], 'MiniMax-Text-01')];

    } else if (type === 'openrouter') {
      endpoint = 'https://openrouter.ai/api/v1';
      name = 'OpenRouter';
      authMethod = 'api_key';
      console.log(fmt.dim('  OpenRouter gives you access to 200+ models with a single API key.'));
      const { key, ref } = await this.askApiKey('OpenRouter', 'https://openrouter.ai/keys');
      apiKey = key; apiKeyRef = ref;

      let liveModels: string[] = [];
      process.stdout.write(fmt.dim('  Fetching model list from OpenRouter… '));
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json() as { data?: Array<{ id: string }> };
          liveModels = (data.data ?? [])
            .map(m => m.id)
            .filter(id => typeof id === 'string' && id.length > 0)
            .slice(0, 50);
          console.log(`${liveModels.length} models available.`);
        } else {
          console.log('unavailable — using curated list.');
        }
      } catch {
        console.log('offline — using curated list.');
      }

      const curatedModels = [
        'anthropic/claude-sonnet-4-6', 'anthropic/claude-opus-4-6', 'anthropic/claude-haiku-4-5',
        'anthropic/claude-3-5-sonnet-20241022',
        'openai/gpt-4.1', 'openai/gpt-4.1-mini', 'openai/gpt-4o', 'openai/o3', 'openai/o4-mini',
        'google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'google/gemini-2.0-flash',
        'meta-llama/llama-3.3-70b-instruct', 'meta-llama/llama-3.1-405b-instruct',
        'deepseek/deepseek-r1', 'deepseek/deepseek-chat',
        'mistralai/mistral-large', 'mistralai/mistral-small',
        'qwen/qwen-2.5-72b-instruct', 'qwen/qwen3-235b-a22b',
        'x-ai/grok-3', 'x-ai/grok-3-mini',
        'cohere/command-r-plus',
      ];
      const modelChoices = liveModels.length > 0 ? liveModels : curatedModels;
      models = [await pickModel(modelChoices, modelChoices[0]!)];

    } else if (type === 'groq') {
      endpoint = 'https://api.groq.com/openai/v1';
      name = 'Groq';
      authMethod = 'api_key';
      console.log(fmt.dim('  Groq delivers extremely fast inference on open-weight models.'));
      const { key, ref } = await this.askApiKey('Groq', 'https://console.groq.com/keys');
      apiKey = key; apiKeyRef = ref;
      models = [await pickModel([
        'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama-3.3-70b-specdec',
        'llama-3.1-70b-versatile', 'llama3-70b-8192', 'llama3-8b-8192',
        'mixtral-8x7b-32768', 'gemma2-9b-it', 'gemma-7b-it',
        'qwen-qwq-32b', 'deepseek-r1-distill-llama-70b', 'deepseek-r1-distill-qwen-32b',
        'compound-beta', 'compound-beta-mini',
      ], 'llama-3.3-70b-versatile')];

    } else if (type === 'venice') {
      endpoint = 'https://api.venice.ai/api/v1';
      name = 'Venice';
      authMethod = 'api_key';
      console.log(fmt.dim('  Venice is privacy-focused — prompts are not logged or used for training.'));
      const { key, ref } = await this.askApiKey('Venice', 'https://venice.ai/settings/api');
      apiKey = key; apiKeyRef = ref;
      models = [await pickModel([
        'venice-uncensored', 'llama-3.3-70b', 'llama-3.1-405b', 'llama-3.2-3b',
        'mistral-31-24b', 'mistral-nemo', 'qwen-2.5-72b', 'qwen-2.5-coder-32b',
        'deepseek-r1-671b', 'deepseek-r1-distill-llama-70b', 'deepseek-v3', 'phi-4',
      ], 'venice-uncensored')];

    } else if (type === 'z.ai') {
      endpoint = 'https://api.z.ai/api/v1';
      name = 'Z.AI';
      authMethod = 'api_key';
      console.log(fmt.dim('  Z.AI provides access to Gemini and other Google AI models via OpenAI-compatible API.'));
      const { key, ref } = await this.askApiKey('Z.AI', 'https://z.ai/api-access');
      apiKey = key; apiKeyRef = ref;
      models = [await pickModel([
        'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
        'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-pro-exp',
        'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b',
      ], 'gemini-2.5-pro')];

    } else if (type === 'lmstudio') {
      const url = await ask(`  Base URL [${sys.lmStudioBaseUrl}]: `);
      endpoint = url || sys.lmStudioBaseUrl;
      name = 'LM Studio';
      authMethod = 'none';

      let liveModels: string[] = sys.lmStudioModels ?? [];
      if (liveModels.length === 0 || url) {
        try {
          const res = await fetch(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            const data = await res.json() as { data?: Array<{ id: string }> };
            liveModels = (data.data ?? []).map(m => m.id);
          }
        } catch { /* not running */ }
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
      const url = await ask(`  Base URL [${sys.llamaServerBaseUrl}]: `);
      endpoint = url || sys.llamaServerBaseUrl;
      name = 'llama-server';
      authMethod = 'none';

      let liveModels: string[] = [];
      try {
        const res = await fetch(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          const data = await res.json() as { data?: Array<{ id: string }> };
          liveModels = (data.data ?? []).map(m => m.id);
        }
      } catch { /* not running */ }

      if (liveModels.length > 0) {
        console.log(fmt.ok(`Found loaded model: ${liveModels[0]}`));
        models = [await pickModel(liveModels, liveModels[0]!)];
      } else {
        console.log(fmt.dim('  llama-server is not running or model name could not be fetched.'));
        const modelInput = await ask('  Model name (or leave blank): ');
        models = modelInput ? [modelInput] : [];
      }

    } else if (type === 'anthropic-compat') {
      // Custom Anthropic-compatible endpoint
      console.log(fmt.dim('  Anthropic-compatible API (proxy, local Anthropic-format server, etc.)'));
      endpoint = await ask('  Base URL [https://api.anthropic.com]: ') || 'https://api.anthropic.com';
      const nameInput = await ask('  Provider name: ');
      name = nameInput || 'Anthropic-Compat';
      const { key, ref } = await this.askApiKey(name, '');
      apiKey = key; apiKeyRef = ref;
      if (apiKey || apiKeyRef) authMethod = 'api_key';
      const modelInput = await ask('  Default model: ');
      models = modelInput ? [modelInput] : [];

    } else {
      // openai-compat / Custom (OpenAI-compatible) / Custom (auto-detect)
      console.log(fmt.dim('  OpenAI-compatible API (Together AI, Fireworks, custom proxy, etc.)'));
      endpoint = await ask('  Base URL: ');
      const nameInput = await ask('  Provider name: ');
      name = nameInput || 'OpenAI-Compat';
      const modelInput = await ask('  Default model: ');
      models = modelInput ? [modelInput] : [];
      const { key, ref } = await this.askApiKey(name, '');
      apiKey = key; apiKeyRef = ref;
      if (apiKey || apiKeyRef) {
        authMethod = 'api_key';
      } else {
        authMethod = 'none';
      }
    }

    const openAiCompatTypes = ['kimi', 'minimax', 'openrouter', 'groq', 'venice', 'z.ai', 'lmstudio', 'llamaserver', 'anthropic-compat'];
    const internalType = openAiCompatTypes.includes(type)
      ? (type === 'anthropic-compat' ? 'anthropic' : 'openai-compat')
      : type;

    installer.addProvider({
      name,
      type: internalType,
      endpoint,
      authMethod,
      apiKey: apiKey || undefined,
      apiKeyRef: apiKeyRef || undefined,
      setupHint,
      isDefault: authMethod === 'api_key' || authMethod === 'none',
      isEnabled: true,
      models,
    });

    if (!isDualAuth || authMethod === 'api_key') {
      console.log(fmt.ok(`Provider "${name}" configured as default.`));
    }

    return models[0];
  }

  // ── Gateway configuration ───────────────────────────────────────────────────

  // Returns the token or SecretRef so it can be passed to the daemon step
  private async configureGateway(installer: Installer, sys: ProbeResult): Promise<string | SecretRef | undefined> {
    console.log(fmt.head('Gateway Configuration'));
    console.log(fmt.dim('  The gateway is the local HTTP server Krythor runs on your machine.'));
    console.log('');

    const existing = installer.readGatewayConfig();
    const currentPort = existing.port ?? 47200;
    const currentBind = existing.bind ?? '127.0.0.1';

    const portInput = await ask(`  Port [${currentPort}]: `);
    const port = portInput ? parseInt(portInput, 10) : currentPort;
    if (isNaN(port) || port < 1024 || port > 65535) {
      console.log(fmt.warn('  Invalid port — keeping current value.'));
    }
    const resolvedPort = (!isNaN(port) && port >= 1024 && port <= 65535) ? port : currentPort;

    console.log(fmt.dim('  Bind address controls who can reach the gateway:'));
    console.log(fmt.dim('    127.0.0.1 — loopback only (default, most secure)'));
    console.log(fmt.dim('    0.0.0.0   — all interfaces (LAN/remote access)'));
    const bindChoice = await choose(
      '  Bind address',
      ['127.0.0.1 (loopback — default)', '0.0.0.0 (all interfaces)'],
      currentBind === '0.0.0.0' ? 1 : 0,
    );
    const bind = bindChoice.startsWith('0.0.0.0') ? '0.0.0.0' : '127.0.0.1';

    // Tailscale exposure
    let tailscale: { enabled: boolean; hostname?: string } = { enabled: false };
    if (sys.tailscaleDetected) {
      const enableTailscale = await confirm('  Tailscale detected — expose gateway over Tailscale?', false);
      if (enableTailscale) {
        const tsHostname = await ask('  Tailscale hostname (leave blank for machine default): ');
        tailscale = { enabled: true, hostname: tsHostname.trim() || undefined };
        if (bind !== '0.0.0.0') {
          console.log(fmt.warn('  Tip: set bind to 0.0.0.0 to accept Tailscale connections.'));
        }
      }
    }

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
    let tokenRef: SecretRef | undefined;
    let tokenOrRef: string | SecretRef | undefined;

    if (authMode === 'token') {
      const existingToken = existing.auth?.token;
      if (existingToken) {
        const keepToken = await confirm('  Existing auth token found — keep it?', true);
        token = keepToken ? existingToken : randomBytes(32).toString('hex');
      } else {
        token = randomBytes(32).toString('hex');
      }

      // Offer to store as env var ref instead of plaintext
      const useRef = await confirm('  Store token as env var reference instead of plaintext?', false);
      if (useRef) {
        const envName = await ask('  Environment variable name [KRYTHOR_GATEWAY_TOKEN]: ');
        const resolvedName = envName.trim() || 'KRYTHOR_GATEWAY_TOKEN';
        tokenRef = { type: 'env', name: resolvedName };
        const resolved = installer.resolveSecretRef(tokenRef);
        if (!resolved) {
          console.log(fmt.warn(`  $${resolvedName} is not set. Set it before starting the gateway.`));
          console.log(fmt.dim(`  The generated token is: ${token}`));
          console.log(fmt.dim(`  Add to your shell profile:  export ${resolvedName}="${token}"`));
        }
        token = undefined;
        tokenOrRef = tokenRef;
      } else {
        console.log(fmt.ok('  Auth token generated (stored in gateway.json).'));
        tokenOrRef = token;
      }
    }

    installer.writeGatewayConfig({
      port: resolvedPort,
      bind,
      auth: { mode: authMode, token, tokenRef },
      tailscale,
    });

    if (bind === '0.0.0.0') {
      console.log(fmt.warn('  Gateway will accept connections from all network interfaces.'));
      console.log(fmt.dim('  Make sure your firewall restricts port access appropriately.'));
    }
    console.log(fmt.ok(`Gateway configured: ${bind}:${resolvedPort} (auth: ${authMode}${tailscale.enabled ? ', tailscale' : ''})`));
    console.log('');

    return tokenOrRef;
  }

  // ── Chat channel configuration ──────────────────────────────────────────────

  private async configureChannels(installer: Installer, sys: ProbeResult): Promise<void> {
    console.log(fmt.head('Chat Channels (optional)'));
    console.log(fmt.dim('  Connect Krythor to messaging platforms for inbound chat.'));
    console.log(fmt.dim('  All channels are optional — configure later via the Channels tab.'));
    console.log('');

    const setupAny = await confirm('  Set up any chat channels now?', false);
    if (!setupAny) {
      console.log(fmt.dim('  Skipped. Add channels later via the Control UI.'));
      console.log('');
      return;
    }

    const allChannels = [
      'Telegram', 'Discord', 'Slack', 'WhatsApp',
      'Google Chat', 'Mattermost', 'Signal',
      ...(sys.platform === 'darwin' ? ['BlueBubbles', 'iMessage'] : []),
    ];
    const configured = new Set<string>();

    while (true) {
      const remaining = allChannels.filter(c => !configured.has(c));
      const choices = [...remaining, 'Done (finish)'];
      const pick = await choose(
        `  Configure a channel (${configured.size} configured so far)`,
        choices,
        choices.length - 1, // default: Done
      );
      if (pick === 'Done (finish)') break;

      switch (pick) {
        case 'Telegram':    await this.configureTelegram(installer);    break;
        case 'Discord':     await this.configureDiscord(installer);     break;
        case 'Slack':       await this.configureSlack(installer);       break;
        case 'WhatsApp':    await this.configureWhatsApp(installer, sys); break;
        case 'Google Chat': await this.configureGoogleChat(installer);  break;
        case 'Mattermost':  await this.configureMattermost(installer);  break;
        case 'Signal':      await this.configureSignal(installer);      break;
        case 'BlueBubbles': await this.configureBlueBubbles(installer); break;
        case 'iMessage':    await this.configureIMessage(installer);    break;
      }
      configured.add(pick);
    }

    if (configured.size > 0) {
      console.log(fmt.ok(`Chat channels configured: ${[...configured].join(', ')}`));
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
    if (!botToken.trim()) { console.log(fmt.warn('  No token entered — Telegram not configured.')); return; }
    installer.writeChannelsConfig({ telegram: { enabled: true, botToken: botToken.trim() } });
    console.log(fmt.ok('  Telegram configured. Send a message to your bot after the gateway starts to pair.'));
  }

  private async configureDiscord(installer: Installer): Promise<void> {
    console.log('');
    console.log(fmt.dim('  ── Discord ──'));
    console.log(fmt.dim('  1. Go to https://discord.com/developers/applications'));
    console.log(fmt.dim('  2. Create a New Application → Bot section → Reset Token'));
    console.log(fmt.dim('  3. Enable: Message Content Intent and Server Members Intent'));
    console.log(fmt.dim('  4. OAuth2 → invite with bot + applications.commands scopes'));
    console.log('');
    const botToken = await ask('  Bot token: ');
    if (!botToken.trim()) { console.log(fmt.warn('  No token entered — Discord not configured.')); return; }
    const guildId = await ask('  Server (Guild) ID (right-click server → Copy ID): ');
    installer.writeChannelsConfig({
      discord: { enabled: true, botToken: botToken.trim(), guildId: guildId.trim() || undefined },
    });
    console.log(fmt.ok('  Discord configured. DM the bot after the gateway starts to pair.'));
  }

  private async configureSlack(installer: Installer): Promise<void> {
    console.log('');
    console.log(fmt.dim('  ── Slack ──'));
    console.log(fmt.dim('  1. Go to https://api.slack.com/apps and create a new app'));
    console.log(fmt.dim('  2. Enable Socket Mode → generate App Token (xapp-...) with connections:write'));
    console.log(fmt.dim('  3. Install app to workspace → copy Bot Token (xoxb-...) from OAuth & Permissions'));
    console.log('');
    const botToken = await ask('  Bot token (xoxb-...): ');
    if (!botToken.trim()) { console.log(fmt.warn('  No bot token entered — Slack not configured.')); return; }
    const appToken = await ask('  App token (xapp-...): ');
    if (!appToken.trim()) { console.log(fmt.warn('  No app token entered — Slack not configured.')); return; }
    installer.writeChannelsConfig({
      slack: { enabled: true, botToken: botToken.trim(), appToken: appToken.trim() },
    });
    console.log(fmt.ok('  Slack configured. Message your bot after the gateway starts to pair.'));
  }

  private async configureWhatsApp(installer: Installer, sys: ProbeResult): Promise<void> {
    console.log('');
    console.log(fmt.dim('  ── WhatsApp ──'));
    console.log(fmt.dim('  Uses @whiskeysockets/baileys for WhatsApp Web integration.'));
    console.log(fmt.dim('  A QR code will be shown when the gateway starts — scan it with WhatsApp.'));
    console.log('');
    const defaultSessionDir = join(sys.dataDir, 'whatsapp-session');
    const input = await ask(`  Session directory [${defaultSessionDir}]: `);
    const sessionDir = input.trim() || defaultSessionDir;
    installer.writeChannelsConfig({ whatsapp: { enabled: true, sessionDir } });
    console.log(fmt.ok('  WhatsApp configured. Scan the QR code shown at gateway startup to authenticate.'));
  }

  private async configureGoogleChat(installer: Installer): Promise<void> {
    console.log('');
    console.log(fmt.dim('  ── Google Chat ──'));
    console.log(fmt.dim('  1. Go to https://chat.google.com and open a Space'));
    console.log(fmt.dim('  2. Apps & integrations → Webhooks → Add webhook'));
    console.log(fmt.dim('  3. Copy the incoming webhook URL'));
    console.log('');
    const webhookUrl = await ask('  Incoming webhook URL: ');
    if (!webhookUrl.trim()) { console.log(fmt.warn('  No URL entered — Google Chat not configured.')); return; }
    if (!webhookUrl.startsWith('https://chat.googleapis.com/')) {
      console.log(fmt.warn('  URL does not look like a Google Chat webhook — saving anyway.'));
    }
    installer.writeChannelsConfig({ googlechat: { enabled: true, webhookUrl: webhookUrl.trim() } });
    console.log(fmt.ok('  Google Chat configured.'));
    console.log(fmt.dim('  Note: Google Chat webhooks are outbound only. For inbound (bot) use, set up a bot app.'));
  }

  private async configureMattermost(installer: Installer): Promise<void> {
    console.log('');
    console.log(fmt.dim('  ── Mattermost ──'));
    console.log(fmt.dim('  1. In Mattermost: System Console → Bot Accounts → Enable'));
    console.log(fmt.dim('  2. Integrations → Bot Accounts → Add Bot Account'));
    console.log(fmt.dim('  3. Copy the access token'));
    console.log('');
    const serverUrl = await ask('  Mattermost server URL (e.g. https://mattermost.example.com): ');
    if (!serverUrl.trim()) { console.log(fmt.warn('  No URL entered — Mattermost not configured.')); return; }
    const botToken = await ask('  Bot access token: ');
    if (!botToken.trim()) { console.log(fmt.warn('  No token entered — Mattermost not configured.')); return; }
    const teamId = await ask('  Team ID (optional): ');
    installer.writeChannelsConfig({
      mattermost: {
        enabled: true,
        serverUrl: serverUrl.trim(),
        botToken: botToken.trim(),
        teamId: teamId.trim() || undefined,
      },
    });
    console.log(fmt.ok('  Mattermost configured.'));
  }

  private async configureSignal(installer: Installer): Promise<void> {
    console.log('');
    console.log(fmt.dim('  ── Signal ──'));
    console.log(fmt.dim('  Requires signal-cli or signal-rest-api running locally.'));
    console.log(fmt.dim('  signal-cli: https://github.com/AsamK/signal-cli'));
    console.log(fmt.dim('  signal-rest-api: https://github.com/bbernhard/signal-cli-rest-api'));
    console.log(fmt.dim('  Register a phone number with signal-cli before using this integration.'));
    console.log('');
    const apiUrl = await ask('  Signal REST API URL [http://localhost:8080]: ');
    const resolvedUrl = apiUrl.trim() || 'http://localhost:8080';
    const phoneNumber = await ask('  Registered phone number (e.g. +15551234567): ');
    if (!phoneNumber.trim()) { console.log(fmt.warn('  No phone number entered — Signal not configured.')); return; }
    installer.writeChannelsConfig({
      signal: { enabled: true, apiUrl: resolvedUrl, phoneNumber: phoneNumber.trim() },
    });
    console.log(fmt.ok('  Signal configured. Registration must be done separately via signal-cli.'));
  }

  private async configureBlueBubbles(installer: Installer): Promise<void> {
    console.log('');
    console.log(fmt.dim('  ── BlueBubbles ──'));
    console.log(fmt.dim('  Requires BlueBubbles Server running on a Mac.'));
    console.log(fmt.dim('  Download: https://bluebubbles.app'));
    console.log('');
    const serverUrl = await ask('  BlueBubbles server URL (e.g. http://192.168.1.5:1234): ');
    if (!serverUrl.trim()) { console.log(fmt.warn('  No URL entered — BlueBubbles not configured.')); return; }
    const password = await ask('  BlueBubbles server password: ');
    if (!password.trim()) { console.log(fmt.warn('  No password entered — BlueBubbles not configured.')); return; }
    installer.writeChannelsConfig({
      bluebubbles: { enabled: true, serverUrl: serverUrl.trim(), password: password.trim() },
    });
    console.log(fmt.ok('  BlueBubbles configured.'));
  }

  private async configureIMessage(installer: Installer): Promise<void> {
    console.log('');
    console.log(fmt.dim('  ── iMessage ──'));
    console.log(fmt.dim('  macOS only. Two integration methods:'));
    console.log(fmt.dim('    AppleScript — uses System Events (requires Accessibility permissions)'));
    console.log(fmt.dim('    BlueBubbles  — routes through BlueBubbles server (more reliable)'));
    console.log('');
    const method = await choose(
      '  iMessage integration method',
      ['AppleScript', 'Via BlueBubbles server'],
      0,
    );
    const methodId = method.startsWith('Via') ? 'bluebubbles' as const : 'applescript' as const;
    if (methodId === 'applescript') {
      console.log(fmt.dim('  Grant Accessibility access: System Settings → Privacy & Security → Accessibility'));
    } else {
      console.log(fmt.dim('  Make sure BlueBubbles is also configured above.'));
    }
    installer.writeChannelsConfig({ imessage: { enabled: true, method: methodId } });
    console.log(fmt.ok(`  iMessage configured (method: ${methodId}).`));
  }

  // ── Web search configuration ────────────────────────────────────────────────

  private async configureWebSearch(installer: Installer): Promise<void> {
    console.log(fmt.head('Web Search (optional)'));
    console.log(fmt.dim('  DuckDuckGo is the default (no API key needed).'));
    console.log(fmt.dim('  Optionally configure a premium provider for richer results.'));
    console.log('');

    const enablePremium = await confirm('  Configure a premium web search provider?', false);
    if (!enablePremium) {
      console.log(fmt.dim('  Using built-in DuckDuckGo search.'));
      console.log('');
      return;
    }

    const providers = [
      { label: 'Brave Search',    id: 'brave',      url: 'https://api.search.brave.com/app/keys' },
      { label: 'Perplexity',      id: 'perplexity', url: 'https://docs.perplexity.ai/docs/getting-started' },
      { label: 'Google (Gemini)', id: 'gemini',     url: 'https://ai.google.dev/gemini-api/docs' },
      { label: 'Kimi (Moonshot)', id: 'kimi',       url: 'https://platform.moonshot.cn/console/api-keys' },
    ];

    const choice = await choose('  Search provider', [...providers.map(p => p.label), 'Skip'], 0);
    const selected = providers.find(p => p.label === choice);
    if (!selected) { console.log(fmt.dim('  Skipped.')); console.log(''); return; }

    console.log(fmt.dim(`  Get your API key at: ${selected.url}`));
    const apiKey = await ask(`  ${selected.label} API key: `);
    if (!apiKey.trim()) { console.log(fmt.warn('  No key entered — using DuckDuckGo.')); console.log(''); return; }

    installer.writeWebSearchConfig({ enabled: true, provider: selected.id, apiKey: apiKey.trim() });
    console.log(fmt.ok(`  Web search configured: ${selected.label}`));
    console.log('');
  }

  // ── Skills configuration ────────────────────────────────────────────────────

  private async configureSkills(installer: Installer): Promise<void> {
    console.log(fmt.head('Skills (optional)'));
    console.log(fmt.dim('  Skills are reusable prompt templates your agents can invoke.'));
    console.log(fmt.dim('  Built-in skills:'));
    for (const s of BUILTIN_SKILLS) {
      console.log(fmt.dim(`    ${s.name.padEnd(12)} — ${s.description}`));
    }
    console.log('');

    const enableAll = await confirm('  Enable all built-in skills?', true);
    if (enableAll) {
      installer.writeSkillsConfig(BUILTIN_SKILLS);
      console.log(fmt.ok(`  ${BUILTIN_SKILLS.length} built-in skills enabled.`));
    } else {
      const toEnable: SkillSeedEntry[] = [];
      for (const skill of BUILTIN_SKILLS) {
        const yes = await confirm(`  Enable "${skill.name}"?`, true);
        if (yes) toEnable.push(skill);
      }
      if (toEnable.length > 0) {
        installer.writeSkillsConfig(toEnable);
        console.log(fmt.ok(`  ${toEnable.length} skill(s) enabled.`));
      } else {
        console.log(fmt.dim('  No skills enabled. Add them later via the Skills tab.'));
      }
    }
    console.log('');
  }

  // ── Daemon configuration ────────────────────────────────────────────────────

  private async configureDaemon(
    installer: Installer,
    sys: ProbeResult,
    tokenOrRef: string | SecretRef | undefined,
  ): Promise<void> {
    console.log(fmt.head('Auto-start / Daemon (optional)'));
    console.log(fmt.dim('  Configure Krythor to start automatically when you log in.'));
    if (sys.isWSL2) {
      console.log(fmt.dim('  WSL2 detected — systemd user units require WSL 0.67.6+ with systemd enabled.'));
    }
    console.log('');

    const setup = await confirm('  Configure auto-start now?', false);
    if (!setup) {
      console.log(fmt.dim('  Skipped. Run: krythor setup --section daemon  to configure later.'));
      console.log('');
      return;
    }

    const candidates = [
      join(__dirname, '..', '..', '..', 'gateway', 'dist', 'index.js'),
      join(__dirname, '..', '..', '..', '..', 'packages', 'gateway', 'dist', 'index.js'),
    ];
    const gatewayDistPath = candidates.find(p => existsSync(p));

    if (!gatewayDistPath) {
      console.log(fmt.warn('  Gateway dist not found — build first with: pnpm -r build'));
      console.log(fmt.dim('  Then run: krythor setup --section daemon'));
      console.log('');
      return;
    }

    const { written, instructions } = installer.writeDaemonConfig({
      platform: sys.platform,
      isWSL2: sys.isWSL2,
      gatewayDistPath,
      configDir: sys.configDir,
      dataDir: sys.dataDir,
      tokenOrRef,
    });

    if (written.length > 0) {
      console.log(fmt.ok('  Daemon unit written:'));
      for (const f of written) {
        console.log(fmt.dim(`    ${f}`));
      }
    }

    if (instructions.length > 0) {
      console.log('');
      console.log(fmt.dim('  Next steps:'));
      for (const line of instructions) {
        console.log(fmt.dim(`    ${line}`));
      }
    }
    console.log('');
  }

  // ── Launch and health check ─────────────────────────────────────────────────

  private async offerLaunchAndHealthCheck(sys: ProbeResult): Promise<void> {
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

    // Poll /ready (not /health) — 503 = process up but not ready; timeout = not started
    let ready = false;
    let lastStatus = 0;
    for (let i = 0; i < 17; i++) {
      await new Promise(r => setTimeout(r, 600));
      try {
        const r = await fetch('http://127.0.0.1:47200/ready', { signal: AbortSignal.timeout(500) });
        lastStatus = r.status;
        if (r.ok) { ready = true; break; }
        // 503 means process is up but not ready — keep polling
      } catch { /* process not up yet */ }
    }

    if (ready) {
      // Fetch health for summary details
      try {
        const h = await fetch('http://127.0.0.1:47200/health', { signal: AbortSignal.timeout(2000) });
        if (h.ok) {
          const data = await h.json() as {
            version?: string;
            models?: { providerCount?: number; modelCount?: number; hasDefault?: boolean };
          };
          console.log(fmt.ok(`Gateway is running (v${data.version ?? '?'})  →  http://127.0.0.1:47200`));
          if (data.models) {
            const pc = data.models.providerCount ?? 0;
            const mc = data.models.modelCount ?? 0;
            if (pc === 0) {
              console.log(fmt.warn('  No providers configured yet — add one via the Models tab.'));
            } else {
              console.log(fmt.ok(`  Providers: ${pc}  Models: ${mc}  Default: ${data.models.hasDefault ? 'yes' : 'no'}`));
            }
          }
        }
      } catch { /* health fetch failed — process is up but /health is slow */ }
      console.log(fmt.ok('Control UI  →  http://127.0.0.1:47200'));
    } else if (lastStatus === 503) {
      console.log(fmt.warn('Gateway started but is not ready yet. Check the Models tab to add a provider.'));
      console.log(fmt.info('Control UI: http://127.0.0.1:47200'));
    } else {
      console.log(fmt.warn('Gateway did not respond in time. Check logs.'));
      console.log(fmt.info(`Manual start:  node "${gatewayPath}"`));
    }
  }

  // ── Section-only reconfiguration ────────────────────────────────────────────

  private async runSection(section: SetupWizardOptions['section']): Promise<void> {
    console.log(fmt.info('Scanning system…'));
    const sys = await probe();
    const installer = new Installer(sys.configDir);
    installer.ensureDirs(sys.dataDir);

    switch (section) {
      case 'provider': {
        console.log(fmt.head('Provider Setup'));
        const allLabels = [
          'anthropic', 'openai', 'openrouter', 'groq', 'kimi', 'minimax', 'venice', 'z.ai',
          'ollama', 'lmstudio', 'llamaserver',
          'Custom (OpenAI-compatible)', 'Custom (Anthropic-compatible)', 'Custom (auto-detect)',
          'skip',
        ];
        const labelToType: Record<string, string> = {
          'Custom (OpenAI-compatible)':    'openai-compat',
          'Custom (Anthropic-compatible)': 'anthropic-compat',
          'Custom (auto-detect)':          'openai-compat',
        };
        const providerLabel = await choose('Which AI provider?', allLabels, 0);
        if (providerLabel !== 'skip') {
          await this.configureProvider(installer, labelToType[providerLabel] ?? providerLabel, sys);
        }
        console.log(fmt.ok('Provider configuration updated.'));
        break;
      }
      case 'gateway':
        await this.configureGateway(installer, sys);
        console.log(fmt.ok('Gateway configuration updated.'));
        break;
      case 'channels':
        await this.configureChannels(installer, sys);
        console.log(fmt.ok('Channel configuration updated.'));
        break;
      case 'web-search':
        await this.configureWebSearch(installer);
        console.log(fmt.ok('Web search configuration updated.'));
        break;
      case 'workspace':
        await this.configureWorkspace(installer, sys);
        console.log(fmt.ok('Workspace configuration updated.'));
        break;
      case 'skills':
        await this.configureSkills(installer);
        console.log(fmt.ok('Skills configuration updated.'));
        break;
      case 'daemon':
        await this.configureDaemon(installer, sys, undefined);
        console.log(fmt.ok('Daemon configuration updated.'));
        break;
      default:
        console.log(fmt.err(`Unknown section: ${section}`));
        console.log(fmt.dim('  Valid sections: provider, gateway, channels, web-search, workspace, skills, daemon'));
    }
  }
}
