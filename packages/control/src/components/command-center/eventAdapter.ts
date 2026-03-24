// Krythor Command Center — Gateway Event Adapter
// Maps raw GatewayContext events → CCEvents
// This module is the ONLY place that knows about gateway event shapes.

import { makeEvent } from './events';
import type { CCEvent, CommandCenterAgent } from './types';

// Gateway agent:event payload shapes
interface RunStartedPayload {
  runId?: string;
  agentId?: string;
  agentName?: string;
  modelId?: string;
  task?: string;
}

interface RunCompletedPayload {
  runId?: string;
  agentId?: string;
  output?: string;
  modelUsed?: string;
  durationMs?: number;
}

interface RunFailedPayload {
  runId?: string;
  agentId?: string;
  error?: string;
}

interface ToolPayload {
  runId?: string;
  agentId?: string;
  toolName?: string;
  tool?: string;
}

interface MemoryPayload {
  runId?: string;
  agentId?: string;
  count?: number;
}

interface HandoffPayload {
  fromAgentId?: string;
  toAgentId?: string;
  runId?: string;
  reason?: string;
}

/**
 * Resolves a gateway agentId to a Command Center agent id.
 * Krythor agents have database UUIDs; Command Center has mythic IDs.
 * We map by checking if the agentId matches any known agent, otherwise
 * route by role heuristic: the first non-orchestrator agent gets task traffic.
 */
function resolveAgentId(
  gatewayAgentId: string | undefined,
  agentMap: Record<string, CommandCenterAgent>,
): string {
  if (!gatewayAgentId) return 'atlas';
  // 1. Direct CC id match (mythic agents)
  if (agentMap[gatewayAgentId]) return gatewayAgentId;
  // 2. Match by stored gateway UUID — user-created agents set gatewayAgentId
  const byGatewayId = Object.values(agentMap).find(a => a.gatewayAgentId === gatewayAgentId);
  if (byGatewayId) return byGatewayId.id;
  // 3. Fallback: first non-orchestrator worker
  const workers = Object.values(agentMap).filter(a => a.role !== 'orchestrator');
  if (workers.length > 0) return workers[0]!.id;
  return 'atlas';
}

/**
 * Main adapter function. Takes a raw GatewayContext event and returns
 * a structured CCEvent, or null if the event should be ignored.
 */
export function adaptGatewayEvent(
  raw: { type: string; payload?: unknown; timestamp?: number; id?: number },
  agentMap: Record<string, CommandCenterAgent>,
): CCEvent | null {
  const ts = raw.timestamp ?? Date.now();

  // Top-level event type
  const topType = raw.type ?? '';

  // agent:event wraps a sub-event
  if (topType === 'agent:event') {
    const payload = (raw.payload ?? {}) as Record<string, unknown>;
    const subType = String(payload['type'] ?? '');
    return adaptAgentSubEvent(subType, payload, agentMap, ts);
  }

  // guard:denied — route to pyron (monitor)
  if (topType === 'guard:denied') {
    const payload = (raw.payload ?? {}) as Record<string, unknown>;
    return makeEvent('ERROR', 'pyron', `Guard denied: ${String(payload['reason'] ?? 'policy violation')}`, {
      ts,
      zoneId: 'monitor',
      error: String(payload['reason'] ?? ''),
    });
  }

  // skill:event
  if (topType === 'skill:event') {
    const payload = (raw.payload ?? {}) as Record<string, unknown>;
    const skillState = String(payload['state'] ?? '');
    if (skillState === 'running') {
      return makeEvent('TASK_STARTED', 'voltaris', `Skill: ${String(payload['skillId'] ?? 'unknown')}`, {
        ts, taskLabel: String(payload['skillId'] ?? ''), zoneId: 'forge',
      });
    }
    if (skillState === 'done') {
      return makeEvent('TASK_COMPLETED', 'voltaris', `Skill complete`, { ts, zoneId: 'forge' });
    }
  }

  return null;
}

