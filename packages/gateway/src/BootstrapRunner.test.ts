import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BootstrapRunner } from './BootstrapRunner.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'krythor-boot-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeRunner(runAgentMock: (id: string, input: { input: string }) => Promise<void>, agents: { id: string }[] = []) {
  const orchestrator = {
    listAgents: () => agents,
    runAgent: runAgentMock,
  } as unknown as import('@krythor/core').AgentOrchestrator;
  const core = {
    handleCommand: vi.fn().mockResolvedValue({ output: 'ok' }),
  } as unknown as import('@krythor/core').KrythorCore;
  return { runner: new BootstrapRunner(tmpDir, orchestrator, core), core };
}

describe('BootstrapRunner — no BOOT.md', () => {
  it('does nothing when BOOT.md is absent', async () => {
    const runAgent = vi.fn();
    const { runner } = makeRunner(runAgent);
    runner.run();
    await new Promise(r => setTimeout(r, 20));
    expect(runAgent).not.toHaveBeenCalled();
  });
});

describe('BootstrapRunner — with agent', () => {
  it('runs BOOT.md content via the first agent', async () => {
    writeFileSync(join(tmpDir, 'BOOT.md'), 'Say hello on startup', 'utf-8');
    const runAgent = vi.fn().mockResolvedValue({});
    const { runner } = makeRunner(runAgent, [{ id: 'agent-1' }]);
    runner.run();
    await new Promise(r => setTimeout(r, 50));
    expect(runAgent).toHaveBeenCalledWith('agent-1', { input: 'Say hello on startup' });
  });

  it('strips YAML frontmatter before sending', async () => {
    writeFileSync(join(tmpDir, 'BOOT.md'), '---\nname: boot\n---\nActual instructions', 'utf-8');
    const runAgent = vi.fn().mockResolvedValue({});
    const { runner } = makeRunner(runAgent, [{ id: 'agent-1' }]);
    runner.run();
    await new Promise(r => setTimeout(r, 50));
    expect(runAgent).toHaveBeenCalledWith('agent-1', { input: 'Actual instructions' });
  });
});

describe('BootstrapRunner — no agents', () => {
  it('falls back to core.handleCommand when no agents are configured', async () => {
    writeFileSync(join(tmpDir, 'BOOT.md'), 'Bootstrap via core', 'utf-8');
    const runAgent = vi.fn();
    const { runner, core } = makeRunner(runAgent, []);
    runner.run();
    await new Promise(r => setTimeout(r, 50));
    expect(runAgent).not.toHaveBeenCalled();
    expect(core.handleCommand).toHaveBeenCalledWith('Bootstrap via core');
  });
});

describe('BootstrapRunner — empty BOOT.md', () => {
  it('skips execution when BOOT.md is blank after stripping frontmatter', async () => {
    writeFileSync(join(tmpDir, 'BOOT.md'), '---\nname: boot\n---\n   \n', 'utf-8');
    const runAgent = vi.fn();
    const { runner } = makeRunner(runAgent, [{ id: 'agent-1' }]);
    runner.run();
    await new Promise(r => setTimeout(r, 50));
    expect(runAgent).not.toHaveBeenCalled();
  });
});
