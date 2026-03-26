import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── GuardrailsCLI ────────────────────────────────────────────────────────────
//
// CLI operator commands for the Krythor guardrails system.
// Exposed via start.js as:
//
//   krythor policy check          Validate the active policy file
//   krythor policy doctor         Deep policy health diagnostics
//   krythor audit tail            Stream last N audit events to stdout
//   krythor audit explain <id>    Print full detail for one audit event
//   krythor config init-guardrails Scaffold default policy YAML files
//
// All commands are additive — they read existing state but never
// overwrite files without explicit user consent or the --yes flag.
//

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const G  = '\x1b[32m';   // green
const Y  = '\x1b[33m';   // yellow
const R  = '\x1b[31m';   // red
const C  = '\x1b[36m';   // cyan
const D  = '\x1b[2m';    // dim
const B  = '\x1b[1m';    // bold
const RS = '\x1b[0m';    // reset

const PASS = `${G}PASS${RS}`;
const WARN = `${Y}WARN${RS}`;
const FAIL = `${R}FAIL${RS}`;

// ── Data-dir resolution ───────────────────────────────────────────────────────

export function resolveDataDir(): string {
  if (process.env['KRYTHOR_DATA_DIR']) return process.env['KRYTHOR_DATA_DIR'];
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Krythor');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Krythor');
  }
  return join(homedir(), '.local', 'share', 'krythor');
}

function resolveConfigDir(dataDir: string): string {
  return join(dataDir, 'config');
}

// ── Supported policy operation types ─────────────────────────────────────────

const VALID_OPERATIONS = new Set([
  'file:read', 'file:write', 'file:delete',
  'memory:read', 'memory:write', 'memory:delete', 'memory:export',
  'command:execute', 'command:list',
  'network:fetch', 'network:search',
  'webhook:call',
  'agent:spawn', 'agent:kill',
  'model:infer',
  'config:read', 'config:write',
]);

const VALID_ACTIONS      = new Set(['allow', 'deny', 'warn', 'require-approval']);
const VALID_RISK_LEVELS  = new Set(['low', 'medium', 'high', 'critical']);

// ── Policy-file discovery ─────────────────────────────────────────────────────

function discoverPolicyFiles(configDir: string): string[] {
  const candidates = [
    join(configDir, 'policy.json'),
    join(configDir, 'policy.yaml'),
    join(configDir, 'policy.yml'),
    join(configDir, 'guardrails', 'policy.yaml'),
    join(configDir, 'guardrails', 'policy.yml'),
  ];
  return candidates.filter(p => existsSync(p));
}

// ── YAML/JSON loader (no runtime dep on js-yaml in CLI — best effort) ─────────

