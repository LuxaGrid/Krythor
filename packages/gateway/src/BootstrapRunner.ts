/**
 * BootstrapRunner — executes BOOT.md on gateway startup.
 *
 * When the gateway starts, if a BOOT.md file exists in the workspace directory,
 * its content is sent as a command to the first available agent (or via direct
 * KrythorCore command if no agents are configured). This enables workspace-level
 * startup automation without requiring a separate cron job.
 *
 * BOOT.md format: plain markdown / plain text instructions to the agent.
 * Frontmatter (--- ... ---) is stripped before sending.
 *
 * The run is fire-and-forget: errors are logged but do not block gateway startup.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { AgentOrchestrator, KrythorCore } from '@krythor/core';
import { logger } from './logger.js';

const BOOT_FILE = 'BOOT.md';

/** Strip YAML-style frontmatter (--- ... ---) from the top of a string. */
function stripFrontmatter(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) return content;
  const endIdx = trimmed.indexOf('\n---', 3);
  if (endIdx === -1) return content;
  return trimmed.slice(endIdx + 4).trimStart();
}

export class BootstrapRunner {
  private readonly workspaceDir: string;
  private readonly orchestrator: AgentOrchestrator;
  private readonly core: KrythorCore;

  constructor(workspaceDir: string, orchestrator: AgentOrchestrator, core: KrythorCore) {
    this.workspaceDir = workspaceDir;
    this.orchestrator = orchestrator;
    this.core = core;
  }

  /**
   * Run BOOT.md if it exists in the workspace directory.
   * Returns immediately — the actual run is fire-and-forget.
   */
  run(): void {
    const bootPath = join(this.workspaceDir, BOOT_FILE);
    if (!existsSync(bootPath)) return;

    let raw: string;
    try {
      raw = readFileSync(bootPath, 'utf-8');
    } catch (err) {
      logger.warn('BootstrapRunner: failed to read BOOT.md', {
        path: bootPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const instructions = stripFrontmatter(raw).trim();
    if (!instructions) return;

    logger.info('BootstrapRunner: running BOOT.md', { path: bootPath, chars: instructions.length });

    this._execute(instructions).catch(err => {
      logger.warn('BootstrapRunner: BOOT.md execution failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private async _execute(instructions: string): Promise<void> {
    const agents = this.orchestrator.listAgents();
    if (agents.length > 0) {
      const agent = agents[0];
      await this.orchestrator.runAgent(agent.id, { input: instructions });
      logger.info('BootstrapRunner: BOOT.md completed via agent', { agentId: agent.id });
    } else {
      await this.core.handleCommand(instructions);
      logger.info('BootstrapRunner: BOOT.md completed via core');
    }
  }
}
