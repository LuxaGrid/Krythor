/**
 * GET /api/dashboard — consolidated summary stats.
 *
 * Returns a single object with all key system metrics:
 * { uptime, version, providerCount, modelCount, agentCount, memoryEntries,
 *   conversationCount, totalTokensUsed, activeWarnings, lastHeartbeat }
 *
 * This consolidates data from /health, /api/stats, /api/providers, /api/agents.
 */

import type { FastifyInstance } from 'fastify';
import type { ModelEngine } from '@krythor/models';
import type { MemoryEngine } from '@krythor/memory';
import type { AgentOrchestrator } from '@krythor/core';
import type { HeartbeatEngine } from '../heartbeat/HeartbeatEngine.js';
import { KRYTHOR_VERSION } from '../server.js';

const startedAt = Date.now();

export function registerDashboardRoute(
  app: FastifyInstance,
  models: ModelEngine,
  memory: MemoryEngine,
  orchestrator: AgentOrchestrator,
  heartbeat: HeartbeatEngine,
): void {

  app.get('/api/dashboard', async (_req, reply) => {
    const modelStats    = models.stats();
    const agentStats    = orchestrator.stats();
    const memStats      = memory.stats();
    const heartbeatCfg  = heartbeat.getConfig();
    const lastRun       = heartbeat.getLastRun();
    const warnings      = heartbeat.getActiveWarnings();
    const convCount     = memory.convStore.listConversations().length;

    return reply.send({
      uptime:            Date.now() - startedAt,
      version:           KRYTHOR_VERSION,
      providerCount:     modelStats.providerCount,
      modelCount:        modelStats.modelCount,
      agentCount:        agentStats.agentCount,
      memoryEntries:     memStats.totalEntries,
      conversationCount: convCount,
      totalTokensUsed:   models.tokenTracker.totalTokens(),
      activeWarnings:    warnings,
      lastHeartbeat:     heartbeatCfg.enabled ? (lastRun ?? null) : null,
    });
  });
}
