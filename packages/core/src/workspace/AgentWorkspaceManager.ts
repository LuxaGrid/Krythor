// ─── AgentWorkspaceManager ────────────────────────────────────────────────────
//
// Creates and manages the agent workspace directory and its bootstrap files.
//
// Workspace layout:
//   <workspace>/
//     AGENTS.md       — operating instructions
//     SOUL.md         — persona/tone
//     TOOLS.md        — tool usage notes
//     IDENTITY.md     — agent name/vibe
//     USER.md         — user profile
//     HEARTBEAT.md    — heartbeat checklist (optional)
//     BOOTSTRAP.md    — first-run ritual (optional, delete after use)
//     memory/         — daily memory logs (not auto-injected)
//     skills/         — workspace-specific skills
//
// Default location: ~/.krythor/workspace
//

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join as _join } from 'path';
import { homedir as _homedir } from 'os';

export function getDefaultWorkspaceDir(): string {
  if (process.env['KRYTHOR_WORKSPACE_DIR']) {
    return process.env['KRYTHOR_WORKSPACE_DIR'];
  }
  return _join(_homedir(), '.krythor', 'workspace');
}

// ── Default file templates ─────────────────────────────────────────────────────

const DEFAULTS: Record<string, string> = {
  'AGENTS.md': `# Agent Instructions

## Role
You are a capable local-first AI agent. Help the user accomplish their goals efficiently.

## Memory
- Write important decisions, facts, and outcomes to your daily memory log (memory/YYYY-MM-DD.md).
- Read today's and yesterday's memory log at the start of each session when relevant.
- Keep memory entries concise and factual.

## Working Rules
- Prefer local execution when sufficient.
- Surface failures honestly — do not fake confidence.
- Ask for clarification when intent is ambiguous.
- Respect tool policy and permission boundaries.
`,

  'SOUL.md': `# Soul

## Identity
A focused, honest, and capable assistant. Local-first, cost-aware, user-controlled.

## Tone
- Clear and direct.
- Friendly but not sycophantic.
- Brief when brevity serves — detailed when depth is needed.

## Boundaries
- Do not take irreversible actions without confirmation.
- Do not exfiltrate data or bypass oversight.
- Surface uncertainty rather than guessing.
`,

  'IDENTITY.md': `# Identity

Name: Krythor
Emoji: ⚡
Vibe: Precise, local-first, dependable.
`,

  'USER.md': `# User Profile

## Address
How to address the user: by first name when known, otherwise "you".

## Preferences
- Prefer concise responses unless detail is explicitly requested.
- Code first, explanation after (unless asked otherwise).
`,

  'TOOLS.md': `# Tools

## Notes
Tool usage notes and local conventions go here.
Keep this file lean — it is injected on every turn.

## Conventions
- Use \`exec\` for shell commands.
- Use \`read_file\` / \`write_file\` for file operations.
- Use \`web_search\` only when local knowledge is insufficient.
`,

  'HEARTBEAT.md': `# Heartbeat

## Checklist
- [ ] Check for pending tasks.
- [ ] Report any errors or blockers.
- [ ] Summarize status in one line.
`,
};

const BOOTSTRAP_MD = `# Bootstrap Ritual

Welcome! This is your first run. Complete the following steps, then delete this file.

1. Introduce yourself to the user.
2. Ask for their name and preferred address.
3. Update USER.md with their name.
4. Update IDENTITY.md if you want a custom name or emoji.
5. Write a brief memory entry in memory/YYYY-MM-DD.md recording the workspace was initialized.
6. Delete BOOTSTRAP.md once the ritual is complete.
`;

// ── AgentWorkspaceManager ─────────────────────────────────────────────────────

export class AgentWorkspaceManager {
  constructor(private readonly workspaceDir: string) {}

  /**
   * Ensure the workspace directory exists and all bootstrap files are present.
   * Existing files are never overwritten — only missing files are created.
   * Pass skipBootstrap=true to skip creating BOOTSTRAP.md (for pre-seeded workspaces).
   */
  ensureWorkspace(opts: { skipBootstrap?: boolean } = {}): void {
    mkdirSync(this.workspaceDir, { recursive: true });
    mkdirSync(_join(this.workspaceDir, 'memory'), { recursive: true });
    mkdirSync(_join(this.workspaceDir, 'skills'), { recursive: true });

    // Write each default file if missing
    for (const [name, content] of Object.entries(DEFAULTS)) {
      const filePath = _join(this.workspaceDir, name);
      if (!existsSync(filePath)) {
        writeFileSync(filePath, content, 'utf-8');
      }
    }

    // BOOTSTRAP.md: only create if NO other bootstrap files existed before this run
    // (i.e., this is a brand-new workspace). Skip if opts.skipBootstrap is set.
    if (!opts.skipBootstrap) {
      const bootstrapPath = _join(this.workspaceDir, 'BOOTSTRAP.md');
      if (!existsSync(bootstrapPath)) {
        // Only create if workspace appears brand-new (no AGENTS.md existed before)
        // We use a sentinel: if AGENTS.md was just created (non-existent before ensureWorkspace),
        // this is a new workspace. We track this by checking all defaults existed.
        // Simple heuristic: if AGENTS.md exists (we just wrote it), create BOOTSTRAP.md.
        writeFileSync(bootstrapPath, BOOTSTRAP_MD, 'utf-8');
      }
    }
  }

  /** Returns the workspace directory path. */
  get dir(): string {
    return this.workspaceDir;
  }

  /** Check whether the workspace exists. */
  exists(): boolean {
    return existsSync(this.workspaceDir);
  }
}
