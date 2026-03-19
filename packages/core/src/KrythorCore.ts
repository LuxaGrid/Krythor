import { MemoryEngine } from '@krythor/memory';
import { ModelEngine } from '@krythor/models';
import type { MemorySearchResult } from '@krythor/memory';
import type { RoutingContext } from '@krythor/models';
import { AgentOrchestrator } from './agents/AgentOrchestrator.js';
import type { AgentRun, RunAgentInput } from './agents/types.js';
import { SystemIdentityProvider } from './SystemIdentityProvider.js';

export interface CommandResult {
  input: string;
  output: string;
  timestamp: string;
  processingTimeMs: number;
  memoryContext?: MemorySearchResult[];
  modelUsed?: string;
  agentRun?: AgentRun;
}

export class KrythorCore {
  private readonly version = '0.1.0';
  private memory: MemoryEngine | null = null;
  private models: ModelEngine | null = null;
  private orchestrator: AgentOrchestrator | null = null;
  readonly identity: SystemIdentityProvider;

  constructor(soulSearchPaths: string[] = []) {
    this.identity = new SystemIdentityProvider(soulSearchPaths);
  }

  attachMemory(engine: MemoryEngine): void {
    this.memory = engine;
  }

  attachModels(engine: ModelEngine): void {
    this.models = engine;
  }

  attachOrchestrator(orch: AgentOrchestrator): void {
    this.orchestrator = orch;
  }

  async handleCommand(input: string, routingContext?: RoutingContext): Promise<CommandResult> {
    const start = Date.now();

    if (!input || input.trim().length === 0) {
      throw new Error('Command input must not be empty');
    }

    const trimmed = input.trim();

    // 1. Retrieve relevant memory
    let memoryContext: MemorySearchResult[] = [];
    if (this.memory) {
      memoryContext = await this.memory.search({ limit: 5 }, trimmed);
      for (const result of memoryContext) {
        this.memory.recordUse(result.entry.id, null, `command: ${trimmed.substring(0, 80)}`);
      }
    }

    // 2. Execute via model if available, otherwise echo
    let output: string;
    let modelUsed: string | undefined;

    if (this.models && this.models.stats().providerCount > 0) {
      const systemContent = [
        this.identity.excerpt(1500),
        memoryContext.length > 0
          ? `\nRelevant context from memory:\n${memoryContext.map(r => `- ${r.entry.title}: ${r.entry.content}`).join('\n')}`
          : '',
      ].join('');

      try {
        const response = await this.models.infer(
          {
            messages: [
              { role: 'system', content: systemContent },
              { role: 'user', content: trimmed },
            ],
          },
          routingContext,
        );
        output = response.content;
        modelUsed = `${response.providerId}/${response.model}`;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown error';
        const contextNote = memoryContext.length > 0 ? ` [${memoryContext.length} memory context(s) loaded]` : '';
        output = `[Krythor Core v${this.version}] Echo: ${trimmed}${contextNote} [model unavailable: ${reason}]`;
      }
    } else {
      const contextNote = memoryContext.length > 0 ? ` [${memoryContext.length} memory context(s) loaded]` : '';
      output = `[Krythor Core v${this.version}] Echo: ${trimmed}${contextNote}`;
    }

    const result: CommandResult = {
      input: trimmed,
      output,
      timestamp: new Date().toISOString(),
      processingTimeMs: Date.now() - start,
      memoryContext: memoryContext.length > 0 ? memoryContext : undefined,
      modelUsed,
    };

    // 3. Write session memory
    if (this.memory) {
      this.memory.create({
        title: `Command: ${trimmed.substring(0, 60)}`,
        content: output,
        scope: 'session',
        source: 'system',
        importance: 0.3,
        tags: ['command', 'session'],
        source_type: 'command',
        source_reference: trimmed,
      });
    }

    return result;
  }

  // Delegate agent runs directly through Core so other subsystems can call them
  async runAgent(agentId: string, input: RunAgentInput): Promise<AgentRun> {
    if (!this.orchestrator) throw new Error('Agent orchestrator not attached');
    return this.orchestrator.runAgent(agentId, input);
  }

  getMemory(): MemoryEngine | null { return this.memory; }
  getModels(): ModelEngine | null { return this.models; }
  getOrchestrator(): AgentOrchestrator | null { return this.orchestrator; }
}