function loadPolicyFile(filePath: string): { ok: boolean; data: unknown; error?: string } {
  const raw = readFileSync(filePath, 'utf-8');
  const ext = filePath.toLowerCase();

  if (ext.endsWith('.json')) {
    try {
      return { ok: true, data: JSON.parse(raw) };
    } catch (e) {
      return { ok: false, data: null, error: (e as Error).message };
    }
  }

  // YAML — try js-yaml if available, else basic structural check
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require('js-yaml') as { load: (s: string) => unknown };
    return { ok: true, data: yaml.load(raw) };
  } catch {
    // js-yaml not available in this context — do a best-effort structural check
    if (raw.trim().startsWith('---') || /^\w+:/m.test(raw)) {
      return { ok: true, data: '__yaml_unparsed__', error: 'js-yaml not available; structural check only' };
    }
    return { ok: false, data: null, error: 'Cannot parse file (js-yaml not available)' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// krythor policy check
// ─────────────────────────────────────────────────────────────────────────────

export function runPolicyCheck(): void {
  const dataDir   = resolveDataDir();
  const configDir = resolveConfigDir(dataDir);

  console.log(`${C}  KRYTHOR${RS} — Policy Check`);
  console.log(`${D}  Config dir: ${configDir}${RS}`);
  console.log('');

  const files = discoverPolicyFiles(configDir);

  if (files.length === 0) {
    console.log(`${FAIL}  No policy file found.`);
    console.log(`${D}  Expected one of:${RS}`);
    console.log(`${D}    ${configDir}/policy.json${RS}`);
    console.log(`${D}    ${configDir}/policy.yaml${RS}`);
    console.log(`${D}    ${configDir}/guardrails/policy.yaml${RS}`);
    console.log('');
    console.log(`  Run ${B}krythor config init-guardrails${RS} to create a default policy.`);
    process.exit(1);
  }

  let allOk = true;

  for (const filePath of files) {
    console.log(`${D}  File: ${filePath}${RS}`);
    const { ok, data, error } = loadPolicyFile(filePath);

    if (!ok) {
      console.log(`  ${FAIL}  Parse error: ${error}`);
      allOk = false;
      continue;
    }

    if (data === '__yaml_unparsed__') {
      console.log(`  ${WARN}  YAML detected but js-yaml unavailable — structural check only`);
      console.log(`  ${PASS}  File exists and appears non-empty`);
      continue;
    }

    const policy = data as Record<string, unknown>;

    // Check defaultAction
    const defaultAction = policy['defaultAction'];
    if (defaultAction !== undefined) {
      if (VALID_ACTIONS.has(String(defaultAction))) {
        console.log(`  ${PASS}  defaultAction: ${G}${defaultAction}${RS}`);
      } else {
        console.log(`  ${FAIL}  defaultAction "${defaultAction}" is not valid. Must be one of: ${[...VALID_ACTIONS].join(', ')}`);
        allOk = false;
      }
    } else {
      console.log(`  ${WARN}  defaultAction not set — implicitly "allow" (consider setting "deny" for strict mode)`);
    }

    // Check version
    if (policy['version']) {
      console.log(`  ${PASS}  version: ${D}${policy['version']}${RS}`);
    } else {
      console.log(`  ${WARN}  version field missing`);
    }

    // Check rules
    const rules = policy['rules'];
    if (!Array.isArray(rules)) {
      console.log(`  ${WARN}  rules array missing or not an array`);
      continue;
    }

    console.log(`  ${PASS}  rules: ${rules.length} rule(s) found`);

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i] as Record<string, unknown>;
      const prefix = `    rule[${i}]`;

      if (!rule['id']) {
        console.log(`  ${WARN}  ${prefix} missing id`);
      }

      // Support both flat format (operation: "x") and GuardEngine condition
      // format (condition.operations: ["x"]) so both policy schemas validate.
      const cond = rule['condition'] as Record<string, unknown> | undefined;
      const guardOps: string[] = Array.isArray(cond?.['operations'])
        ? (cond!['operations'] as unknown[]).map(String)
        : [];
      const flatOp = rule['operation'] ? [String(rule['operation'])] : [];
      const ops = guardOps.length > 0 ? guardOps : flatOp;

      if (ops.length === 0) {
        console.log(`  ${FAIL}  ${prefix} missing operation (or condition.operations)`);
        allOk = false;
      } else {
        for (const op of ops) {
          if (!VALID_OPERATIONS.has(op)) {
            console.log(`  ${WARN}  ${prefix} unknown operation "${op}" (may be a GuardEngine extension)`);
          }
        }
      }

      const action = rule['action'];
      if (!action) {
        console.log(`  ${FAIL}  ${prefix} missing action`);
        allOk = false;
      } else if (!VALID_ACTIONS.has(String(action))) {
        console.log(`  ${FAIL}  ${prefix} invalid action "${action}". Must be: ${[...VALID_ACTIONS].join(', ')}`);
        allOk = false;
      }

      const minRisk = rule['minRisk'];
      if (minRisk !== undefined && !VALID_RISK_LEVELS.has(String(minRisk))) {
        console.log(`  ${WARN}  ${prefix} unknown minRisk "${minRisk}". Valid: ${[...VALID_RISK_LEVELS].join(', ')}`);
      }
    }
  }

  console.log('');
  if (allOk) {
    console.log(`${G}  Policy check passed.${RS}`);
    process.exit(0);
  } else {
    console.log(`${R}  Policy check failed — see above for details.${RS}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// krythor policy doctor
// ─────────────────────────────────────────────────────────────────────────────

export function runPolicyDoctor(): void {
  const dataDir   = resolveDataDir();
  const configDir = resolveConfigDir(dataDir);

  console.log(`${C}  KRYTHOR${RS} — Policy Doctor`);
  console.log(`${D}  Config dir: ${configDir}${RS}`);
  console.log('');

  const checks: Array<{ label: string; result: 'pass' | 'warn' | 'fail'; note?: string }> = [];

  const mark = (label: string, result: 'pass' | 'warn' | 'fail', note?: string) => {
    checks.push({ label, result, note });
    const icon = result === 'pass' ? PASS : result === 'warn' ? WARN : FAIL;
    const noteStr = note ? `  — ${note}` : '';
    console.log(`  ${icon}  ${label.padEnd(36)}${D}${noteStr}${RS}`);
  };

  // 1. Config dir exists
  mark('Config directory exists', existsSync(configDir) ? 'pass' : 'fail',
    existsSync(configDir) ? configDir : 'run: krythor config init-guardrails');

  // 2. Guardrails subdir
  const guardrailsDir = join(configDir, 'guardrails');
  mark('Guardrails directory exists', existsSync(guardrailsDir) ? 'pass' : 'warn',
    existsSync(guardrailsDir) ? guardrailsDir : 'optional; created by init-guardrails');

  // 3. Policy file exists
  const policyFiles = discoverPolicyFiles(configDir);
  mark('Policy file present', policyFiles.length > 0 ? 'pass' : 'warn',
    policyFiles.length > 0 ? policyFiles.join(', ') : 'no policy file found — using built-in defaults');

  // 4. Policy file parseable
  if (policyFiles.length > 0) {
    const { ok, error } = loadPolicyFile(policyFiles[0]!);
    mark('Policy file parseable', ok ? 'pass' : 'fail', ok ? undefined : error);
  }

  // 5. Default action is deny (strict mode indicator)
  if (policyFiles.length > 0) {
    const { ok, data } = loadPolicyFile(policyFiles[0]!);
    if (ok && data && data !== '__yaml_unparsed__') {
      const policy = data as Record<string, unknown>;
      const defaultAction = String(policy['defaultAction'] ?? 'allow');
      mark('defaultAction is "deny" (strict mode)',
        defaultAction === 'deny' ? 'pass' : 'warn',
        defaultAction === 'deny' ? undefined : `currently "${defaultAction}" — consider "deny" for production`);
    }
  }

  // 6. Audit log directory
  const auditDir = join(dataDir, 'logs');
  mark('Audit log directory', existsSync(auditDir) ? 'pass' : 'warn',
    existsSync(auditDir) ? auditDir : 'created automatically when gateway starts');

  // 7. Audit log file
  const auditLogPath = join(auditDir, 'audit.ndjson');
  if (existsSync(auditDir)) {
    const auditExists = existsSync(auditLogPath);
    mark('Audit log file', auditExists ? 'pass' : 'warn',
      auditExists ? auditLogPath : 'will be created on first audit event');
  }

  // 8. Policy rule count (warn if zero rules)
  if (policyFiles.length > 0) {
    const { ok, data } = loadPolicyFile(policyFiles[0]!);
    if (ok && data && data !== '__yaml_unparsed__') {
      const policy = data as Record<string, unknown>;
      const ruleCount = Array.isArray(policy['rules']) ? policy['rules'].length : 0;
      mark('Policy has at least one rule', ruleCount > 0 ? 'pass' : 'warn',
        ruleCount > 0 ? `${ruleCount} rule(s)` : 'no rules defined — all operations use defaultAction');
    }
  }

  console.log('');
  const failures = checks.filter(c => c.result === 'fail').length;
  const warnings = checks.filter(c => c.result === 'warn').length;

  if (failures > 0) {
    console.log(`${R}  ${failures} check(s) failed.${RS}`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`${Y}  ${warnings} warning(s) — review above.${RS}`);
    process.exit(0);
  } else {
    console.log(`${G}  All policy checks passed.${RS}`);
    process.exit(0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// krythor audit tail
// ─────────────────────────────────────────────────────────────────────────────

export function runAuditTail(args: string[]): void {
  const dataDir    = resolveDataDir();
  const auditPath  = join(dataDir, 'logs', 'audit.ndjson');

  // Parse --limit N
  let limit = 20;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    const parsed = parseInt(args[limitIdx + 1]!, 10);
    if (!isNaN(parsed) && parsed > 0) limit = parsed;
  }

  // Parse --outcome filter
  let outcomeFilter: string | null = null;
  const outcomeIdx = args.indexOf('--outcome');
  if (outcomeIdx !== -1 && args[outcomeIdx + 1]) {
    outcomeFilter = args[outcomeIdx + 1]!;
  }

  // Parse --agent filter
  let agentFilter: string | null = null;
  const agentIdx = args.indexOf('--agent');
  if (agentIdx !== -1 && args[agentIdx + 1]) {
    agentFilter = args[agentIdx + 1]!;
  }

  const jsonMode = args.includes('--json');

  if (!existsSync(auditPath)) {
    console.log(`${Y}  No audit log found.${RS}`);
    console.log(`${D}  Expected: ${auditPath}${RS}`);
    console.log(`${D}  The audit log is created when the gateway first records an event.${RS}`);
    process.exit(0);
  }

  const raw = readFileSync(auditPath, 'utf-8');
  let events = raw
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      try { return JSON.parse(line) as Record<string, unknown>; }
      catch { return null; }
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  // Apply filters
  if (outcomeFilter) {
    events = events.filter(e => e['executionOutcome'] === outcomeFilter);
  }
  if (agentFilter) {
    events = events.filter(e =>
      String(e['agentId'] ?? '').includes(agentFilter!) ||
      String(e['agentName'] ?? '').includes(agentFilter!),
    );
  }

  // Take last N
  const tail = events.slice(-limit);

  if (jsonMode) {
    console.log(JSON.stringify(tail, null, 2));
    process.exit(0);
  }

  if (tail.length === 0) {
    console.log(`${D}  No matching audit events.${RS}`);
    process.exit(0);
  }

  console.log(`${C}  KRYTHOR${RS} — Audit Tail  ${D}(last ${tail.length} of ${events.length} events)${RS}`);
  if (outcomeFilter) console.log(`${D}  Filter: outcome=${outcomeFilter}${RS}`);
  if (agentFilter)   console.log(`${D}  Filter: agent=${agentFilter}${RS}`);
  console.log('');

  for (const evt of tail) {
    const ts      = evt['timestamp'] ? new Date(String(evt['timestamp'])).toLocaleTimeString() : '??:??:??';
    const action  = String(evt['actionType'] ?? 'unknown');
    const outcome = String(evt['executionOutcome'] ?? '-');
    const agent   = String(evt['agentName'] ?? evt['agentId'] ?? '-');
    const model   = String(evt['modelUsed'] ?? evt['toolName'] ?? '-');
    const dur     = evt['durationMs'] !== undefined ? `${evt['durationMs']}ms` : '';

    const outcomeColour =
      outcome === 'success' ? G :
      outcome === 'blocked' || outcome === 'error' ? R :
      outcome === 'timeout' ? Y : D;

    console.log(
      `  ${D}${ts}${RS}  ${B}${action.padEnd(22)}${RS}  ` +
      `${outcomeColour}${outcome.padEnd(9)}${RS}  ` +
      `${D}agent:${RS}${agent.padEnd(14)}  ` +
      `${D}${model}${RS}` +
      (dur ? `  ${D}${dur}${RS}` : ''),
    );
  }
  console.log('');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// krythor audit explain <id>
// ─────────────────────────────────────────────────────────────────────────────

export function runAuditExplain(eventId: string): void {
  const dataDir   = resolveDataDir();
  const auditPath = join(dataDir, 'logs', 'audit.ndjson');

  if (!eventId) {
    console.error(`${R}  Usage: krythor audit explain <event-id>${RS}`);
    process.exit(1);
  }

  if (!existsSync(auditPath)) {
    console.log(`${Y}  No audit log found at: ${auditPath}${RS}`);
    process.exit(1);
  }

  const raw = readFileSync(auditPath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());

  let found: Record<string, unknown> | null = null;
  for (const line of lines) {
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      if (String(evt['id'] ?? '').startsWith(eventId)) {
        found = evt;
        break;
      }
    } catch { /* skip */ }
  }

  if (!found) {
    console.log(`${R}  Event not found: ${eventId}${RS}`);
    console.log(`${D}  Searched ${lines.length} events in ${auditPath}${RS}`);
    process.exit(1);
  }

  console.log(`${C}  KRYTHOR${RS} — Audit Event Detail`);
  console.log('');

  // Human-readable summary
  const ts = found['timestamp'] ? new Date(String(found['timestamp'])).toLocaleString() : '?';
  console.log(`  ${D}ID${RS}              ${B}${found['id']}${RS}`);
  console.log(`  ${D}Time${RS}            ${ts}`);
  console.log(`  ${D}Action Type${RS}     ${found['actionType'] ?? '-'}`);
  console.log(`  ${D}Agent${RS}           ${found['agentName'] ?? found['agentId'] ?? '-'}`);
  console.log(`  ${D}Tool${RS}            ${found['toolName'] ?? found['skillName'] ?? '-'}`);
  console.log(`  ${D}Outcome${RS}         ${found['executionOutcome'] ?? '-'}`);
  console.log(`  ${D}Policy Decision${RS} ${found['policyDecision'] ?? '-'}`);
  console.log(`  ${D}Model${RS}           ${found['modelUsed'] ?? '-'}`);
  console.log(`  ${D}Duration${RS}        ${found['durationMs'] !== undefined ? `${found['durationMs']}ms` : '-'}`);
  if (found['reason']) {
    console.log(`  ${D}Reason${RS}          ${found['reason']}`);
  }
  if (found['target']) {
    console.log(`  ${D}Target${RS}          ${found['target']}`);
  }
  if (found['privacyDecision']) {
    const pd = found['privacyDecision'] as Record<string, unknown>;
    console.log('');
    console.log(`  ${C}Privacy Decision${RS}`);
    console.log(`    ${D}Sensitivity${RS}     ${pd['sensitivityLabel'] ?? '-'}`);
    console.log(`    ${D}Remote Allowed${RS}  ${pd['remoteAllowed'] ?? '-'}`);
    if (pd['reroutedTo'])   console.log(`    ${D}Rerouted To${RS}     ${pd['reroutedTo']}`);
    if (pd['reason'])       console.log(`    ${D}Reason${RS}          ${pd['reason']}`);
  }
  if (found['contentHash']) {
    console.log(`  ${D}Content Hash${RS}    ${D}${found['contentHash']}${RS}`);
  }

  // Full raw JSON
  console.log('');
  console.log(`  ${D}Raw event:${RS}`);
  const raw_json = JSON.stringify(found, null, 2);
  for (const line of raw_json.split('\n')) {
    console.log(`    ${D}${line}${RS}`);
  }
  console.log('');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// krythor config init-guardrails
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_POLICY_YAML = `# Krythor Guardrails Policy
# Generated by: krythor config init-guardrails
# Format documentation: docs/policy-format.md
#
# defaultAction: what to do when no rule matches.
# Values: allow | deny | warn | require-approval
version: 1
defaultAction: warn

rules:
  # ── File operations ────────────────────────────────────────────────────────
  - id: file-write-warn
    description: Warn on all file write operations
    operation: file:write
    action: warn

  - id: file-delete-approval
    description: Require approval before deleting files
    operation: file:delete
    action: require-approval

  # ── Memory operations ─────────────────────────────────────────────────────
  - id: memory-export-approval
    description: Require approval before exporting memory
    operation: memory:export
    action: require-approval

  # ── Command execution ─────────────────────────────────────────────────────
  - id: command-execute-approval
    description: Require approval before running shell commands
    operation: command:execute
    action: require-approval
    minRisk: medium

  # ── Network operations ────────────────────────────────────────────────────
  - id: network-fetch-allow
    description: Allow web fetch requests
    operation: network:fetch
    action: allow

  - id: network-search-allow
    description: Allow web search requests
    operation: network:search
    action: allow

  # ── Webhook calls ─────────────────────────────────────────────────────────
  - id: webhook-call-warn
    description: Warn on outbound webhook calls
    operation: webhook:call
    action: warn
    minRisk: medium

  # ── Agent spawning ────────────────────────────────────────────────────────
  - id: agent-spawn-approval
    description: Require approval before spawning sub-agents
    operation: agent:spawn
    action: require-approval
    minRisk: high

  # ── Config changes ────────────────────────────────────────────────────────
  - id: config-write-deny
    description: Block direct config writes from agents
    operation: config:write
    action: deny
`;

export function runInitGuardrails(args: string[]): void {
  const dataDir    = resolveDataDir();
  const configDir  = resolveConfigDir(dataDir);
  const guardrailsDir = join(configDir, 'guardrails');
  const policyPath = join(guardrailsDir, 'policy.yaml');

  const autoYes = args.includes('--yes');

  console.log(`${C}  KRYTHOR${RS} — Init Guardrails`);
  console.log(`${D}  Config dir: ${configDir}${RS}`);
  console.log('');

  // Create directories
  try {
    mkdirSync(guardrailsDir, { recursive: true });
    console.log(`  ${PASS}  Created: ${guardrailsDir}`);
  } catch (e) {
    console.log(`  ${WARN}  Could not create guardrails dir: ${(e as Error).message}`);
  }

  // Create log dir for audit
  const logsDir = join(dataDir, 'logs');
  try {
    mkdirSync(logsDir, { recursive: true });
    console.log(`  ${PASS}  Created: ${logsDir}`);
  } catch (e) {
    console.log(`  ${WARN}  Could not create logs dir: ${(e as Error).message}`);
  }

  // Write policy file
  if (existsSync(policyPath) && !autoYes) {
    console.log('');
    console.log(`  ${WARN}  Policy file already exists: ${policyPath}`);
    console.log(`  ${D}  Use --yes to overwrite.${RS}`);
    process.exit(0);
  }

  try {
    writeFileSync(policyPath, DEFAULT_POLICY_YAML, 'utf-8');
    console.log(`  ${PASS}  Created policy: ${policyPath}`);
  } catch (e) {
    console.log(`  ${FAIL}  Could not write policy file: ${(e as Error).message}`);
    process.exit(1);
  }

  console.log('');
  console.log(`${G}  Guardrails initialized successfully.${RS}`);
  console.log('');
  console.log(`  Next steps:`);
  console.log(`  ${D}1. Review the policy:  krythor policy check${RS}`);
  console.log(`  ${D}2. Run diagnostics:    krythor policy doctor${RS}`);
  console.log(`  ${D}3. Start the gateway:  krythor${RS}`);
  console.log('');
  process.exit(0);
}
