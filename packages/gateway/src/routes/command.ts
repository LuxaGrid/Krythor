import type { FastifyInstance } from 'fastify';
import type { KrythorCore, AgentOrchestrator } from '@krythor/core';
import type { AgentEvent } from '@krythor/core';
import type { GuardEngine } from '@krythor/guard';
import type { ConversationStore } from '@krythor/memory';
import { classifyError } from '../errors.js';

/** Register a requestId→runId mapping on the app instance (set in server.ts). */
function registerRunRequestId(app: FastifyInstance, runId: string, requestId: string): void {
  const reg = (app as unknown as Record<string, unknown>)['registerRunRequestId'];
  if (typeof reg === 'function') reg(runId, requestId);
}

export function registerCommandRoute(
  app: FastifyInstance,
  core: KrythorCore,
  orchestrator: AgentOrchestrator,
  broadcast: (msg: unknown) => void,
  guard?: GuardEngine,
  convStore?: ConversationStore,
): void {
  app.post('/api/command', {
    config: {
      // Tighter rate limit for inference — prevents runaway loops from agents or UI bugs.
      rateLimit: { max: 60, timeWindow: 60_000 },
    },
    schema: {
      body: {
        type: 'object',
        required: ['input'],
        properties: {
          input:          { type: 'string', minLength: 1 },
          agentId:        { type: 'string' },
          modelId:        { type: 'string' },
          stream:         { type: 'boolean' },
          conversationId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { input, agentId, modelId, stream, conversationId } = req.body as {
      input: string;
      agentId?: string;
      modelId?: string;
      stream?: boolean;
      conversationId?: string;
    };

    // Guard check — evaluate before executing anything
    if (guard) {
      const verdict = guard.check({
        operation: 'command:execute',
        source: 'user',
        content: input,
        ...(agentId && { sourceId: agentId }),
      });
      if (!verdict.allowed) {
        if (stream) {
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: `Command denied by security policy: ${verdict.reason}` })}\n\n`);
          reply.raw.end();
          return reply;
        }
        return reply.code(403).send({
          input,
          output: `Command denied by security policy: ${verdict.reason}`,
          timestamp: new Date().toISOString(),
          processingTimeMs: 0,
          error: { code: 'GUARD_DENIED', message: verdict.reason, hint: 'Adjust your Guard policy in the Guard tab if this is unexpected.' },
          guardVerdict: verdict,
        });
      }
    }

    // No provider — return friendly guidance immediately
    const models = core.getModels();
    if (!models || models.stats().providerCount === 0) {
      if (stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'No AI provider is configured. Open the Models tab to add one, then try again.' })}\n\n`);
        reply.raw.end();
        return reply;
      }
      return reply.send({
        input,
        output: 'No AI provider is configured. Open the Models tab to add one, then try again.',
        timestamp: new Date().toISOString(),
        processingTimeMs: 0,
        noProvider: true,
      });
    }

    // Load conversation history for context
    let contextMessages: Array<{ role: string; content: string }> = [];
    if (conversationId && convStore) {
      const existing = convStore.getConversation(conversationId);
      if (existing) {
        const msgs = convStore.getMessages(conversationId);
        contextMessages = msgs.map(m => ({ role: m.role, content: m.content }));
      }
    }

    // Helper: auto-generate title from first message
    const autoTitle = input.slice(0, 40) + (input.length > 40 ? '…' : '');

    try {
      if (agentId) {
        const agent = orchestrator.getAgent(agentId);
        if (!agent) {
          if (stream) {
            reply.raw.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            });
            reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'The selected agent could not be found. Go to the Agents tab to select or create one.' })}\n\n`);
            reply.raw.end();
            return reply;
          }
          return reply.send({
            input,
            output: 'The selected agent could not be found. Go to the Agents tab to select or create one.',
            timestamp: new Date().toISOString(),
            processingTimeMs: 0,
          });
        }

        if (stream) {
          // Real SSE streaming — subscribe to orchestrator events for this run
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          let streamEnded = false;
          const sendEvent = (obj: object): void => {
            if (!streamEnded) reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
          };
          const endStream = (): void => {
            if (streamEnded) return;
            streamEnded = true;
            orchestrator.removeListener('agent:event', onChunk);
            reply.raw.end();
          };

          // Generate a runId upfront so we can correlate events.
          // Prefix with the Fastify request ID for end-to-end log correlation.
          const runId = `run-${req.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          registerRunRequestId(app, runId, String(req.id));

          // Save user message to conversation before run
          let activeConvId = conversationId;
          if (convStore) {
            if (!activeConvId) {
              const conv = convStore.createConversation(agentId);
              activeConvId = conv.id;
              sendEvent({ type: 'conversation', conversationId: conv.id, title: autoTitle });
              convStore.updateConversationTitle(conv.id, autoTitle);
            } else if (contextMessages.length === 0) {
              convStore.updateConversationTitle(activeConvId, autoTitle);
            }
            convStore.addMessage(activeConvId, 'user', input);
          }

          const convIdForRun = activeConvId;

          // Listen for stream events from this specific run
          const onChunk = (event: AgentEvent): void => {
            if (event.runId !== runId) return;

            if (event.type === 'run:stream:chunk') {
              const p = event.payload as { delta?: string; done?: boolean } | undefined;
              sendEvent({ type: 'delta', content: p?.delta ?? '', runId });
            } else if (event.type === 'run:completed') {
              const p = event.payload as { output?: string; modelUsed?: string; selectionReason?: string; fallbackOccurred?: boolean } | undefined;
              const output = p?.output ?? '';

              // Save assistant message to conversation
              if (convStore && convIdForRun) {
                convStore.addMessage(convIdForRun, 'assistant', output, p?.modelUsed);
              }

              sendEvent({ type: 'done', output, runId, requestId: req.id, conversationId: convIdForRun, modelUsed: p?.modelUsed, selectionReason: p?.selectionReason ?? null, fallbackOccurred: p?.fallbackOccurred ?? false });
              endStream();
            } else if (event.type === 'run:failed') {
              const p = event.payload as { error?: string } | undefined;
              sendEvent({ type: 'error', message: p?.error ?? 'Run failed' });
              endStream();
            } else if (event.type === 'run:stopped') {
              sendEvent({ type: 'done', output: '', runId, conversationId: convIdForRun });
              endStream();
            }
          };

          orchestrator.on('agent:event', onChunk);
          // Clean up listener if client disconnects before the run finishes
          reply.raw.on('close', endStream);

          // Start the run — don't await, events drive the response
          const runInput = { input, ...(modelId && { modelOverride: modelId }), requestId: String(req.id) };
          orchestrator.runAgentStream(agentId, runInput, { contextMessages, runId }).catch(err => {
            const structured = classifyError(err);
            sendEvent({ type: 'error', message: structured.hint || structured.message });
            endStream();
          });

          return reply;
        }

        // Non-streaming (default)
        const startTime = Date.now();
        // Pre-generate runId so the requestId can be registered before the run emits events
        const { randomUUID: genNonStreamId } = await import('crypto');
        const nonStreamRunId = genNonStreamId();
        registerRunRequestId(app, nonStreamRunId, String(req.id));
        const nonStreamRunInput = { input, ...(modelId && { modelOverride: modelId }), requestId: String(req.id), runId: nonStreamRunId };
        const run = await orchestrator.runAgent(agentId, nonStreamRunInput, { contextMessages });
        const output = run.output ?? '(no response)';

        // Save messages to conversation
        let activeConvId = conversationId;
        if (convStore) {
          if (!activeConvId) {
            const conv = convStore.createConversation(agentId);
            activeConvId = conv.id;
            convStore.updateConversationTitle(conv.id, autoTitle);
          } else if (contextMessages.length === 0) {
            convStore.updateConversationTitle(activeConvId, autoTitle);
          }
          convStore.addMessage(activeConvId, 'user', input);
          convStore.addMessage(activeConvId, 'assistant', output, run.modelUsed);
        }

        return reply.send({
          input,
          output,
          timestamp: new Date().toISOString(),
          processingTimeMs: run.completedAt ? run.completedAt - run.startedAt : Date.now() - startTime,
          modelUsed: run.modelUsed,
          agentId: run.agentId,
          runId: run.id,
          requestId: req.id,
          conversationId: activeConvId,
          status: run.status,
          selectionReason: run.selectionReason ?? null,
          fallbackOccurred: run.fallbackOccurred ?? false,
          error: run.status === 'failed'
            ? { code: 'RUN_FAILED', message: run.errorMessage ?? 'Run failed', hint: 'Check the Models tab and verify your provider is reachable.' }
            : undefined,
        });
      }

      // No agent — direct command via KrythorCore
      if (stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const startTime = Date.now();

        // Save user message
        let activeConvId = conversationId;
        if (convStore) {
          if (!activeConvId) {
            const conv = convStore.createConversation();
            activeConvId = conv.id;
            reply.raw.write(`data: ${JSON.stringify({ type: 'conversation', conversationId: conv.id, title: autoTitle })}\n\n`);
            convStore.updateConversationTitle(conv.id, autoTitle);
          }
          convStore.addMessage(activeConvId, 'user', input);
        }

        try {
          const result = await core.handleCommand(input, modelId ? { agentModelId: modelId } : undefined);
          const output = (result as { output?: string }).output ?? String(result);
          const duration = Date.now() - startTime;

          if (convStore && activeConvId) {
            convStore.addMessage(activeConvId, 'assistant', output);
          }

          reply.raw.write(`data: ${JSON.stringify({ type: 'done', duration, output, conversationId: activeConvId })}\n\n`);
        } catch (err) {
          const structured = classifyError(err);
          reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: structured.hint || structured.message })}\n\n`);
        }

        reply.raw.end();
        return reply;
      }

      const startTime = Date.now();
      const result = await core.handleCommand(input, modelId ? { agentModelId: modelId } : undefined);

      // Save to conversation
      let activeConvId = conversationId;
      if (convStore) {
        const output = (result as { output?: string }).output ?? String(result);
        if (!activeConvId) {
          const conv = convStore.createConversation();
          activeConvId = conv.id;
          convStore.updateConversationTitle(conv.id, autoTitle);
        }
        convStore.addMessage(activeConvId, 'user', input);
        convStore.addMessage(activeConvId, 'assistant', output);
      }

      return reply.send({ ...result as object, conversationId: activeConvId });
    } catch (err) {
      const structured = classifyError(err);
      if (stream) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: structured.hint || structured.message })}\n\n`);
        reply.raw.end();
        return reply;
      }
      return reply.send({
        input,
        output: `${structured.error}. ${structured.hint}`,
        timestamp: new Date().toISOString(),
        processingTimeMs: 0,
        error: structured,
      });
    }
  });
}