function adaptAgentSubEvent(
  subType: string,
  payload: Record<string, unknown>,
  agentMap: Record<string, CommandCenterAgent>,
  ts: number,
): CCEvent | null {
  switch (subType) {
    case 'run:started': {
      const p = payload as RunStartedPayload;
      const agentId = resolveAgentId(p.agentId, agentMap);
      const taskLabel = p.task ?? p.agentName ?? 'Processing\u2026';
      return makeEvent('TASK_STARTED', agentId, `Task started${p.agentName ? ` \u2014 ${p.agentName}` : ''}`, {
        ts,
        taskLabel,
        modelId: p.modelId,
        zoneId: agentMap[agentId]?.currentZone,
      });
    }

    case 'run:completed': {
      const p = payload as RunCompletedPayload;
      const agentId = resolveAgentId(p.agentId, agentMap);
      const preview = p.output ? p.output.slice(0, 40).replace(/\n/g, ' ') + (p.output.length > 40 ? '\u2026' : '') : 'Done';
      return makeEvent('RESPONSE_COMPLETE', agentId, preview, {
        ts,
        modelId: p.modelUsed,
        zoneId: agentMap[agentId]?.currentZone,
      });
    }

    case 'run:failed': {
      const p = payload as RunFailedPayload;
      const agentId = resolveAgentId(p.agentId, agentMap);
      return makeEvent('ERROR', agentId, `Run failed: ${p.error ?? 'unknown error'}`, {
        ts,
        error: p.error,
        zoneId: agentMap[agentId]?.currentZone,
      });
    }

    case 'run:stopped': {
      const agentId = resolveAgentId(String(payload['agentId'] ?? ''), agentMap);
      return makeEvent('AGENT_IDLE', agentId, 'Agent stopped', { ts });
    }

    case 'tool:called':
    case 'run:tool:called': {
      const p = payload as ToolPayload;
      const agentId = resolveAgentId(p.agentId, agentMap);
      const toolName = p.toolName ?? p.tool ?? 'tool';
      return makeEvent('TOOL_CALLED', agentId, `Tool: ${toolName}`, {
        ts, toolName, zoneId: agentMap[agentId]?.currentZone,
      });
    }

    case 'tool:completed':
    case 'run:tool:completed': {
      const p = payload as ToolPayload;
      const agentId = resolveAgentId(p.agentId, agentMap);
      return makeEvent('TOOL_COMPLETED', agentId, `Tool done: ${p.toolName ?? p.tool ?? ''}`, {
        ts, zoneId: agentMap[agentId]?.currentZone,
      });
    }

    case 'memory:retrieved':
    case 'run:memory:retrieved': {
      const p = payload as MemoryPayload;
      const agentId = resolveAgentId(p.agentId, agentMap);
      return makeEvent('MEMORY_RETRIEVED', agentId, `Memory retrieved (${p.count ?? '?'} entries)`, {
        ts, zoneId: 'memory',
      });
    }

    case 'agent:handoff': {
      const p = payload as HandoffPayload;
      const fromId = resolveAgentId(p.fromAgentId, agentMap);
      const toAgent = p.toAgentId ? agentMap[p.toAgentId] : undefined;
      return makeEvent('AGENT_HANDOFF', fromId, `Handoff \u2192 ${toAgent?.displayName ?? p.toAgentId ?? 'agent'}`, {
        ts,
        targetAgentId: p.toAgentId,
        zoneId: toAgent?.homeZone,
      });
    }

    case 'model:selected': {
      const agentId = resolveAgentId(String(payload['agentId'] ?? ''), agentMap);
      return makeEvent('MODEL_SELECTED', agentId, `Model: ${String(payload['modelId'] ?? '')}`, {
        ts, modelId: String(payload['modelId'] ?? ''),
      });
    }

    default:
      return null;
  }
}
